const hasItems = (value) => Array.isArray(value) && value.length > 0;

const hasBusinessMinimum = (profile = {}) => (
  Boolean(
    profile.companyName
    && profile.website
    && profile.industry
    && profile.targetCustomer
  )
);

const hasIdentityMinimum = (identity = {}) => (
  Boolean(identity.name && identity.email && identity.phone)
);

const buildCoveredItems = (state) => {
  const covered = [];

  if (hasIdentityMinimum(state.identity)) {
    covered.push('account details');
  }

  if (hasBusinessMinimum(state.businessProfile)) {
    covered.push('business profile');
  }

  if (state.goal?.confirmed) {
    covered.push('confirmed goal');
  } else if (state.goal?.description) {
    covered.push('draft goal');
  }

  if (hasItems(state.businessEvidence?.websites)) {
    covered.push('website context');
  }

  if (state.businessReview) {
    covered.push('areas where Karya AI can help');
  }

  if (state.plan) {
    covered.push('30-60-90 plan');
  }

  if (state.plan?.ppt) {
    covered.push('PPT');
  }

  return covered;
};

const getFirstProject = (state) => (
  state.plan?.recommendedProjects?.[0]
  || state.businessReview?.recommendedProjects?.[0]
  || null
);

const getNextSuggestedAction = (state) => {
  if (!state.goal?.confirmed) return 'Confirm the goal.';
  if (!state.businessReview) return 'Review the business and identify where Karya AI can help.';
  if (!state.plan) return 'Generate the 30-60-90 day plan.';
  if (state.plan?.recommendedProjects?.[0]) return `Start with ${state.plan.recommendedProjects[0].title}.`;
  return 'Choose the first project to start.';
};

const buildWelcomeBackMessage = ({ state, covered, nextSuggestedAction }) => {
  const companyName = state.businessProfile?.companyName || 'your business';
  const goal = state.goal?.description;
  const firstProject = getFirstProject(state);
  const parts = [`Welcome back. Last time we covered ${covered.join(', ')} for ${companyName}.`];

  if (goal) {
    parts.push(`Your goal was: ${goal}.`);
  }

  if (firstProject?.title) {
    parts.push(`The first project I would focus on is ${firstProject.title}.`);
  }

  parts.push(nextSuggestedAction);

  return parts.join(' ');
};

const buildAgentMemorySummary = ({ state }) => {
  const covered = buildCoveredItems(state);
  const nextSuggestedAction = getNextSuggestedAction(state);

  if (covered.length === 0) {
    return {
      covered: [],
      currentPhase: state.phase || 'onboarding',
      summary: 'No meaningful agent progress has been captured yet.',
      nextSuggestedAction,
      welcomeBackMessage: 'Welcome back. We can continue setting up your Karya AI plan.',
      updatedAt: new Date().toISOString()
    };
  }

  const firstProject = getFirstProject(state);
  const summary = [
    `Covered: ${covered.join(', ')}.`,
    state.businessProfile?.companyName ? `Company: ${state.businessProfile.companyName}.` : '',
    state.goal?.description ? `Goal: ${state.goal.description}.` : '',
    state.businessReview?.helpAreas?.length ? `Help areas: ${state.businessReview.helpAreas.map((area) => area.title).join(', ')}.` : '',
    firstProject?.title ? `First project: ${firstProject.title}.` : '',
    `Next: ${nextSuggestedAction}`
  ].filter(Boolean).join(' ');

  return {
    covered,
    currentPhase: state.phase || 'onboarding',
    companyName: state.businessProfile?.companyName || '',
    goal: state.goal?.description || '',
    websiteCount: state.businessEvidence?.websites?.length || 0,
    helpAreas: (state.businessReview?.helpAreas || []).map((area) => ({
      title: area.title,
      projectTitle: area.project?.title || ''
    })),
    firstProject: firstProject ? {
      slug: firstProject.slug,
      title: firstProject.title,
      marketplaceUrl: firstProject.marketplaceUrl
    } : null,
    hasPlan: Boolean(state.plan),
    hasPpt: Boolean(state.plan?.ppt),
    summary,
    nextSuggestedAction,
    welcomeBackMessage: buildWelcomeBackMessage({ state, covered, nextSuggestedAction }),
    updatedAt: new Date().toISOString()
  };
};

module.exports = {
  buildAgentMemorySummary
};
