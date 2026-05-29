const Conversation = require('../../models/Conversation');
const BusinessProfile = require('../../models/BusinessProfile');
const ExpertProfile = require('../../models/ExpertProfile');
const { createInitialAgentState } = require('./state');
const { buildAgentMemorySummary } = require('./memorySummary');
const {
  createBusinessEvidence,
  loadConversationEvidence,
  syncPendingWebsiteEvidence
} = require('./evidencePersistence');

const getUserId = (user) => String(user?._id || user?.id || '');

const normalizeProfileWebsite = (website) => {
  const raw = String(website || '').trim();
  if (!raw) return '';

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const parsed = new URL(withProtocol);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
};

const normalizeUserType = (role) => {
  if (role === 'expert') return 'expert';
  if (role === 'business') return 'business';
  return 'business';
};

const normalizeMessage = (message) => ({
  role: message.role === 'assistant' ? 'agent' : message.role,
  content: String(message.content || '').trim(),
  timestamp: message.timestamp || new Date()
});

const getConversationMessages = (conversation) => (
  (conversation?.messages || []).map((message) => ({
    role: message.role,
    content: message.content,
    timestamp: message.timestamp
  }))
);

const mergeEvidenceByKey = (left = [], right = [], key) => {
  const merged = [...left];

  right.forEach((item) => {
    const itemKey = item?.[key];
    const existingIndex = merged.findIndex((entry) => entry?.[key] === itemKey);
    if (itemKey && existingIndex >= 0) {
      merged[existingIndex] = { ...merged[existingIndex], ...item };
    } else if (item) {
      merged.push(item);
    }
  });

  return merged;
};

const mergeBusinessEvidence = (storedEvidence = {}, stateEvidence = {}) => ({
  websites: mergeEvidenceByKey(storedEvidence.websites, stateEvidence.websites, 'url'),
  intakeStatus: stateEvidence.intakeStatus || storedEvidence.intakeStatus || 'open',
  reviewStatus: stateEvidence.reviewStatus || storedEvidence.reviewStatus || 'not_ready',
  userCorrections: Array.isArray(stateEvidence.userCorrections)
    ? stateEvidence.userCorrections
    : storedEvidence.userCorrections,
  canRunBasic: stateEvidence.canRunBasic !== false
});

const businessProfileToAgent = (profile) => {
  if (!profile) return {};

  return {
    companyName: profile.company?.name || '',
    website: profile.company?.website || '',
    industry: profile.industry || '',
    targetCustomer: profile.targetAudience?.demographics || '',
    channels: profile.marketingActivities?.currentActivities || '',
    budget: profile.marketingBudget?.monthly || '',
    constraints: Array.isArray(profile.currentChallenges) ? profile.currentChallenges.join(', ') : '',
    desiredOutcome: profile.marketingActivities?.goalsObjectives || ''
  };
};

const expertProfileToAgent = (profile) => {
  if (!profile) return {};

  return {
    skills: (profile.skills || []).map((skill) => skill.name).filter(Boolean),
    industriesServed: profile.industries || [],
    projectExperience: profile.experience?.[0]?.description || profile.bio || '',
    availability: profile.availability?.status || '',
    capacity: profile.availability?.hoursPerWeek ? String(profile.availability.hoursPerWeek) : '',
    preferredProjectTypes: (profile.services || []).map((service) => service.name).filter(Boolean),
    portfolioProof: profile.socialLinks?.portfolio || profile.portfolio?.[0]?.link || ''
  };
};

const getOrCreateAgentConversation = async ({ user, conversationId }) => {
  const userId = getUserId(user);

  if (conversationId) {
    const existing = await Conversation.findOne({ _id: conversationId, userId });
    if (existing) return existing;
  }

  return Conversation.create({
    userId,
    title: 'Karya agent onboarding',
    messages: [],
    lastActivityAt: new Date(),
    agentState: createInitialAgentState({
      userId,
      isAuthenticated: true,
      userType: normalizeUserType(user.activeRole),
      identity: {
        name: user.fullName || '',
        email: user.email || '',
        phone: user.phone || ''
      }
    })
  });
};

const loadAgentStateForUser = async ({ user, conversationId, createIfMissing = true }) => {
  const userId = getUserId(user);
  const conversation = createIfMissing
    ? await getOrCreateAgentConversation({ user, conversationId })
    : await Conversation.findOne({ _id: conversationId, userId });

  if (!conversation) return null;

  const [businessProfile, expertProfile, storedEvidence] = await Promise.all([
    BusinessProfile.findOne({ user: userId }),
    ExpertProfile.findOne({ user: userId }),
    loadConversationEvidence({ user, conversationId: conversation._id })
  ]);

  return {
    conversation,
    state: createInitialAgentState({
      ...(conversation.agentState || {}),
      userId,
      conversationId: String(conversation._id),
      isAuthenticated: true,
      messages: getConversationMessages(conversation),
      userType: conversation.agentState?.userType || normalizeUserType(user.activeRole),
      identity: {
        name: user.fullName || '',
        email: user.email || '',
        phone: user.phone || '',
        ...(conversation.agentState?.identity || {})
      },
      businessProfile: {
        ...businessProfileToAgent(businessProfile),
        ...(conversation.agentState?.businessProfile || {})
      },
      expertProfile: {
        ...expertProfileToAgent(expertProfile),
        ...(conversation.agentState?.expertProfile || {})
      },
      businessEvidence: createBusinessEvidence(mergeBusinessEvidence(
        storedEvidence,
        conversation.agentState?.businessEvidence || {}
      ))
    })
  };
};

const updateBusinessProfile = async ({ user, state }) => {
  if (state.userType !== 'business') return;

  const userId = getUserId(user);
  let profile = await BusinessProfile.findOne({ user: userId });
  const data = state.businessProfile || {};

  if (!profile) {
    profile = new BusinessProfile({
      user: userId,
      company: {
        name: data.companyName || `${user.fullName}'s Company`
      }
    });
  }

  profile.company = profile.company || {};
  profile.targetAudience = profile.targetAudience || {};
  profile.marketingActivities = profile.marketingActivities || {};
  profile.marketingBudget = profile.marketingBudget || {};

  if (data.companyName) profile.company.name = data.companyName;
  if (data.website) {
    const normalizedWebsite = normalizeProfileWebsite(data.website);
    if (normalizedWebsite) {
      profile.company.website = normalizedWebsite;
      state.businessProfile.website = normalizedWebsite;
    }
  }
  if (data.industry) profile.industry = data.industry;
  if (data.targetCustomer) profile.targetAudience.demographics = data.targetCustomer;
  if (data.channels) profile.marketingActivities.currentActivities = data.channels;
  if (data.budget) profile.marketingBudget.monthly = data.budget;
  if (data.constraints) profile.currentChallenges = [data.constraints];
  if (data.desiredOutcome) profile.marketingActivities.goalsObjectives = data.desiredOutcome;
  if (state.goal?.description) profile.marketingActivities.goalsObjectives = state.goal.description;

  await profile.save();
};

const updateExpertProfile = async ({ user, state }) => {
  if (state.userType !== 'expert') return;

  const userId = getUserId(user);
  let profile = await ExpertProfile.findOne({ user: userId });
  const data = state.expertProfile || {};

  if (!profile) {
    profile = new ExpertProfile({ user: userId });
  }

  profile.availability = profile.availability || {};
  profile.socialLinks = profile.socialLinks || {};

  if (Array.isArray(data.skills)) {
    profile.skills = data.skills.map((skill) => ({ name: skill, level: 'Intermediate' }));
  }
  if (Array.isArray(data.industriesServed)) profile.industries = data.industriesServed;
  if (data.projectExperience) profile.bio = data.projectExperience;
  if (data.availability && ['available', 'busy', 'unavailable'].includes(String(data.availability).toLowerCase())) {
    profile.availability.status = String(data.availability).toLowerCase();
  }

  const capacity = parseInt(String(data.capacity || '').match(/\d+/)?.[0], 10);
  if (!Number.isNaN(capacity)) profile.availability.hoursPerWeek = Math.min(capacity, 80);

  if (Array.isArray(data.preferredProjectTypes)) {
    profile.services = data.preferredProjectTypes.map((name) => ({ name }));
  }
  if (data.portfolioProof) profile.socialLinks.portfolio = data.portfolioProof;

  await profile.save();
};

const saveAgentTurn = async ({ user, conversation, state, assistantResponse }) => {
  const finalState = await syncPendingWebsiteEvidence({ user, state });
  const memorySummary = buildAgentMemorySummary({ state: finalState });

  conversation.messages = [
    ...(finalState.messages || []).map(normalizeMessage),
    normalizeMessage({ role: 'agent', content: assistantResponse, timestamp: new Date() })
  ].filter((message) => message.content);

  conversation.agentState = {
    ...finalState,
    memorySummary,
    messages: undefined,
    response: assistantResponse
  };
  conversation.lastActivityAt = new Date();

  if (conversation.title === 'New conversation' || conversation.title === 'Karya agent onboarding') {
    const firstUserMessage = conversation.messages.find((message) => message.role === 'user');
    if (firstUserMessage?.content) {
      conversation.title = firstUserMessage.content.substring(0, 100);
    }
  }

  await Promise.all([
    conversation.save(),
    updateBusinessProfile({ user, state: finalState }),
    updateExpertProfile({ user, state: finalState })
  ]);

  return {
    ...finalState,
    memorySummary
  };
};

module.exports = {
  loadAgentStateForUser,
  saveAgentTurn
};
