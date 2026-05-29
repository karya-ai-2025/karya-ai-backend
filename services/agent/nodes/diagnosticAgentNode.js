const { generateGapDiagnostic } = require('../../anthropicService');
const { createBusinessEvidence } = require('../evidencePersistence');
const {
  buildGapBasedProjectRecommendations,
  buildBusinessReview,
  getMarketplaceProjectsForPlanner
} = require('../projectCatalogService');
const { persistProjectRecommendations } = require('../recommendationPersistence');

const scoreArea = (score, signals) => ({
  score,
  signals: Array.isArray(signals) && signals.length > 0 ? signals : ['Not enough evidence yet.']
});

const buildFallbackDiagnostic = (state) => {
  const evidence = createBusinessEvidence(state.businessEvidence);
  const evidenceUsed = ['profile', 'goal'];
  if (evidence.websites.length > 0) evidenceUsed.push('website');

  return {
    summary: 'The review is based on the profile, confirmed goal, and website context collected so far. The strongest next step is to tighten the path from awareness to qualified pipeline.',
    scores: {
      awareness: scoreArea(5, ['Positioning and market visibility need sharper proof.']),
      discovery: scoreArea(4, ['The conversion path and lead capture motion need more structure.']),
      connect: scoreArea(4, ['Outbound or direct engagement process needs to be made repeatable.']),
      qualify: scoreArea(5, ['ICP is present but qualification criteria should be clearer.']),
      convert: scoreArea(4, ['Conversion proof, case studies, and sales assets need strengthening.']),
      retain: scoreArea(5, ['Retention and expansion motion is not yet clearly evidenced.'])
    },
    overallScore: 4.5,
    topGaps: ['Discovery path', 'Connect motion', 'Conversion proof'],
    evidenceUsed
  };
};

const normalizeDiagnostic = (diagnostic, state) => {
  const fallback = buildFallbackDiagnostic(state);
  const scores = diagnostic?.scores || {};

  return {
    summary: diagnostic?.summary || fallback.summary,
    awareness: scoreArea(scores.awareness?.score || fallback.scores.awareness.score, scores.awareness?.signals),
    discovery: scoreArea(scores.discovery?.score || fallback.scores.discovery.score, scores.discovery?.signals),
    connect: scoreArea(scores.connect?.score || fallback.scores.connect.score, scores.connect?.signals),
    qualify: scoreArea(scores.qualify?.score || fallback.scores.qualify.score, scores.qualify?.signals),
    convert: scoreArea(scores.convert?.score || fallback.scores.convert.score, scores.convert?.signals),
    retain: scoreArea(scores.retain?.score || fallback.scores.retain.score, scores.retain?.signals),
    overallScore: Number(diagnostic?.overallScore || fallback.overallScore),
    topGaps: Array.isArray(diagnostic?.topGaps) && diagnostic.topGaps.length > 0 ? diagnostic.topGaps : fallback.topGaps,
    evidenceUsed: Array.isArray(diagnostic?.evidenceUsed) && diagnostic.evidenceUsed.length > 0 ? diagnostic.evidenceUsed : fallback.evidenceUsed,
    generatedAt: new Date().toISOString()
  };
};

const formatBusinessReviewResponse = (review) => {
  const lines = [
    'Here are the areas where Karya AI can help:',
    '',
    review.summary,
    '',
    ...(review.helpAreas || []).map((area, index) => [
      `**${index + 1}. ${area.title}**`,
      area.whyItMatters,
      area.project ? `Project match: ${area.project.title}` : ''
    ].filter(Boolean).join('\n')),
    '',
    'If this direction looks right, generate the full 30-60-90 day plan.'
  ];

  return lines.filter(Boolean).join('\n\n');
};

const diagnosticAgentNode = async (state) => {
  let gapScores;
  let recommendedProjects = [];

  try {
    const diagnostic = await generateGapDiagnostic({ state });
    gapScores = normalizeDiagnostic(diagnostic, state);
  } catch (error) {
    gapScores = normalizeDiagnostic(null, state);
  }

  let marketplaceProjects = [];
  try {
    marketplaceProjects = await getMarketplaceProjectsForPlanner();
  } catch {
    marketplaceProjects = [];
  }

  recommendedProjects = buildGapBasedProjectRecommendations({
    state,
    gapScores,
    marketplaceProjects,
    limit: 3
  });

  try {
    await persistProjectRecommendations({
      state,
      gapScores,
      recommendations: recommendedProjects
    });
  } catch {
    // Recommendation persistence should not block the user-facing review.
  }

  const businessReview = buildBusinessReview({
    state,
    gapScores,
    marketplaceProjects,
    recommendedProjects
  });

  return {
    gapScores,
    businessReview,
    phase: 'business_review',
    nextAction: 'await_plan_generation',
    uiRequest: {
      type: 'business_review',
      businessReview,
      options: [
        { label: 'Generate Plan', value: 'generate_plan', message: 'Generate Plan' }
      ]
    },
    response: formatBusinessReviewResponse(businessReview)
  };
};

module.exports = {
  diagnosticAgentNode
};
