const { identityFields, businessFields, expertFields } = require('../agentConfig');
const { generateGoalDefinition } = require('../../anthropicService');
const { buildMarketplaceProjectMatch } = require('../projectCatalogService');
const { getByAction, CAPABILITIES } = require('../capabilityRegistry');

const hasValue = (value) => {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && String(value).trim() !== '';
};

const getMissingField = (fields, values = {}) => (
  fields.find((field) => !hasValue(values[field.key])) || null
);

const getProgress = (fields, values = {}) => {
  const completed = fields.filter((field) => hasValue(values[field.key])).length;
  return {
    completed,
    total: fields.length,
    percent: Math.round((completed / fields.length) * 100)
  };
};

const getRequiredBusinessFields = () => businessFields.filter((field) => field.requiredForPlan);

const getProfileProgress = (state) => ({
  identity: getProgress(identityFields, state.identity),
  businessProfile: state.userType === 'business' ? getProgress(businessFields, state.businessProfile) : undefined,
  expertProfile: state.userType === 'expert' ? getProgress(expertFields, state.expertProfile) : undefined
});

const buildSignupUiRequest = (state) => ({
  type: 'secure_signup',
  endpoint: '/api/auth/register',
  method: 'POST',
  fields: ['password'],
  payloadPreview: {
    fullName: state.identity?.name,
    email: state.identity?.email,
    phone: state.identity?.phone,
    role: state.userType === 'expert' ? 'expert' : 'owner'
  },
  note: 'Collect the password in a secure password input and send it directly to the auth API. Do not send it as a chat message.'
});

const buildGoalSummary = (goal = {}) => {
  const lines = [
    `Goal: ${goal.description}`,
    goal.targetMetric ? `Target: ${goal.targetMetric}` : null,
    goal.timeframeDays ? `Timeframe: ${goal.timeframeDays} days` : null,
    goal.type ? `Type: ${goal.type.replace(/_/g, ' ')}` : null
  ].filter(Boolean);

  return lines.join('\n');
};

const buildGoalConfirmationUiRequest = (goal) => ({
  type: 'goal_confirmation',
  goal,
  options: [
    { label: 'Confirm goal', value: 'confirm_goal' },
    { label: 'Revise goal', value: 'revise_goal' }
  ]
});

const getGoalQuestion = (state) => (
  state.userType === 'expert'
    ? 'What kind of Karya projects or client matches do you want to focus on?'
    : 'What is the main business outcome you want to achieve in the next 30, 60, or 90 days?'
);

const refineGoalWithModel = async (state) => {
  try {
    const modelGoal = await generateGoalDefinition({ state });
    if (!modelGoal?.description) return null;

    return {
      ...(state.goal || {}),
      ...modelGoal,
      confirmed: false,
      updatedAt: new Date().toISOString()
    };
  } catch (error) {
    return null;
  }
};

const getLatestUserMessage = (messages = []) => {
  const latest = [...messages].reverse().find((message) => message.role === 'user');
  return latest?.content || '';
};

const detectGeneratePlanIntent = (message) => (
  /\b(generate|create|build|make|show)\b.*\b(plan|30-60-90|roadmap)\b|\b(plan|30-60-90|roadmap)\b.*\b(generate|create|build|make|now)\b/i.test(String(message || ''))
);

const buildBusinessReviewUiRequest = (businessReview) => ({
  type: 'business_review',
  businessReview,
  options: [
    { label: 'Generate Plan', value: 'generate_plan', message: 'Generate Plan' }
  ]
});

const buildProjectMatchUiRequest = (projectMatch) => ({
  type: 'project_match',
  projectMatch
});

const orchestratorNode = async (state) => {
  const latestMessage = getLatestUserMessage(state.messages);

  // ── Active email-campaign flow is modal ────────────────────────────────
  // Once the email specialist is collecting a brief / awaiting approval /
  // choosing recipients, keep every turn routed to it — even if the router
  // matched another capability (e.g. 'leads' while describing the audience).
  if (state.emailBrief && state.emailBrief.stage && state.emailBrief.stage !== 'complete') {
    return {
      phase: 'email_flow',
      nextAction: 'run_email_agent',
      missingField: null,
      uiRequest: null,
      profileProgress: getProfileProgress(state),
      response: ''
    };
  }

  // ── Registry-based capability routing ──────────────────────────────────
  // Any capability whose nextAction is already set gets routed to its specialist.
  // The specialist node handles the actual work — orchestrator just passes through.
  // project_match is the only one handled inline here (no separate node).
  const matchedCapability = state.matchedCapability
    ? getByAction(state.nextAction)
    : null;

  if (matchedCapability && matchedCapability.node) {
    // Has a dedicated specialist node — route to it (workflow.js handles the edge)
    return {
      phase:         state.matchedCapability.id,
      nextAction:    matchedCapability.nextAction,
      missingField:  null,
      uiRequest:     null,
      profileProgress: getProfileProgress(state),
      response:      ''
    };
  }

  // ── Unmet need — platform doesn't have this capability yet ─────────────
  if (state.unmetNeed) {
    const capabilityList = CAPABILITIES.map((c) => `• ${c.description.split('.')[0]}`).join('\n');
    return {
      phase:         state.phase,
      nextAction:    'respond',
      missingField:  null,
      uiRequest:     null,
      profileProgress: getProfileProgress(state),
      response:      `I can't help with "${state.unmetNeed}" yet. Here's what I can do right now:\n\n${capabilityList}\n\nWhich of these would be useful?`
    };
  }

  if (state.nextAction === 'match_marketplace_project') {
    const projectMatch = await buildMarketplaceProjectMatch({
      query: latestMessage,
      limit: 3
    });
    const hasMatches = projectMatch.matches.length > 0;

    return {
      phase: 'marketplace_project_match',
      nextAction: 'respond',
      missingField: null,
      marketplaceProjectMatches: projectMatch,
      uiRequest: buildProjectMatchUiRequest(projectMatch),
      profileProgress: getProfileProgress(state),
      response: hasMatches
        ? 'I matched your request with the closest Karya marketplace projects. Open a project to review details, pricing, and next steps. For a more specialized recommendation, share your business type, website, target customer, and goal.'
        : 'I could not find a strong marketplace project match for that request yet. Share the workflow, outcome, KPI, business type, website, target customer, and goal so I can narrow it down.'
    };
  }

  if (state.interruptIntent?.intent === 'add_diagnostic_evidence' && state.phase === 'diagnostic_intake') {
    return {
      phase: 'diagnostic_intake',
      nextAction: 'collect_evidence',
      missingField: null,
      uiRequest: null,
      profileProgress: getProfileProgress(state),
      response: ''
    };
  }

  if (state.interruptIntent?.intent === 'rerun_diagnostic' && state.phase === 'diagnostic_intake') {
    return {
      phase: 'diagnostic_intake',
      nextAction: 'collect_evidence',
      missingField: null,
      uiRequest: null,
      profileProgress: getProfileProgress(state),
      response: ''
    };
  }

  const identityMissing = getMissingField(identityFields, state.identity);

  if (identityMissing) {
    return {
      phase: 'onboarding',
      nextAction: 'ask_field',
      missingField: `identity.${identityMissing.key}`,
      uiRequest: null,
      profileProgress: {
        identity: getProgress(identityFields, state.identity)
      },
      response: identityMissing.question
    };
  }

  if (!state.userType) {
    return {
      phase: 'onboarding',
      nextAction: 'ask_field',
      missingField: 'userType',
      uiRequest: {
        type: 'choice',
        field: 'userType',
        options: [
          { label: 'Business user', value: 'business' },
          { label: 'Expert user', value: 'expert' }
        ]
      },
      profileProgress: {
        identity: getProgress(identityFields, state.identity)
      },
      response: 'Are you joining as a business user or an expert user?'
    };
  }

  if (!state.isAuthenticated) {
    return {
      phase: 'onboarding',
      nextAction: 'ask_field',
      missingField: 'password',
      uiRequest: buildSignupUiRequest(state),
      profileProgress: {
        identity: getProgress(identityFields, state.identity)
      },
      response: 'Please create your account password in the secure signup field so we can save your onboarding details.'
    };
  }

  if (state.userType === 'business') {
    const missingBusinessField = getMissingField(getRequiredBusinessFields(), state.businessProfile);

    if (missingBusinessField) {
      return {
        phase: 'onboarding',
        nextAction: 'ask_field',
        missingField: `businessProfile.${missingBusinessField.key}`,
        uiRequest: null,
        profileProgress: {
          identity: getProgress(identityFields, state.identity),
          businessProfile: getProgress(businessFields, state.businessProfile)
        },
        response: missingBusinessField.question
      };
    }
  }

  if (state.userType === 'expert') {
    const missingExpertField = getMissingField(expertFields, state.expertProfile);

    if (missingExpertField) {
      return {
        phase: 'onboarding',
        nextAction: 'ask_field',
        missingField: `expertProfile.${missingExpertField.key}`,
        uiRequest: null,
        profileProgress: {
          identity: getProgress(identityFields, state.identity),
          expertProfile: getProgress(expertFields, state.expertProfile)
        },
        response: missingExpertField.question
      };
    }
  }

  if (!state.goal?.description) {
    return {
      phase: 'goal_definition',
      nextAction: 'define_goal',
      missingField: 'goal.description',
      uiRequest: null,
      profileProgress: getProfileProgress(state),
      response: getGoalQuestion(state)
    };
  }

  if (!state.goal.isClear) {
    const refinedGoal = await refineGoalWithModel(state);

    if (refinedGoal?.isClear) {
      return {
        phase: 'goal_definition',
        nextAction: 'confirm_goal',
        missingField: null,
        goal: refinedGoal,
        uiRequest: buildGoalConfirmationUiRequest(refinedGoal),
        profileProgress: getProfileProgress(state),
        response: `I captured this goal:\n\n${buildGoalSummary(refinedGoal)}\n\nDoes this look right?`
      };
    }

    return {
      phase: 'goal_definition',
      nextAction: 'clarify_goal',
      missingField: 'goal.clarification',
      goal: refinedGoal || state.goal,
      uiRequest: null,
      profileProgress: getProfileProgress(state),
      response: refinedGoal?.clarificationQuestion || state.goal.clarificationQuestion || getGoalQuestion(state)
    };
  }

  if (!state.goal.confirmed) {
    return {
      phase: 'goal_definition',
      nextAction: 'confirm_goal',
      missingField: null,
      uiRequest: buildGoalConfirmationUiRequest(state.goal),
      profileProgress: getProfileProgress(state),
      response: `I captured this goal:\n\n${buildGoalSummary(state.goal)}\n\nDoes this look right?`
    };
  }

  if (state.nextAction === 'run_planner') {
    return {
      phase: 'gap_diagnostic',
      nextAction: 'run_planner',
      missingField: null,
      uiRequest: null,
      profileProgress: getProfileProgress(state),
      response: ''
    };
  }

  if (state.businessReview && !state.plan) {
    if (detectGeneratePlanIntent(latestMessage)) {
      return {
        phase: 'gap_diagnostic',
        nextAction: 'run_planner',
        missingField: null,
        uiRequest: null,
        profileProgress: getProfileProgress(state),
        response: ''
      };
    }

    return {
      phase: 'business_review',
      nextAction: 'await_plan_generation',
      missingField: null,
      uiRequest: buildBusinessReviewUiRequest(state.businessReview),
      profileProgress: getProfileProgress(state),
      response: 'Here are the areas where Karya AI can help. Generate the full plan when you are ready.'
    };
  }

  if (state.plan) {
    const returnPrefix = state.memorySummary?.summary ? 'Welcome back. ' : '';
    return {
      phase: 'plan_generation',
      nextAction: 'respond',
      missingField: null,
      uiRequest: {
        type: 'plan_summary',
        plan: state.plan,
        gapScores: state.gapScores
      },
      profileProgress: getProfileProgress(state),
      response: `${returnPrefix}The business review and 30-60-90 day plan are ready. Review the plan above and choose the first project when you are ready.`
    };
  }

  return {
    phase: 'diagnostic_intake',
    nextAction: 'collect_evidence',
    missingField: null,
    uiRequest: null,
    profileProgress: getProfileProgress(state),
    response: ''
  };
};

module.exports = {
  orchestratorNode
};
