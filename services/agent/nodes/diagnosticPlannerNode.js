const { detectDiagnosticRunIntent } = require('../extractors');
const {
  addEvidenceToState,
  createBusinessEvidence,
  saveWebsiteEvidence
} = require('../evidencePersistence');

const getLatestUserMessage = (messages = []) => {
  const latest = [...messages].reverse().find((message) => message.role === 'user');
  return latest?.content || '';
};

const normalizeWebsiteForCompare = (url) => {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).toString();
  } catch {
    return raw;
  }
};

const buildDiagnosticIntakeUiRequest = (businessEvidence) => ({
  type: 'diagnostic_intake',
  websitesCount: businessEvidence.websites.length,
  options: [
    { label: 'Continue without website', value: 'run_business_review', message: 'Continue without website' }
  ]
});

const buildEvidenceReviewUiRequest = (businessEvidence) => ({
  type: 'evidence_review',
  businessEvidence,
  options: [
    { label: 'Confirm website summary', value: 'confirm_evidence', message: 'Confirm website summary' },
    { label: 'Edit summary', value: 'edit_evidence', message: 'Edit evidence summary' }
  ]
});

const detectEvidenceConfirmIntent = (message) => (
  /\b(confirm|correct|yes|looks good|right)\b/i.test(String(message || ''))
);

const detectEvidenceEditIntent = (message) => (
  /\b(edit|change|correct|revise|not right|wrong|update summary)\b/i.test(String(message || ''))
);

const buildEvidenceSummary = (businessEvidence) => {
  const parts = [];
  if (businessEvidence.websites.length > 0) {
    parts.push(`${businessEvidence.websites.length} website${businessEvidence.websites.length === 1 ? '' : 's'}`);
  }

  return parts.length > 0 ? parts.join(' and ') : 'your profile and confirmed goal';
};

const formatEvidenceReview = (businessEvidence) => {
  const summaries = (businessEvidence.websites || []).map((website) => ({
    label: website.url,
    summary: website.summary
  })).filter((item) => item.summary);

  if (summaries.length === 0) {
    return '';
  }

  const correctionText = businessEvidence.userCorrections?.length
    ? `\n\nUser correction added:\n${businessEvidence.userCorrections[businessEvidence.userCorrections.length - 1]}`
    : '';

  return [
    'Here is what I understood from your website:',
    '',
    ...summaries.map((item) => `**${item.label}**\n${item.summary}`),
    correctionText,
    '',
    'Is this correct? Confirm it and I will show where Karya AI can help, or edit it so I use the right business context.'
  ].filter(Boolean).join('\n\n');
};

const diagnosticPlannerNode = async (state) => {
  const latestMessage = getLatestUserMessage(state.messages);
  let workingState = {
    ...state,
    businessEvidence: createBusinessEvidence(state.businessEvidence)
  };

  if (
    workingState.businessProfile?.website
    && !(workingState.businessEvidence.websites || []).some((website) => (
      normalizeWebsiteForCompare(website.url) === normalizeWebsiteForCompare(workingState.businessProfile.website)
    ))
  ) {
    workingState.businessEvidence.websites = [
      ...(workingState.businessEvidence.websites || []),
      {
        kind: 'website',
        url: normalizeWebsiteForCompare(workingState.businessProfile.website),
        status: 'pending_save',
        addedAt: new Date().toISOString()
      }
    ];
  }

  for (const website of workingState.businessEvidence.websites || []) {
    if (website.status !== 'pending_save' || !website.url) continue;

    try {
      const saved = await saveWebsiteEvidence({
        user: workingState.userId,
        conversationId: workingState.conversationId,
        url: website.url
      });
      workingState = addEvidenceToState(workingState, saved);
    } catch {
      workingState.businessEvidence.websites = workingState.businessEvidence.websites.map((item) => (
        item.url === website.url ? { ...item, status: 'failed' } : item
      ));
    }
  }

  workingState.businessEvidence.websites = (workingState.businessEvidence.websites || [])
    .filter((website) => website.status !== 'pending_save')
    .filter((website, index, all) => all.findIndex((item) => item.url === website.url) === index);

  const businessEvidence = createBusinessEvidence(workingState.businessEvidence);
  const hasPendingWebsite = businessEvidence.websites.some((website) => website.status === 'pending_save');
  const hasEvidence = businessEvidence.websites.length > 0;
  const hasReviewableEvidence = businessEvidence.websites.some((website) => website.summary)
    || businessEvidence.userCorrections.length > 0;

  if (businessEvidence.reviewStatus === 'editing') {
    const updatedEvidence = {
      ...businessEvidence,
      reviewStatus: 'pending',
      userCorrections: [
        ...businessEvidence.userCorrections,
        latestMessage
      ].filter(Boolean)
    };

    return {
      phase: 'diagnostic_intake',
      nextAction: 'collect_evidence',
      missingField: null,
      uiRequest: buildEvidenceReviewUiRequest(updatedEvidence),
      businessEvidence: updatedEvidence,
      response: formatEvidenceReview(updatedEvidence)
    };
  }

  if (hasReviewableEvidence && detectEvidenceEditIntent(latestMessage)) {
    return {
      phase: 'diagnostic_intake',
      nextAction: 'collect_evidence',
      missingField: null,
      uiRequest: null,
      businessEvidence: {
        ...businessEvidence,
        reviewStatus: 'editing'
      },
      response: 'Please send the correction or missing context I should use for the growth plan.'
    };
  }

  if (hasReviewableEvidence && detectEvidenceConfirmIntent(latestMessage)) {
    return {
      phase: 'gap_diagnostic',
      nextAction: 'run_diagnostic',
      missingField: null,
      uiRequest: null,
      businessEvidence: {
        ...businessEvidence,
        reviewStatus: 'confirmed',
        intakeStatus: 'ready'
      },
      response: ''
    };
  }

  if (detectDiagnosticRunIntent(latestMessage)) {
    if (hasReviewableEvidence && businessEvidence.reviewStatus !== 'confirmed') {
      return {
        phase: 'diagnostic_intake',
        nextAction: 'collect_evidence',
        missingField: null,
        uiRequest: buildEvidenceReviewUiRequest(businessEvidence),
        businessEvidence: {
          ...businessEvidence,
          reviewStatus: 'pending'
        },
        response: formatEvidenceReview(businessEvidence)
      };
    }

    return {
      phase: 'gap_diagnostic',
      nextAction: 'run_diagnostic',
      missingField: null,
      uiRequest: null,
      businessEvidence: {
        ...businessEvidence,
        intakeStatus: hasEvidence ? 'ready' : 'skipped'
      },
      response: ''
    };
  }

  if (hasPendingWebsite) {
    return {
      phase: 'diagnostic_intake',
      nextAction: 'collect_evidence',
      missingField: null,
      uiRequest: hasReviewableEvidence ? buildEvidenceReviewUiRequest(businessEvidence) : buildDiagnosticIntakeUiRequest(businessEvidence),
      businessEvidence,
      response: hasReviewableEvidence
        ? formatEvidenceReview(businessEvidence)
        : 'I saved the website for the business review. You can share another website or continue to the business review now.'
    };
  }

  if (hasReviewableEvidence && businessEvidence.reviewStatus === 'pending') {
    return {
      phase: 'diagnostic_intake',
      nextAction: 'collect_evidence',
      missingField: null,
      uiRequest: buildEvidenceReviewUiRequest(businessEvidence),
      businessEvidence,
      response: formatEvidenceReview(businessEvidence)
    };
  }

  return {
    phase: 'diagnostic_intake',
    nextAction: 'collect_evidence',
    missingField: null,
    uiRequest: buildDiagnosticIntakeUiRequest(businessEvidence),
    businessEvidence,
    response: `Share your business website so I can understand the business better. You can also continue without a website and I will use ${buildEvidenceSummary(businessEvidence)}.`
  };
};

module.exports = {
  diagnosticPlannerNode
};
