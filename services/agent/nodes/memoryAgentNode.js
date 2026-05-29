const {
  extractIdentityFields,
  extractUserType,
  extractBusinessFields,
  extractExpertFields,
  extractGoalFields,
  extractWebsiteUrls,
  detectGoalConfirmation,
  detectGoalRevisionRequest
} = require('../extractors');
const { createBusinessEvidence } = require('../evidencePersistence');

const mergeDefined = (base = {}, updates = {}) => {
  const merged = { ...base };

  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value) && value.length === 0) return;
    if (typeof value === 'string' && !value.trim()) return;
    merged[key] = value;
  });

  return merged;
};

const getLatestUserMessage = (messages = []) => {
  const latest = [...messages].reverse().find((message) => message.role === 'user');
  return latest?.content || '';
};

const shouldCaptureGoal = (state) => (
  state.phase === 'goal_definition'
  || ['define_goal', 'clarify_goal', 'confirm_goal'].includes(state.nextAction)
  || String(state.missingField || '').startsWith('goal.')
);

const shouldCaptureEvidence = (state) => (
  state.phase === 'diagnostic_intake'
  || state.nextAction === 'collect_evidence'
);

const mergeGoal = ({ currentGoal, goalUpdates, latestMessage, isClarification }) => {
  const hasExistingDescription = Boolean(currentGoal?.description);
  const hasNewDescription = Boolean(goalUpdates.description);
  let description = goalUpdates.description || currentGoal?.description || '';

  if (hasExistingDescription && hasNewDescription && isClarification) {
    description = `${currentGoal.description}; ${latestMessage}`;
  }

  const merged = mergeDefined(currentGoal, {
    ...goalUpdates,
    description,
    confirmed: false,
    updatedAt: new Date().toISOString()
  });

  const isClear = Boolean(
    goalUpdates.isClear
    || merged.targetMetric
    || merged.timeframeDays
    || ['process', 'matching', 'availability'].includes(merged.type)
  );

  return {
    ...merged,
    isClear,
    clarificationQuestion: isClear ? null : merged.clarificationQuestion
  };
};

const applyAnswerToMissingField = (updates, state, latestMessage) => {
  const missingField = state.missingField || '';
  const value = String(latestMessage || '').trim();

  if (!value || !missingField.includes('.')) return updates;

  const [section, key] = missingField.split('.');

  if (section === 'identity' && !updates.identity?.[key]) {
    return {
      ...updates,
      identity: mergeDefined(updates.identity, { [key]: value })
    };
  }

  if (section === 'businessProfile' && !updates.businessProfile?.[key]) {
    return {
      ...updates,
      businessProfile: mergeDefined(updates.businessProfile, { [key]: value })
    };
  }

  if (section === 'expertProfile' && !updates.expertProfile?.[key]) {
    const listFields = ['skills', 'industriesServed', 'preferredProjectTypes'];
    const normalizedValue = listFields.includes(key)
      ? value.split(/,|\/|\band\b/i).map((item) => item.trim()).filter(Boolean)
      : value;

    return {
      ...updates,
      expertProfile: mergeDefined(updates.expertProfile, { [key]: normalizedValue })
    };
  }

  if (section === 'goal' && key === 'description' && !updates.goal?.description) {
    return {
      ...updates,
      goal: mergeGoal({
        currentGoal: state.goal,
        goalUpdates: extractGoalFields(value, updates.userType || state.userType),
        latestMessage: value,
        isClarification: false
      })
    };
  }

  return updates;
};

const memoryAgentNode = async (state) => {
  const latestMessage = getLatestUserMessage(state.messages);
  const identityUpdates = extractIdentityFields(latestMessage);
  const detectedUserType = extractUserType(latestMessage);
  const userType = state.userType || detectedUserType;

  const updates = {
    identity: mergeDefined(state.identity, identityUpdates),
    userType
  };

  if (userType === 'business') {
    updates.businessProfile = mergeDefined(
      state.businessProfile,
      extractBusinessFields(latestMessage)
    );
  }

  if (userType === 'expert') {
    updates.expertProfile = mergeDefined(
      state.expertProfile,
      extractExpertFields(latestMessage)
    );
  }

  if (shouldCaptureGoal(state)) {
    if (state.nextAction === 'confirm_goal' && detectGoalRevisionRequest(latestMessage)) {
      updates.goal = null;
    } else if (state.nextAction === 'confirm_goal' && detectGoalConfirmation(latestMessage)) {
      updates.goal = {
        ...(state.goal || {}),
        confirmed: true,
        confirmedAt: new Date().toISOString()
      };
    } else if (state.nextAction !== 'confirm_goal') {
      const goalUpdates = extractGoalFields(latestMessage, userType);
      if (goalUpdates.description) {
        updates.goal = mergeGoal({
          currentGoal: state.goal,
          goalUpdates,
          latestMessage,
          isClarification: state.nextAction === 'clarify_goal'
        });
      }
    }
  }

  if (shouldCaptureEvidence(state)) {
    const businessEvidence = createBusinessEvidence(state.businessEvidence);
    const urls = extractWebsiteUrls(latestMessage);

    if (urls.length > 0) {
      updates.businessEvidence = {
        ...businessEvidence,
        websites: [
          ...businessEvidence.websites,
          ...urls.map((url) => ({
            kind: 'website',
            url,
            status: 'pending_save',
            addedAt: new Date().toISOString()
          }))
        ],
        intakeStatus: 'open',
        canRunBasic: true
      };
    }
  }

  return applyAnswerToMissingField(updates, state, latestMessage);
};

module.exports = {
  memoryAgentNode
};
