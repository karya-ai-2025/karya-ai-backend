const { generateEmailCampaignCopy } = require('../../anthropicService');
const { fetchEmailableLeads } = require('../leadsQuery');
const { createDraftCampaign } = require('../emailCampaignService');
const { hasEmailAccess, buildBuyCard } = require('../entitlements');
const HitlRequest = require('../../../models/HitlRequest');

// Reusable "you need the email project" turn — ends the modal flow.
const emailBuyGate = (feature, response) => ({
  phase: 'email_complete',
  nextAction: 'respond',
  emailBrief: null,
  uiRequest: buildBuyCard('email', feature),
  response
});

const getLatest = (messages = []) => {
  const m = [...messages].reverse().find((x) => x.role === 'user');
  return (m?.content || '').trim();
};

const describeFilter = (filter = {}) => [
  filter.industry  && `industry: ${filter.industry}`,
  filter.location  && `location: ${filter.location}`,
  filter.segment   && `segment: ${filter.segment}`,
  filter.seniority && `seniority: ${filter.seniority}`,
  filter.title     && `title: ${filter.title}`,
  filter.company   && `company: ${filter.company}`
].filter(Boolean).join(', ');

const isExpert   = (m) => /\b(expert|refine it|get an expert|human review|reviewer)\b/i.test(m);
const isApprove  = (m) => /\b(looks good|approve|use this|pick recipients|start campaign|go ahead|yes)\b/i.test(m);
const wantsCsv   = (m) => /\b(csv|excel|upload|file|spreadsheet)\b/i.test(m);
const wantsKarya = (m) => /\b(karya|search|find leads|new list|different leads)\b/i.test(m);

// Small helper: a plain "ask the next question" turn that keeps the flow modal.
const ask = (response, brief, patch = {}) => ({
  phase: 'email_flow',
  nextAction: 'respond',
  emailBrief: { ...brief, ...patch },
  uiRequest: null,
  response
});

const draftFor = (state, brief) => generateEmailCampaignCopy({
  state,
  audienceSummary: describeFilter(state.leadsFilter || {}) || 'the target audience',
  recipientCount: null,
  instruction: `Campaign name: ${brief.name}. Goal/offer: ${brief.goal}. Tone: ${brief.tone}.${brief.revision ? ` Revision request: ${brief.revision}` : ''}`
});

// Build the draft campaign from a leadsFilter (searched / karya paths).
const buildFromFilter = async (state, brief, filter, userId) => {
  // Creating the campaign is the paid action → require the email project.
  if (!(await hasEmailAccess(userId))) {
    return emailBuyGate(
      'create and send email campaigns',
      "Launching a campaign is part of the **AI Email Outbound Engine** project. Unlock it to build the campaign from these recipients."
    );
  }

  if (!filter || Object.keys(filter).length === 0) {
    return {
      phase: 'email_flow',
      nextAction: 'respond',
      emailBrief: { ...brief, stage: 'recipients' },
      uiRequest: { type: 'email_recipients_choice', hasSearchedLeads: false },
      response: "I don't have a lead list to send to yet. Search Karya leads or upload a CSV/Excel of contacts."
    };
  }

  const recipients = await fetchEmailableLeads(filter, { limit: 500 });
  if (recipients.length === 0) {
    return {
      phase: 'email_flow',
      nextAction: 'respond',
      emailBrief: { ...brief, stage: 'recipients' },
      uiRequest: { type: 'email_recipients_choice', hasSearchedLeads: true },
      response: `None of the contacts matching ${describeFilter(filter)} have an email on file. Try a broader audience or upload a CSV.`
    };
  }

  try {
    const campaignName = brief.name || `${state.businessProfile?.companyName || 'Outreach'}`;
    const result = await createDraftCampaign({ userId, campaignName, draft: state.emailDraft, recipients });
    return {
      phase: 'email_complete',
      nextAction: 'respond',
      emailBrief: null,          // exit the modal flow
      emailDraft: null,
      emailCampaign: result,
      uiRequest: { type: 'email_campaign_created', campaign: result },
      response: `Done — I created a **draft** campaign "${result.campaignName}" for ${result.recipientCount.toLocaleString()} recipients${result.followUpTemplateId ? ' with a follow-up' : ''}. Nothing has been sent. Review and start it from your Campaigns page.`
    };
  } catch (err) {
    return {
      phase: 'email_flow',
      nextAction: 'respond',
      emailBrief: { ...brief, stage: 'recipients' },
      uiRequest: null,
      response: `I hit a problem creating the campaign: ${err.message} Want to try again?`
    };
  }
};

/**
 * emailAgentNode — conversational mirror of the manual email-outbound flow.
 *
 * Stages (tracked on state.emailBrief.stage):
 *   name → goal → tone → review → recipients → (recipients_karya)
 *
 * review  : approve → recipient choice; expert → HitlRequest (with_expert); else re-draft.
 * The flow is kept modal by orchestratorNode while emailBrief is active.
 */
const emailAgentNode = async (state) => {
  const userId = state.userId;
  const filter = state.leadsFilter || {};
  const latest = getLatest(state.messages);
  const brief = state.emailBrief || null;

  // ── ENTRY: begin the brief ───────────────────────────────────────────────
  if (!brief || !brief.stage) {
    return ask(
      "Let's set up your email campaign. First — what should we call it? (a short name like \"Q3 Healthcare Outreach\")",
      brief || {}, { stage: 'name' }
    );
  }

  // ── BRIEF COLLECTION ─────────────────────────────────────────────────────
  if (brief.stage === 'name') {
    return ask("Got it. What's the goal or offer of this campaign? (e.g. \"book demos for our scheduling tool\")",
      brief, { name: latest, stage: 'goal' });
  }

  if (brief.stage === 'goal') {
    return ask("And what tone should it take — friendly, formal, or direct?",
      brief, { goal: latest, stage: 'tone' });
  }

  if (brief.stage === 'tone') {
    const nextBrief = { ...brief, tone: latest };
    const draft = await draftFor(state, nextBrief);
    if (!draft) return ask("I had trouble drafting that. Want me to try again?", nextBrief, {});
    return {
      phase: 'email_flow',
      nextAction: 'respond',
      emailBrief: { ...nextBrief, stage: 'review' },
      emailDraft: draft,
      uiRequest: { type: 'email_draft_review', draft },
      response: `Here's a draft for "${nextBrief.name}". Review it below — approve to pick recipients, or send it to an expert to refine.`
    };
  }

  // ── REVIEW: approve / expert / tweak ─────────────────────────────────────
  if (brief.stage === 'review') {
    const draft = state.emailDraft || {};

    // Expert lane → create a HITL request and hand off to the approval pages
    if (isExpert(latest)) {
      if (!(await hasEmailAccess(userId))) {
        return emailBuyGate(
          'get expert review of your emails',
          "Expert review is part of the **AI Email Outbound Engine** project. Unlock it to have a specialist refine your emails."
        );
      }
      const audience = describeFilter(filter);
      try {
        await HitlRequest.create({
          userId,
          type: 'email_approval',
          title: brief.name || 'Outbound email',
          status: 'with_expert',
          payload: { subject: draft.subject, body: draft.body, audience, tone: brief.tone || '' },
          context: {
            tone: brief.tone || '',
            company: state.businessProfile?.companyName || '',
            audience,
            product: brief.goal || '',
            cta: '',
            campaignName: brief.name || ''
          }
        });
      } catch (err) {
        return ask(`I couldn't send it to the expert: ${err.message} Want to approve it yourself instead?`, brief, {});
      }
      return {
        phase: 'email_complete',
        nextAction: 'respond',
        emailBrief: null,
        emailDraft: null,
        uiRequest: { type: 'email_expert_sent' },
        response: "Sent to our expert to refine. You'll see the polished version on your HITL Approval page — approve it there and we'll launch the campaign with it."
      };
    }

    // Approve → move to recipient choice
    if (isApprove(latest)) {
      return {
        phase: 'email_flow',
        nextAction: 'respond',
        emailBrief: { ...brief, stage: 'recipients' },
        uiRequest: { type: 'email_recipients_choice', hasSearchedLeads: Object.keys(filter).length > 0 },
        response: "Great. Who should this go to? Pick a recipient source below."
      };
    }

    // Anything else = a revision instruction → re-draft
    const revised = await draftFor(state, { ...brief, revision: latest });
    if (!revised) return ask("Couldn't revise that — want to try again, or approve the current draft?", brief, {});
    return {
      phase: 'email_flow',
      nextAction: 'respond',
      emailBrief: brief,
      emailDraft: revised,
      uiRequest: { type: 'email_draft_review', draft: revised },
      response: "Updated the draft — take a look."
    };
  }

  // ── RECIPIENTS: choose a source ──────────────────────────────────────────
  if (brief.stage === 'recipients') {
    if (wantsCsv(latest)) {
      return {
        phase: 'email_flow',
        nextAction: 'respond',
        emailBrief: { ...brief, stage: 'recipients' },
        uiRequest: { type: 'email_csv_upload' },
        response: "Upload a CSV or Excel of your contacts (it needs an email column). I'll build the campaign from it."
      };
    }
    if (wantsKarya(latest)) {
      return ask("Describe who to target and I'll pull the list — e.g. \"CTOs at healthcare companies in the US\".",
        brief, { stage: 'recipients_karya' });
    }
    // Default → use the current searched leads
    return buildFromFilter(state, brief, filter, userId);
  }

  // ── RECIPIENTS via a fresh Karya search ──────────────────────────────────
  // The router populated leadsFilter from the audience description this turn.
  if (brief.stage === 'recipients_karya') {
    return buildFromFilter(state, brief, state.leadsFilter || {}, userId);
  }

  // Fallback
  return ask("Want to keep setting up the email campaign?", brief, {});
};

module.exports = { emailAgentNode };
