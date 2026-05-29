const { asyncHandler } = require('../middleware/errorHandler');
const { createInitialAgentState, toPublicAgentState } = require('../services/agent/state');
const { runAgentGraph } = require('../services/agent/workflow');
const { loadAgentStateForUser, saveAgentTurn } = require('../services/agent/persistence');
const {
  addEvidenceToState,
  createBusinessEvidence,
  loadConversationEvidence,
  persistStateEvidence,
  saveWebsiteEvidence
} = require('../services/agent/evidencePersistence');

const getMessageContent = (req) => (
  typeof req.body.message === 'string' ? req.body.message.trim() : ''
);

const buildAnonymousState = (req) => createInitialAgentState({
  ...(req.body.clientState || {}),
  isAuthenticated: false,
  conversationId: req.body.conversationId || null,
  messages: Array.isArray(req.body.clientState?.messages) ? req.body.clientState.messages : []
});

const mergeClientStateForAuthenticatedTurn = (loadedState, clientState) => {
  if (!clientState || typeof clientState !== 'object') return loadedState;

  return createInitialAgentState({
    ...loadedState,
    userType: clientState.userType || loadedState.userType,
    identity: {
      ...(loadedState.identity || {}),
      ...(clientState.identity || {})
    },
    businessProfile: {
      ...(loadedState.businessProfile || {}),
      ...(clientState.businessProfile || {})
    },
    expertProfile: {
      ...(loadedState.expertProfile || {}),
      ...(clientState.expertProfile || {})
    },
    goal: clientState.goal || loadedState.goal,
    businessEvidence: createBusinessEvidence(clientState.businessEvidence || loadedState.businessEvidence),
    gapScores: clientState.gapScores || loadedState.gapScores,
    businessReview: clientState.businessReview || loadedState.businessReview,
    plan: clientState.plan || loadedState.plan,
    marketplaceProjectMatches: clientState.marketplaceProjectMatches || loadedState.marketplaceProjectMatches,
    selectedProject: clientState.selectedProject || loadedState.selectedProject,
    matchedExpert: clientState.matchedExpert || loadedState.matchedExpert,
    activeGate: clientState.activeGate || loadedState.activeGate,
    memorySummary: clientState.memorySummary || loadedState.memorySummary,
    phase: clientState.phase || loadedState.phase,
    nextAction: clientState.nextAction || loadedState.nextAction,
    missingField: clientState.missingField || loadedState.missingField,
    uiRequest: clientState.uiRequest || loadedState.uiRequest,
    conversationId: loadedState.conversationId,
    userId: loadedState.userId,
    isAuthenticated: true,
    messages: loadedState.messages || []
  });
};

const appendUserMessage = (state, content) => ({
  ...state,
  messages: [
    ...(state.messages || []),
    {
      role: 'user',
      content,
      timestamp: new Date()
    }
  ]
});

const chatWithAgent = asyncHandler(async (req, res) => {
  const content = getMessageContent(req);

  if (!content) {
    return res.status(400).json({
      success: false,
      message: 'Message content is required'
    });
  }

  let conversation = null;
  let state;

  if (req.user) {
    const loaded = await loadAgentStateForUser({
      user: req.user,
      conversationId: req.body.conversationId,
      createIfMissing: true
    });

    conversation = loaded.conversation;
    state = mergeClientStateForAuthenticatedTurn(loaded.state, req.body.clientState);
  } else {
    state = buildAnonymousState(req);
  }

  const graphInput = appendUserMessage(state, content);
  const graphState = await runAgentGraph(graphInput);
  const assistantResponse = graphState.response || 'I am ready to continue onboarding.';
  let responseState = graphState;

  if (req.user && conversation) {
    responseState = await saveAgentTurn({
      user: req.user,
      conversation,
      state: graphState,
      assistantResponse
    });
  }

  res.status(200).json({
    success: true,
    data: {
      conversationId: graphState.conversationId || conversation?._id || null,
      assistantMessage: {
        role: 'agent',
        content: assistantResponse,
        timestamp: new Date()
      },
      state: toPublicAgentState(responseState),
      persisted: Boolean(req.user)
    }
  });
});

const getAgentThreadState = asyncHandler(async (req, res) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Please log in to load a saved agent thread.'
    });
  }

  const loaded = await loadAgentStateForUser({
    user: req.user,
    conversationId: req.params.conversationId,
    createIfMissing: false
  });

  if (!loaded) {
    return res.status(404).json({
      success: false,
      message: 'Agent thread not found'
    });
  }

  res.status(200).json({
    success: true,
    data: {
      conversationId: String(loaded.conversation._id),
      state: toPublicAgentState(loaded.state)
    }
  });
});

const saveAgentWebsiteEvidence = asyncHandler(async (req, res) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Please log in to save website evidence.'
    });
  }

  const loaded = await loadAgentStateForUser({
    user: req.user,
    conversationId: req.body.conversationId,
    createIfMissing: false
  });

  if (!loaded) {
    return res.status(404).json({
      success: false,
      message: 'Agent conversation not found'
    });
  }

  const evidence = await saveWebsiteEvidence({
    user: req.user,
    conversationId: loaded.conversation._id,
    url: req.body.url
  });

  const state = addEvidenceToState({
    ...loaded.state,
    phase: 'diagnostic_intake',
    nextAction: 'collect_evidence',
    uiRequest: {
      type: evidence.summary ? 'evidence_review' : 'diagnostic_intake'
    }
  }, evidence);

  const persistedState = await persistStateEvidence({
    conversationId: loaded.conversation._id,
    state
  });

  res.status(201).json({
    success: true,
    data: {
      evidence,
      conversationId: String(loaded.conversation._id),
      assistantMessage: {
        role: 'agent',
        content: evidence.summary
          ? `I crawled ${evidence.url}.\n\nHere is what I understood:\n\n${evidence.summary}\n\nPlease confirm if this is correct, or edit it before I continue.`
          : `I saved ${evidence.url} for the business review, but I could not extract a useful website summary. You can share another website or continue to the business review now.`,
        timestamp: new Date()
      },
      state: toPublicAgentState(persistedState)
    }
  });
});

const getAgentEvidence = asyncHandler(async (req, res) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Please log in to load website evidence.'
    });
  }

  const businessEvidence = await loadConversationEvidence({
    user: req.user,
    conversationId: req.params.conversationId
  });

  res.status(200).json({
    success: true,
    data: businessEvidence
  });
});

module.exports = {
  chatWithAgent,
  getAgentThreadState,
  getAgentEvidence,
  saveAgentWebsiteEvidence
};
