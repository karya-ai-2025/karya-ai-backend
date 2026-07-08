const Anthropic = require('@anthropic-ai/sdk');
const { config } = require('../config/config');

const SUPPORT_SYSTEM_PROMPT = `
You are Karya AI's in-app support assistant.

Your job:
- Help authenticated Karya AI users understand the platform and decide where to go next.
- Answer support questions clearly and concisely.
- Ask one focused follow-up question when the user's request is ambiguous.
- If the user asks you to create projects, generate PPTs, run campaigns, change billing, or modify account data, explain that you can guide them for now but cannot execute that action yet.
- Do not claim that background work has been completed unless a tool or backend response confirms it.
- Keep responses practical, friendly, and under 180 words unless the user asks for detail.

Safety:
- Do not ask for passwords, API keys, payment card numbers, or private credentials.
- Do not invent product capabilities. If unsure, say what you can help with next.
`.trim();

const GOAL_DEFINITION_SYSTEM_PROMPT = `
You extract and clarify Karya AI agent goals.

Return only valid JSON with this shape:
{
  "type": "pipeline" | "conversion" | "revenue" | "process" | "matching" | "availability" | "expert_preference" | "growth",
  "description": "short clear goal",
  "timeframeDays": 30 | 60 | 90 | null,
  "targetMetric": "measurable target or empty string",
  "isClear": true | false,
  "clarificationQuestion": "one focused question or null"
}

Rules:
- Do not ask for passwords, secrets, or payment details.
- For business users, prefer 30, 60, or 90 day outcomes.
- For expert users, focus on project/client matching preferences and weekly capacity.
- Mark isClear true only when the goal has enough detail for a business review or matching step.
- If unclear, ask exactly one concise follow-up question.
`.trim();

const GAP_DIAGNOSTIC_SYSTEM_PROMPT = `
You are Karya AI's business gap review analyst.

Return only valid JSON:
{
  "summary": "short plain-English business review",
  "scores": {
    "awareness": { "score": 1-10, "signals": ["..."] },
    "discovery": { "score": 1-10, "signals": ["..."] },
    "connect": { "score": 1-10, "signals": ["..."] },
    "qualify": { "score": 1-10, "signals": ["..."] },
    "convert": { "score": 1-10, "signals": ["..."] },
    "retain": { "score": 1-10, "signals": ["..."] }
  },
  "overallScore": 1-10,
  "topGaps": ["..."],
  "evidenceUsed": ["profile", "goal", "website"]
}

Rules:
- Score lower when the available evidence is thin or unclear.
- Use only the provided profile, goal, chat, website metadata, and website summaries/signals.
- Do not pretend you crawled a site. Website URLs are stored evidence unless crawler summaries are explicitly present.
- Keep signals concrete and useful for a 30-60-90 day plan.
`.trim();

const PLAN_SYSTEM_PROMPT = `
You are Karya AI's 30-60-90 day growth planner.

Return only valid JSON:
{
  "summary": "short plan summary",
  "diagnosis": "one sentence describing the main issue",
  "timeline": [
    {
      "phase": "30 days",
      "focus": "...",
      "actions": ["..."],
      "outputs": ["..."]
    },
    {
      "phase": "60 days",
      "focus": "...",
      "actions": ["..."],
      "outputs": ["..."]
    },
    {
      "phase": "90 days",
      "focus": "...",
      "actions": ["..."],
      "outputs": ["..."]
    }
  ],
  "recommendedProjects": [
    {
      "slug": "short-kebab-slug",
      "title": "...",
      "phase": "30 days" | "60 days" | "90 days",
      "priority": 1,
      "rationale": "...",
      "expectedOutput": "..."
    }
  ],
  "kpis": [
    { "name": "...", "target": "..." }
  ],
  "nextStep": "..."
}

Rules:
- Build the plan to achieve the confirmed goal.
- Tie actions to the largest business gaps.
- Keep it practical for a Karya project workflow.
- Recommend projects only from availableMarketplaceProjects. Use exact slug and title from that list.
- Include the one project the user should pick first as priority 1.
- Do not use the word "diagnostic" in summary, actions, rationale, or nextStep. Say "business review" or "gap review" instead.
- Include exactly three KPI objects.
`.trim();

const EVIDENCE_SUMMARY_SYSTEM_PROMPT = `
You summarize business evidence for Karya AI business reviews.

Return only valid JSON:
{
  "summary": "short business-focused summary",
  "signals": [
    { "label": "ICP", "value": "..." },
    { "label": "Offer", "value": "..." },
    { "label": "Channels", "value": "..." }
  ]
}

Rules:
- Extract only useful business review details.
- Prefer concrete details about customers, offer, market, channels, proof, pricing, goals, constraints, metrics, and conversion path.
- Do not include secrets, passwords, API keys, or payment details.
- Keep the summary under 180 words.
- Return at most 8 signals.
`.trim();

const INTENT_ROUTER_SYSTEM_PROMPT = `
You route Karya AI agent interruptions.

Return only valid JSON:
{
  "intent": "continue" | "change_goal" | "add_diagnostic_evidence" | "rerun_diagnostic" | "regenerate_plan" | "find_marketplace_project",
  "confidence": 0.0-1.0,
  "reason": "short reason"
}

Intent meanings:
- continue: normal answer to the current agent question.
- change_goal: user wants to change/revise/start over their goal.
- add_diagnostic_evidence: user wants to add a website URL or use new website business context for the business review.
- rerun_diagnostic: user wants the business review again or wants to create the plan again after new context.
- regenerate_plan: user wants only the 30-60-90 plan rebuilt, without changing goal/evidence.
- find_marketplace_project: user asks which Karya project/service/tool fits a specific need, capability, KPI, workflow, or outcome.

Rules:
- Be conservative. If the message is just answering onboarding or goal questions, choose continue.
- If the user asks to provide a website URL for review or planning at any phase, choose add_diagnostic_evidence.
- If the user says "review again" or "create the plan again", choose rerun_diagnostic.
- If the user says "change my goal" or gives a new goal explicitly after a plan exists, choose change_goal.
- If the user says "redo the plan" or "update the plan", choose regenerate_plan.
- If the user asks "which project/service should I use for X", "I need a service for X", or "do you have a project for X", choose find_marketplace_project.
- Do not choose find_marketplace_project when the user is simply confirming a recommended project already shown in the plan.
`.trim();

// Built dynamically at call time so new capabilities auto-appear in the prompt
const buildContextExtractionSystemPrompt = (capabilitiesDescription) => `
You are a context extractor for Karya AI, a B2B growth platform.

Read the user message and conversation context. Return ONE JSON object that:
1. Detects if the user is interrupting the current flow (interruptType)
2. Matches the message to an available platform capability (matchedCapabilityId)
3. Extracts every field explicitly stated in the message (extractedFields)

Return only valid JSON, no explanation:
{
  "interruptType": null | "change_goal" | "add_diagnostic_evidence" | "rerun_diagnostic" | "regenerate_plan",
  "matchedCapabilityId": null | "<id from the capabilities list below>",
  "confidence": 0.0-1.0,
  "reasoning": "one sentence",
  "extractedFields": {
    "name": null,
    "email": null,
    "phone": null,
    "userType": null,
    "companyName": null,
    "website": null,
    "industry": null,
    "targetCustomer": null,
    "goalDescription": null,
    "goalTimeframeDays": null,
    "goalTargetMetric": null,
    "industry": null,
    "location": null,
    "segment": null,
    "seniority": null,
    "title": null,
    "company": null,
    "need": null
  },
  "unmetNeed": null
}

Interrupt rules (check these first):
- change_goal: user explicitly says they want to change, revise, or replace their goal
- add_diagnostic_evidence: user wants to add a website URL for business review
- rerun_diagnostic: user wants to redo the business review from scratch
- regenerate_plan: user wants to rebuild only the 30-60-90 plan
- If none of these apply, set interruptType to null

Available platform capabilities (match matchedCapabilityId to one of these ids):
${capabilitiesDescription}

Capability matching rules:
- Only set matchedCapabilityId when confidence > 0.65
- If the message is a short reply to the agent's last question (yes, no, a name, a number): set matchedCapabilityId null
- If the user wants something not in the capabilities list: set matchedCapabilityId null and describe it in unmetNeed
- unmetNeed: short plain description of what the user wants that no capability covers, or null

Field extraction rules:
- Only extract what is EXPLICITLY stated. Never guess.
- Return null for any field not in the message.
- userType: "business" = running a company/startup. "expert" = consultant/freelancer/agency. null if unclear.
- goalTimeframeDays: 30, 60, or 90 only. "2 months"=60, "a quarter"=90, "next month"=30.
- segment: one of — startup, smb, small business, mid-market, enterprise, large enterprise
- seniority: one of — decision maker, c-suite, vp, director, manager, senior ic, individual contributor
- title: a SPECIFIC job title the user names (e.g. "project manager", "head of sales", "devops engineer"). Use this for concrete roles. Use seniority only for the broad levels listed above. If the user names an exact role (e.g. "project managers"), set title and leave seniority null. If they say a broad level (e.g. "decision makers"), set seniority and leave title null.
`.trim();

let anthropicClient;

const requireAnthropicConfig = (key, value) => {
  if (value === undefined || value === null || value === '') {
    throw createAnthropicError(
      `${key} is not configured. Add it to the backend .env file and restart the server.`,
      503,
      'ANTHROPIC_NOT_CONFIGURED'
    );
  }

  return value;
};

const getAnthropicClient = () => {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: requireAnthropicConfig('ANTHROPIC_API_KEY', config.anthropic.apiKey),
      timeout: requireAnthropicConfig('ANTHROPIC_TIMEOUT_MS', config.anthropic.timeoutMs),
      maxRetries: requireAnthropicConfig('ANTHROPIC_MAX_RETRIES', config.anthropic.maxRetries),
      defaultHeaders: {
        'anthropic-version': requireAnthropicConfig('ANTHROPIC_API_VERSION', config.anthropic.apiVersion)
      }
    });
  }

  return anthropicClient;
};

const mapStoredMessagesToClaude = (messages = []) => {
  return messages
    .filter((message) => ['user', 'agent'].includes(message.role))
    .slice(-30)
    .map((message) => ({
      role: message.role === 'agent' ? 'assistant' : 'user',
      content: message.content
    }));
};

const extractText = (message) => {
  if (!Array.isArray(message?.content)) return '';

  return message.content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
};

const parseJsonObject = (text) => {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
};

function createAnthropicError(message, statusCode = 500, code = 'ANTHROPIC_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

const normalizeModel = (model) => {
  const trimmedModel = requireAnthropicConfig('ANTHROPIC_MODEL', model).trim();

  if (/^gpt-/i.test(trimmedModel)) {
    throw createAnthropicError(
      `ANTHROPIC_MODEL is set to "${trimmedModel}", but this endpoint calls Anthropic. Use a valid Claude model ID.`,
      500,
      'ANTHROPIC_MODEL_INVALID'
    );
  }

  if (/^(us|eu|apac|global)\.anthropic\./i.test(trimmedModel) || /^anthropic\./i.test(trimmedModel) || /-v\d+:\d+$/i.test(trimmedModel)) {
    throw createAnthropicError(
      `ANTHROPIC_MODEL is set to "${trimmedModel}", which looks like an AWS Bedrock model ID. This service uses the direct Anthropic SDK, so set ANTHROPIC_MODEL to a direct Claude model ID.`,
      500,
      'ANTHROPIC_MODEL_INVALID'
    );
  }

  return trimmedModel;
};

const normalizeSdkError = (error) => {
  if (error.code && error.statusCode) return error;

  const statusCode = error.status || error.statusCode || 500;
  const code = error.code || error.error?.type || 'ANTHROPIC_ERROR';
  const message = error.message || 'Anthropic SDK request failed.';

  return createAnthropicError(message, statusCode, code);
};

const generateSupportReply = async ({ messages }) => {
  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: normalizeModel(config.anthropic.model),
      max_tokens: requireAnthropicConfig('ANTHROPIC_MAX_TOKENS', config.anthropic.maxTokens),
      system: SUPPORT_SYSTEM_PROMPT,
      messages: mapStoredMessagesToClaude(messages)
    });

    const reply = extractText(response);
    if (!reply) {
      throw createAnthropicError('Anthropic returned an empty response.');
    }

    return reply;
  } catch (error) {
    throw normalizeSdkError(error);
  }
};

const buildGoalDefinitionPrompt = ({ state }) => {
  const profile = state.userType === 'expert' ? state.expertProfile : state.businessProfile;

  return JSON.stringify({
  userType: state.userType,
  memorySummary: state.memorySummary,
  profile,
    currentGoal: state.goal,
    recentMessages: (state.messages || [])
      .filter((message) => ['user', 'agent'].includes(message.role))
      .slice(-8)
      .map((message) => ({
        role: message.role,
        content: message.content
      }))
  }, null, 2);
};

const buildPlanningContext = ({ state, marketplaceProjects = [] }) => JSON.stringify({
  userType: state.userType,
  memorySummary: state.memorySummary,
  identity: state.identity,
  businessProfile: state.businessProfile,
  expertProfile: state.expertProfile,
  goal: state.goal,
  businessEvidence: state.businessEvidence,
  gapScores: state.gapScores,
  businessReview: state.businessReview,
  availableMarketplaceProjects: marketplaceProjects,
  recentMessages: (state.messages || [])
    .filter((message) => ['user', 'agent'].includes(message.role))
    .slice(-10)
    .map((message) => ({
      role: message.role,
      content: message.content
    }))
}, null, 2);

const buildEvidenceSummaryPrompt = ({ sourceName, sourceType, extractedText }) => JSON.stringify({
  sourceName,
  sourceType,
  extractedText: String(extractedText || '').slice(0, 18000)
}, null, 2);

const getLatestUserContent = (messages = []) => {
  const latest = [...messages].reverse().find((message) => message.role === 'user');
  return latest?.content || '';
};

const buildIntentPrompt = ({ state }) => JSON.stringify({
  currentPhase: state.phase,
  nextAction: state.nextAction,
  memorySummary: state.memorySummary,
  hasGoal: Boolean(state.goal?.description),
  goalConfirmed: Boolean(state.goal?.confirmed),
  hasDiagnostic: Boolean(state.gapScores),
  hasPlan: Boolean(state.plan),
  hasEvidence: Boolean((state.businessEvidence?.websites || []).length),
  latestUserMessage: getLatestUserContent(state.messages),
  recentMessages: (state.messages || [])
    .filter((message) => ['user', 'agent'].includes(message.role))
    .slice(-6)
    .map((message) => ({
      role: message.role,
      content: message.content
    }))
}, null, 2);

const generateGoalDefinition = async ({ state }) => {
  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: normalizeModel(config.anthropic.model),
      max_tokens: Math.min(requireAnthropicConfig('ANTHROPIC_MAX_TOKENS', config.anthropic.maxTokens), 900),
      system: GOAL_DEFINITION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildGoalDefinitionPrompt({ state })
        }
      ]
    });

    const parsed = parseJsonObject(extractText(response));
    if (!parsed || typeof parsed !== 'object') {
      throw createAnthropicError('Anthropic returned an invalid goal definition response.');
    }

    return {
      type: parsed.type,
      description: parsed.description,
      timeframeDays: parsed.timeframeDays === null || parsed.timeframeDays === undefined
        ? null
        : Number(parsed.timeframeDays),
      targetMetric: parsed.targetMetric || '',
      isClear: Boolean(parsed.isClear),
      clarificationQuestion: parsed.clarificationQuestion || null
    };
  } catch (error) {
    throw normalizeSdkError(error);
  }
};

const routeAgentIntent = async ({ state }) => {
  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: normalizeModel(config.anthropic.model),
      max_tokens: Math.min(requireAnthropicConfig('ANTHROPIC_MAX_TOKENS', config.anthropic.maxTokens), 500),
      system: INTENT_ROUTER_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildIntentPrompt({ state })
        }
      ]
    });

    const parsed = parseJsonObject(extractText(response));
    if (!parsed || typeof parsed !== 'object') {
      throw createAnthropicError('Anthropic returned an invalid intent routing response.');
    }

    return {
      intent: parsed.intent || 'continue',
      confidence: Number(parsed.confidence || 0),
      reason: parsed.reason || ''
    };
  } catch (error) {
    throw normalizeSdkError(error);
  }
};

const generateGapDiagnostic = async ({ state }) => {
  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: normalizeModel(config.anthropic.model),
      max_tokens: Math.min(requireAnthropicConfig('ANTHROPIC_MAX_TOKENS', config.anthropic.maxTokens), 1800),
      system: GAP_DIAGNOSTIC_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildPlanningContext({ state })
        }
      ]
    });

    const parsed = parseJsonObject(extractText(response));
    if (!parsed || typeof parsed !== 'object') {
      throw createAnthropicError('Anthropic returned an invalid diagnostic response.');
    }

    return parsed;
  } catch (error) {
    throw normalizeSdkError(error);
  }
};

const generateThirtySixtyNinetyPlan = async ({ state, marketplaceProjects = [] }) => {
  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: normalizeModel(config.anthropic.model),
      max_tokens: Math.min(requireAnthropicConfig('ANTHROPIC_MAX_TOKENS', config.anthropic.maxTokens), 2200),
      system: PLAN_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildPlanningContext({ state, marketplaceProjects })
        }
      ]
    });

    const parsed = parseJsonObject(extractText(response));
    if (!parsed || typeof parsed !== 'object') {
      throw createAnthropicError('Anthropic returned an invalid 30-60-90 plan response.');
    }

    return parsed;
  } catch (error) {
    throw normalizeSdkError(error);
  }
};

const generateEvidenceSummary = async ({ sourceName, sourceType = 'website', extractedText }) => {
  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: normalizeModel(config.anthropic.model),
      max_tokens: Math.min(requireAnthropicConfig('ANTHROPIC_MAX_TOKENS', config.anthropic.maxTokens), 900),
      system: EVIDENCE_SUMMARY_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildEvidenceSummaryPrompt({
            sourceName,
            sourceType,
            extractedText
          })
        }
      ]
    });

    const parsed = parseJsonObject(extractText(response));
    if (!parsed || typeof parsed !== 'object') {
      throw createAnthropicError('Anthropic returned an invalid evidence summary response.');
    }

    return {
      summary: parsed.summary || '',
      signals: Array.isArray(parsed.signals) ? parsed.signals.slice(0, 8) : []
    };
  } catch (error) {
    throw normalizeSdkError(error);
  }
};

const buildContextExtractionPrompt = ({ state }) => JSON.stringify({
  currentPhase: state.phase,
  nextAction: state.nextAction,
  hasGoal: Boolean(state.goal?.description),
  goalConfirmed: Boolean(state.goal?.confirmed),
  hasPlan: Boolean(state.plan),
  knownFields: {
    name:           state.identity?.name           || null,
    email:          state.identity?.email          || null,
    companyName:    state.businessProfile?.companyName    || null,
    industry:       state.businessProfile?.industry       || null,
    targetCustomer: state.businessProfile?.targetCustomer || null
  },
  latestUserMessage: getLatestUserContent(state.messages),
  recentMessages: (state.messages || [])
    .filter((m) => ['user', 'agent'].includes(m.role))
    .slice(-6)
    .map((m) => ({ role: m.role, content: m.content }))
}, null, 2);

const extractMessageContext = async ({ state, capabilitiesDescription }) => {
  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: normalizeModel(config.anthropic.model),
      max_tokens: Math.min(requireAnthropicConfig('ANTHROPIC_MAX_TOKENS', config.anthropic.maxTokens), 800),
      system: buildContextExtractionSystemPrompt(capabilitiesDescription || ''),
      messages: [{ role: 'user', content: buildContextExtractionPrompt({ state }) }]
    });

    const raw = extractText(response);
    console.log('[extractMessageContext] RAW Claude output:', raw);

    const parsed = parseJsonObject(raw);
    if (!parsed || typeof parsed !== 'object') {
      console.log('[extractMessageContext] Failed to parse JSON from Claude');
      return null;
    }

    console.log('[extractMessageContext] Parsed result:', JSON.stringify(parsed, null, 2));

    return {
      interruptType:         parsed.interruptType         || null,
      matchedCapabilityId:   parsed.matchedCapabilityId   || null,
      confidence:            Number(parsed.confidence     || 0),
      reasoning:             parsed.reasoning             || '',
      extractedFields:       parsed.extractedFields       || {},
      unmetNeed:             parsed.unmetNeed             || null
    };
  } catch (err) {
    console.log('[extractMessageContext] Claude call threw error:', err?.message || err);
    return null;
  }
};

// ── Email campaign copywriter ────────────────────────────────────────────────
// Drafts a primary cold email + one follow-up. Placeholders are limited to the
// keys that campaignProcessor.personalizeContent actually fills.
const EMAIL_PLACEHOLDERS = ['firstName', 'lastName', 'fullName', 'company', 'jobTitle', 'industry'];

const buildEmailCopySystemPrompt = () => `
You are a senior B2B cold-email copywriter for Karya AI.
Write a short outbound sequence: one primary email + one follow-up.

Return ONLY valid JSON, no explanation:
{
  "subject": "primary subject line",
  "body": "primary email body",
  "followUpSubject": "follow-up subject line",
  "followUpBody": "follow-up email body"
}

Rules:
- Personalization: you MAY use ONLY these placeholders, in curly braces: ${EMAIL_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}.
  Never invent other placeholders. Always open with {firstName}.
- Primary email: 90-140 words, plain text, one clear call to action, no fluff, no emoji, no markdown.
- Follow-up: 40-70 words, references the first email lightly ("following up on my note"), one CTA.
- Sound human and specific to the recipient's industry. No spammy phrases ("act now", "limited time").
- Do not include a subject prefix like "Subject:". Just the text.
`.trim();

const buildEmailCopyPrompt = ({ state, audienceSummary, recipientCount, instruction }) => JSON.stringify({
  sender: {
    company: state.businessProfile?.companyName || null,
    industry: state.businessProfile?.industry || null,
    website: state.businessProfile?.website || null,
    valueProposition: state.businessProfile?.targetCustomer || null,
    goal: state.goal?.description || null
  },
  audience: audienceSummary || null,
  recipientCount: recipientCount || null,
  userInstruction: instruction || null
}, null, 2);

const generateEmailCampaignCopy = async ({ state, audienceSummary, recipientCount, instruction }) => {
  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: normalizeModel(config.anthropic.model),
      max_tokens: Math.min(requireAnthropicConfig('ANTHROPIC_MAX_TOKENS', config.anthropic.maxTokens), 1500),
      system: buildEmailCopySystemPrompt(),
      messages: [{ role: 'user', content: buildEmailCopyPrompt({ state, audienceSummary, recipientCount, instruction }) }]
    });

    const raw = extractText(response);
    const parsed = parseJsonObject(raw);
    if (!parsed || !parsed.subject || !parsed.body) return null;

    return {
      subject:         String(parsed.subject).trim(),
      body:            String(parsed.body).trim(),
      followUpSubject: parsed.followUpSubject ? String(parsed.followUpSubject).trim() : '',
      followUpBody:    parsed.followUpBody ? String(parsed.followUpBody).trim() : ''
    };
  } catch (err) {
    console.log('[generateEmailCampaignCopy] failed:', err?.message || err);
    return null;
  }
};

module.exports = {
  generateSupportReply,
  generateGoalDefinition,
  routeAgentIntent,
  generateGapDiagnostic,
  generateThirtySixtyNinetyPlan,
  generateEvidenceSummary,
  extractMessageContext,
  generateEmailCampaignCopy
};
