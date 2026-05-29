const { randomUUID } = require('crypto');
const AgentProjectRecommendation = require('../../models/AgentProjectRecommendation');
const { getRequirementSummary } = require('./projectCatalogService');

const GAP_AREAS = ['awareness', 'discovery', 'connect', 'qualify', 'convert', 'retain'];

const buildGapSnapshot = (gapScores = {}) => ({
  overallScore: Number(gapScores.overallScore || 0),
  topGaps: Array.isArray(gapScores.topGaps) ? gapScores.topGaps : [],
  areas: GAP_AREAS.reduce((snapshot, area) => ({
    ...snapshot,
    [area]: {
      score: Number(gapScores?.[area]?.score || 0),
      signals: Array.isArray(gapScores?.[area]?.signals) ? gapScores[area].signals : []
    }
  }), {})
});

const persistProjectRecommendations = async ({
  state,
  gapScores,
  recommendations = []
}) => {
  if (!state?.userId || !state?.conversationId || !Array.isArray(recommendations) || recommendations.length === 0) {
    return [];
  }

  const businessGoal = state.goal?.description || '';
  const requirementSummary = getRequirementSummary(state);
  const gapSnapshot = buildGapSnapshot(gapScores);
  const recommendationRunId = `rec_${randomUUID()}`;

  const docs = recommendations
    .filter((project) => project?.id && project?.slug && project?.title && project?.gapArea)
    .map((project) => ({
      userId: state.userId,
      conversationId: state.conversationId,
      projectId: project.id,
      projectSlug: project.slug,
      projectTitle: project.title,
      businessGoal,
      requirementSummary,
      gapArea: project.gapArea,
      gapScore: Number(project.gapScore || 0),
      priority: Number(project.priority || 1),
      searchedSubjects: project.searchedSubjects || [],
      matchedSubjects: project.matchedSubjects || [],
      matchScore: Number(project.matchScore || 0),
      reason: project.rationale || '',
      gapSnapshot,
      source: project.source || 'gap_subject_mapping',
      recommendationRunId
    }));

  if (docs.length === 0) return [];

  return AgentProjectRecommendation.insertMany(docs, { ordered: false });
};

module.exports = {
  persistProjectRecommendations
};
