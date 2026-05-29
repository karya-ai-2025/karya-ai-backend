const AgentEvidence = require('../../models/AgentEvidence');
const Conversation = require('../../models/Conversation');
const { generateEvidenceSummary } = require('../anthropicService');
const { buildAgentMemorySummary } = require('./memorySummary');
const { crawlWebsite } = require('./websiteCrawlerService');

const getUserId = (user) => {
  if (typeof user === 'string') return user;
  return String(user?._id || user?.id || '');
};

const createBusinessEvidence = (businessEvidence = {}) => ({
  websites: Array.isArray(businessEvidence.websites) ? businessEvidence.websites : [],
  intakeStatus: businessEvidence.intakeStatus || 'open',
  reviewStatus: businessEvidence.reviewStatus || 'not_ready',
  userCorrections: Array.isArray(businessEvidence.userCorrections) ? businessEvidence.userCorrections : [],
  canRunBasic: businessEvidence.canRunBasic !== false
});

const toPublicEvidence = (record) => ({
  evidenceId: String(record._id),
  kind: record.kind,
  url: record.url || '',
  status: record.status,
  hasExtractedText: Boolean(record.extractedText),
  summary: record.summary || '',
  signals: record.signals || [],
  metadata: record.metadata || {},
  addedAt: record.createdAt || record.updatedAt || new Date()
});

const normalizeWebsiteUrl = (url) => {
  const raw = String(url || '').trim();
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

const isPrivateOrLocalUrl = (url) => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost'
      || host.endsWith('.local')
      || /^127\./.test(host)
      || /^10\./.test(host)
      || /^192\.168\./.test(host)
      || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  } catch {
    return true;
  }
};

const saveWebsiteEvidence = async ({ user, conversationId, url }) => {
  const userId = getUserId(user);
  const normalizedUrl = normalizeWebsiteUrl(url);

  if (!normalizedUrl || isPrivateOrLocalUrl(normalizedUrl)) {
    const error = new Error('Please provide a public http or https website URL.');
    error.statusCode = 400;
    throw error;
  }

  let crawl = {
    extractedText: '',
    summary: '',
    signals: [],
    status: 'stored',
    metadata: {
      crawlStatus: 'not_started'
    }
  };

  try {
    const crawled = await crawlWebsite(normalizedUrl);
    let summary = '';
    let signals = [];

    if (crawled.extractedText) {
      try {
        const summarized = await generateEvidenceSummary({
          sourceName: normalizedUrl,
          sourceType: 'website',
          extractedText: crawled.extractedText
        });
        summary = summarized.summary;
        signals = summarized.signals;
      } catch {
        summary = crawled.extractedText.slice(0, 1200);
      }
    }

    crawl = {
      extractedText: crawled.extractedText,
      summary,
      signals,
      status: crawled.extractedText ? 'parsed' : 'stored',
      metadata: {
        crawlStatus: crawled.extractedText ? 'parsed' : 'empty',
        pagesCrawled: crawled.pagesCrawled,
        pages: (crawled.pages || []).map((page) => ({
          url: page.url,
          title: page.title,
          metaDescription: page.metaDescription,
          error: page.error
        }))
      }
    };
  } catch (error) {
    crawl = {
      ...crawl,
      status: 'failed',
      metadata: {
        crawlStatus: 'failed',
        crawlError: error.message
      }
    };
  }

  const record = await AgentEvidence.findOneAndUpdate(
    {
      userId,
      conversationId,
      kind: 'website',
      url: normalizedUrl
    },
    {
      $set: {
        status: crawl.status,
        extractedText: crawl.extractedText,
        summary: crawl.summary,
        signals: crawl.signals,
        metadata: crawl.metadata
      },
      $setOnInsert: {
        userId,
        conversationId,
        kind: 'website',
        url: normalizedUrl
      }
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true
    }
  );

  return toPublicEvidence(record);
};

const appendUniqueEvidence = (items, evidence) => {
  const key = evidence.url || evidence.evidenceId;
  const existingIndex = items.findIndex((item) => item.url === key || item.evidenceId === key);

  if (existingIndex >= 0) {
    return items.map((item, index) => (index === existingIndex ? { ...item, ...evidence } : item));
  }

  return [...items, evidence];
};

const addEvidenceToState = (state, evidence) => {
  const businessEvidence = createBusinessEvidence(state.businessEvidence);

  if (evidence.kind === 'website') {
    return {
      ...state,
      businessEvidence: {
        ...businessEvidence,
        websites: appendUniqueEvidence(businessEvidence.websites, evidence),
        intakeStatus: 'open',
        reviewStatus: evidence.summary ? 'pending' : businessEvidence.reviewStatus
      }
    };
  }

  return {
    ...state,
    businessEvidence
  };
};

const syncPendingWebsiteEvidence = async ({ user, state }) => {
  let nextState = {
    ...state,
    businessEvidence: createBusinessEvidence(state.businessEvidence)
  };

  const websites = nextState.businessEvidence.websites || [];
  for (const website of websites) {
    if (website.status !== 'pending_save' || !website.url) continue;
    try {
      const saved = await saveWebsiteEvidence({
        user,
        conversationId: nextState.conversationId,
        url: website.url
      });
      nextState = addEvidenceToState(nextState, saved);
    } catch {
      nextState.businessEvidence.websites = nextState.businessEvidence.websites.map((item) => (
        item.url === website.url ? { ...item, status: 'failed' } : item
      ));
    }
  }

  const savedWebsites = (nextState.businessEvidence.websites || [])
    .filter((website) => website.status !== 'pending_save');

  nextState.businessEvidence.websites = savedWebsites
    .filter((website, index, all) => all.findIndex((item) => item.url === website.url) === index);

  if (nextState.businessEvidence.websites.some((website) => website.summary)) {
    nextState.businessEvidence.reviewStatus = 'pending';
  }

  return nextState;
};

const loadConversationEvidence = async ({ user, conversationId }) => {
  const userId = getUserId(user);
  const records = await AgentEvidence.find({ userId, conversationId }).sort({ createdAt: 1 });
  const businessEvidence = createBusinessEvidence();

  records.forEach((record) => {
    if (record.kind !== 'website') return;
    const evidence = toPublicEvidence(record);
    businessEvidence.websites = appendUniqueEvidence(businessEvidence.websites, evidence);
  });

  return businessEvidence;
};

const persistStateEvidence = async ({ conversationId, state }) => {
  const memorySummary = buildAgentMemorySummary({ state });
  await Conversation.findByIdAndUpdate(conversationId, {
    $set: {
      'agentState.businessEvidence': state.businessEvidence,
      'agentState.phase': state.phase,
      'agentState.nextAction': state.nextAction,
      'agentState.uiRequest': state.uiRequest,
      'agentState.memorySummary': memorySummary,
      lastActivityAt: new Date()
    }
  });

  return {
    ...state,
    memorySummary
  };
};

module.exports = {
  addEvidenceToState,
  createBusinessEvidence,
  loadConversationEvidence,
  persistStateEvidence,
  saveWebsiteEvidence,
  syncPendingWebsiteEvidence
};
