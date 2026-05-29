const { routeAgentIntent } = require('../../anthropicService');

const getLatestUserMessage = (messages = []) => {
  const latest = [...messages].reverse().find((message) => message.role === 'user');
  return latest?.content || '';
};

const ruleFallbackIntent = (state) => {
  const message = getLatestUserMessage(state.messages).toLowerCase();

  if (/\b(change|revise|edit|new|different)\b.*\bgoal\b|\bgoal\b.*\b(change|revise|edit|different)\b/.test(message)) {
    return { intent: 'change_goal', confidence: 0.85, reason: 'Rule matched goal change request.' };
  }

  if (/\b(website|url|link)\b.*\b(diagnostic|diagnose|analysis|analyze|review|plan|business)\b|\b(diagnostic|diagnose|review|plan)\b.*\b(website|url|link)\b/.test(message)) {
    return { intent: 'add_diagnostic_evidence', confidence: 0.85, reason: 'Rule matched website evidence request.' };
  }

  if (/\b(rerun|run again|redo|restart)\b.*\b(diagnostic|diagnose|review|plan)\b|\b(diagnostic|diagnose|review)\b.*\b(again|redo|rerun|restart)\b/.test(message)) {
    return { intent: 'rerun_diagnostic', confidence: 0.85, reason: 'Rule matched business review rerun request.' };
  }

  if (/\b(regenerate|redo|update|rebuild)\b.*\b(plan|30-60-90)\b|\b(plan|30-60-90)\b.*\b(again|redo|update)\b/.test(message)) {
    return { intent: 'regenerate_plan', confidence: 0.85, reason: 'Rule matched plan regeneration request.' };
  }

  if (/\b(which|what|recommend|suggest|find|need|want|looking for|use)\b.*\b(project|service|tool|solution)\b|\b(project|service|tool|solution)\b.*\b(for|to|that can|which can|recommend|suggest)\b/.test(message)) {
    return { intent: 'find_marketplace_project', confidence: 0.82, reason: 'Rule matched marketplace project/service request.' };
  }

  return { intent: 'continue', confidence: 1, reason: 'No interruption detected.' };
};

const shouldApplyInterrupt = (state, routed) => {
  if (!routed || routed.intent === 'continue') return false;
  if (routed.confidence < 0.55) return false;
  if (!state.isAuthenticated && !['change_goal', 'find_marketplace_project'].includes(routed.intent)) return false;

  const message = getLatestUserMessage(state.messages);
  if (!message.trim()) return false;

  return true;
};

const resetDownstreamExecution = (state, reason) => ({
  ...state,
  gapScores: null,
  businessReview: null,
  plan: null,
  selectedProject: null,
  matchedExpert: null,
  activeGate: null,
  memorySummary: null,
  resetReason: reason
});

const applyIntent = (state, routed) => {
  if (!shouldApplyInterrupt(state, routed)) {
    return {
      interruptIntent: routed,
      resetReason: null
    };
  }

  if (routed.intent === 'change_goal') {
    return {
      ...resetDownstreamExecution(state, routed.reason),
      goal: null,
      phase: 'goal_definition',
      nextAction: 'define_goal',
      missingField: 'goal.description',
      uiRequest: null,
      interruptIntent: routed
    };
  }

  if (routed.intent === 'add_diagnostic_evidence' || routed.intent === 'rerun_diagnostic') {
    return {
      ...resetDownstreamExecution(state, routed.reason),
      phase: 'diagnostic_intake',
      nextAction: 'collect_evidence',
      missingField: null,
      uiRequest: null,
      businessEvidence: {
        ...(state.businessEvidence || {}),
        websites: state.businessEvidence?.websites || [],
        intakeStatus: 'open',
        reviewStatus: 'not_ready',
        canRunBasic: true
      },
      interruptIntent: routed
    };
  }

  if (routed.intent === 'regenerate_plan') {
    return {
      ...state,
      plan: null,
      phase: state.gapScores ? 'gap_diagnostic' : 'diagnostic_intake',
      nextAction: state.gapScores ? 'run_planner' : 'collect_evidence',
      missingField: null,
      uiRequest: null,
      interruptIntent: routed,
      resetReason: routed.reason
    };
  }

  if (routed.intent === 'find_marketplace_project') {
    return {
      ...state,
      phase: 'marketplace_project_match',
      nextAction: 'match_marketplace_project',
      missingField: null,
      uiRequest: null,
      interruptIntent: routed,
      resetReason: null
    };
  }

  return {
    interruptIntent: routed,
    resetReason: null
  };
};

const intentRouterNode = async (state) => {
  let routed;

  try {
    routed = await routeAgentIntent({ state });
  } catch {
    routed = ruleFallbackIntent(state);
  }

  if (!routed || routed.intent === 'continue' || routed.confidence < 0.55) {
    routed = ruleFallbackIntent(state);
  }

  return applyIntent(state, routed);
};

module.exports = {
  intentRouterNode
};
