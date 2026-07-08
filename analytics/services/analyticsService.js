const AnalyticsEvent = require('../models/AnalyticsEvent');
const { analyticsEnabled, currentEnv, viewEnv } = require('../utils/environment');

// ─────────────────────────────────────────────────────────────────────────────
// RECORDING  (fire-and-forget — never blocks or throws into the request path)
// ─────────────────────────────────────────────────────────────────────────────

const write = (doc) => {
  if (!analyticsEnabled()) return;                 // dev traffic is skipped by default
  AnalyticsEvent.create({ ...doc, env: currentEnv(), timestamp: new Date() })
    .catch((err) => {
      if (process.env.ANALYTICS_DEBUG === 'true') {
        console.error('[analytics] write failed:', err.message);
      }
    });
};

const recordPageView = ({ context = {}, page, pageTitle = '', eventType = 'PAGE_VIEW' }) =>
  write({ category: 'page', eventType, page, pageTitle, status: 'success', ...context });

const recordEvent = ({ context = {}, eventType, metadata = {}, status = 'success' }) =>
  write({ category: 'event', eventType, metadata, status, ...context });

const recordApiUsage = ({ context = {}, api, method, statusCode, duration }) =>
  write({
    category: 'api',
    eventType: 'API_CALL',
    api, method, statusCode, duration,
    status: statusCode >= 400 ? 'failure' : 'success',
    ...context
  });

const recordSession = ({ context = {}, eventType, metadata = {} }) =>
  write({ category: 'session', eventType, metadata, status: 'success', ...context });

// ─────────────────────────────────────────────────────────────────────────────
// QUERIES  (dashboard) — all scoped to viewEnv() so only production shows
// ─────────────────────────────────────────────────────────────────────────────

const daysAgo = (n) => new Date(Date.now() - n * 864e5);
const minsAgo = (n) => new Date(Date.now() - n * 6e4);
const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const round = (n, d = 1) => (n == null ? 0 : Number(Number(n).toFixed(d)));

const range = (from, to) => ({ $gte: from || daysAgo(30), $lte: to || new Date() });
const baseMatch = (from, to) => ({ env: viewEnv(), timestamp: range(from, to) });

// Top users (optionally by role), with name/email joined from the users collection
const mostActiveUsers = async (limit = 5, role = null, from) => {
  const match = { env: viewEnv(), user: { $ne: null }, timestamp: range(from) };
  if (role) match.role = role;
  return AnalyticsEvent.aggregate([
    { $match: match },
    { $group: { _id: '$user', events: { $sum: 1 }, role: { $first: '$role' } } },
    { $sort: { events: -1 } },
    { $limit: limit },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
    { $project: {
        userId: '$_id', _id: 0, events: 1, role: 1,
        name: { $ifNull: [{ $arrayElemAt: ['$u.fullName', 0] }, 'Unknown'] },
        email: { $arrayElemAt: ['$u.email', 0] }
      } }
  ]);
};

const avgSessionDurationMs = async (from) => {
  const res = await AnalyticsEvent.aggregate([
    { $match: { env: viewEnv(), sessionId: { $ne: '' }, timestamp: range(from) } },
    { $group: { _id: '$sessionId', start: { $min: '$timestamp' }, end: { $max: '$timestamp' } } },
    { $project: { durMs: { $subtract: ['$end', '$start'] } } },
    { $group: { _id: null, avg: { $avg: '$durMs' } } }
  ]);
  return round((res[0]?.avg || 0) / 1000, 0); // seconds
};

const overview = async () => {
  const env = viewEnv();
  const [today, weekly, monthly, total, sessions, pageViews, active, avgDur] = await Promise.all([
    AnalyticsEvent.distinct('user', { env, user: { $ne: null }, timestamp: { $gte: startOfDay() } }),
    AnalyticsEvent.distinct('user', { env, user: { $ne: null }, timestamp: { $gte: daysAgo(7) } }),
    AnalyticsEvent.distinct('user', { env, user: { $ne: null }, timestamp: { $gte: daysAgo(30) } }),
    AnalyticsEvent.distinct('user', { env, user: { $ne: null } }),
    AnalyticsEvent.distinct('sessionId', { env, sessionId: { $ne: '' }, timestamp: { $gte: minsAgo(30) } }),
    AnalyticsEvent.countDocuments({ env, category: 'page' }),
    mostActiveUsers(5, null, daysAgo(30)),
    avgSessionDurationMs(daysAgo(30))
  ]);
  return {
    todayUsers: today.length,
    weeklyUsers: weekly.length,
    monthlyUsers: monthly.length,
    totalUsers: total.length,
    activeSessions: sessions.length,
    totalPageViews: pageViews,
    avgSessionDurationSec: avgDur,
    mostActiveUsers: active
  };
};

const pages = async (from, to) => {
  const match = { ...baseMatch(from, to), category: 'page' };
  const [top, trend] = await Promise.all([
    AnalyticsEvent.aggregate([
      { $match: match },
      { $group: {
          _id: '$page', visits: { $sum: 1 },
          visitors: { $addToSet: { $ifNull: ['$user', '$sessionId'] } },
          title: { $first: '$pageTitle' } } },
      { $project: { page: '$_id', _id: 0, visits: 1, title: 1, uniqueVisitors: { $size: '$visitors' } } },
      { $sort: { visits: -1 } },
      { $limit: 50 }
    ]),
    AnalyticsEvent.aggregate([
      { $match: match },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, count: { $sum: 1 } } },
      { $project: { date: '$_id', _id: 0, count: 1 } },
      { $sort: { date: 1 } }
    ])
  ]);
  const totalVisits = top.reduce((s, p) => s + p.visits, 0);
  return { mostVisited: top, trend, averageVisitsPerPage: top.length ? round(totalVisits / top.length) : 0 };
};

const events = async (from, to) => {
  const rows = await AnalyticsEvent.aggregate([
    { $match: { ...baseMatch(from, to), category: 'event' } },
    { $group: {
        _id: '$eventType', count: { $sum: 1 },
        success: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
        failure: { $sum: { $cond: [{ $eq: ['$status', 'failure'] }, 1, 0] } } } },
    { $project: { eventType: '$_id', _id: 0, count: 1, success: 1, failure: 1 } },
    { $sort: { count: -1 } }
  ]);
  const total = rows.reduce((s, r) => s + r.count, 0);
  const success = rows.reduce((s, r) => s + r.success, 0);
  const failure = rows.reduce((s, r) => s + r.failure, 0);
  return {
    events: rows,
    totalEvents: total,
    successRate: total ? round((success / total) * 100) : 0,
    failureRate: total ? round((failure / total) * 100) : 0
  };
};

const apis = async (from, to) => {
  const rows = await AnalyticsEvent.aggregate([
    { $match: { ...baseMatch(from, to), category: 'api' } },
    { $group: {
        _id: { api: '$api', method: '$method' },
        calls: { $sum: 1 }, avgMs: { $avg: '$duration' },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failure'] }, 1, 0] } } } },
    { $project: {
        _id: 0, api: '$_id.api', method: '$_id.method', calls: 1,
        avgMs: { $round: ['$avgMs', 1] }, failed: 1,
        successPct: { $round: [{ $multiply: [{ $divide: [{ $subtract: ['$calls', '$failed'] }, '$calls'] }, 100] }, 1] } } }
  ]);
  const byCalls = [...rows].sort((a, b) => b.calls - a.calls).slice(0, 20);
  const slowest = [...rows].sort((a, b) => (b.avgMs || 0) - (a.avgMs || 0)).slice(0, 10);
  const failed  = rows.filter((r) => r.failed > 0).sort((a, b) => b.failed - a.failed).slice(0, 10);
  return { mostCalled: byCalls, slowest, failed };
};

const users = async (from, to) => {
  const env = viewEnv();
  // DAU/WAU/MAU are rolling windows by definition; the trend + top lists follow the filter.
  const [dau, wau, mau, trend, experts, businesses] = await Promise.all([
    AnalyticsEvent.distinct('user', { env, user: { $ne: null }, timestamp: { $gte: daysAgo(1) } }),
    AnalyticsEvent.distinct('user', { env, user: { $ne: null }, timestamp: { $gte: daysAgo(7) } }),
    AnalyticsEvent.distinct('user', { env, user: { $ne: null }, timestamp: { $gte: daysAgo(30) } }),
    AnalyticsEvent.aggregate([
      { $match: { env, user: { $ne: null }, timestamp: range(from, to) } },
      { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, user: '$user' } } },
      { $group: { _id: '$_id.day', users: { $sum: 1 } } },
      { $project: { date: '$_id', _id: 0, users: 1 } },
      { $sort: { date: 1 } }
    ]),
    mostActiveUsers(5, 'Expert', from || daysAgo(30)),
    mostActiveUsers(5, 'Business', from || daysAgo(30))
  ]);
  return {
    dailyActiveUsers: dau.length,
    weeklyActiveUsers: wau.length,
    monthlyActiveUsers: mau.length,
    activeTrend: trend,
    mostActiveExperts: experts,
    mostActiveBusinesses: businesses
  };
};

const FUNNEL_STEPS = [
  { key: 'visitedSignup',       label: 'Visited Signup',        match: { category: 'page', page: { $regex: 'register|signup|sign-up', $options: 'i' } } },
  { key: 'createdAccount',      label: 'Created Account',       match: { eventType: 'SIGNUP' } },
  { key: 'startedOnboarding',   label: 'Started Onboarding',    match: { eventType: 'ONBOARDING_STARTED' } },
  { key: 'completedOnboarding', label: 'Completed Onboarding',  match: { eventType: 'ONBOARDING_COMPLETED' } },
  { key: 'createdFirstProject', label: 'Created First Project', match: { eventType: 'PROJECT_CREATED' } },
  { key: 'scheduledFirstCall',  label: 'Scheduled First Call',  match: { eventType: 'CALL_SCHEDULED' } }
];

const funnels = async () => {
  const facet = {};
  FUNNEL_STEPS.forEach((s) => {
    facet[s.key] = [{ $match: s.match }, { $group: { _id: '$actor' } }, { $count: 'n' }];
  });
  const res = await AnalyticsEvent.aggregate([
    { $match: { env: viewEnv() } },
    { $addFields: { actor: { $ifNull: ['$user', '$sessionId'] } } },
    { $facet: facet }
  ]);
  const counts = res[0] || {};
  let prev = null;
  return FUNNEL_STEPS.map((s) => {
    const count = counts[s.key]?.[0]?.n || 0;
    const dropOff = prev == null || prev === 0 ? 0 : round(((prev - count) / prev) * 100);
    prev = count;
    return { step: s.label, count, dropOffPct: dropOff };
  });
};

const FEATURE_MAP = {
  'AI Chat':            ['AI_CHAT_STARTED', 'AI_CHAT_COMPLETED', 'STRATEGY_GENERATED'],
  'Marketplace':        ['MARKETPLACE_OPENED', 'EXPERT_PROFILE_VIEWED', 'BUSINESS_PROFILE_VIEWED'],
  'Projects':           ['PROJECT_CREATED', 'PROJECT_UPDATED', 'PROJECT_VIEWED'],
  'Resources':          ['RESOURCE_DOWNLOADED', 'RESOURCE_VIEWED'],
  'CRM':                ['CRM_CONNECTED', 'LEAD_IMPORTED'],
  'Campaigns':          ['CAMPAIGN_CREATED', 'CAMPAIGN_SENT'],
  'Payments':           ['PAYMENT_STARTED', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED'],
  'Strategy Generator': ['STRATEGY_GENERATED']
};

const features = async (from, to) => {
  const rows = await AnalyticsEvent.aggregate([
    { $match: { ...baseMatch(from, to), category: 'event' } },
    { $group: { _id: '$eventType', count: { $sum: 1 } } }
  ]);
  const byType = Object.fromEntries(rows.map((r) => [r._id, r.count]));
  return Object.entries(FEATURE_MAP).map(([feature, types]) => ({
    feature,
    usage: types.reduce((s, t) => s + (byType[t] || 0), 0)
  })).sort((a, b) => b.usage - a.usage);
};

const geography = async (from, to) => {
  const groupBy = (field) => AnalyticsEvent.aggregate([
    { $match: { ...baseMatch(from, to), [field]: { $ne: '' } } },
    { $group: { _id: `$${field}`, events: { $sum: 1 }, users: { $addToSet: { $ifNull: ['$user', '$sessionId'] } } } },
    { $project: { name: '$_id', _id: 0, events: 1, users: { $size: '$users' } } },
    { $sort: { users: -1 } },
    { $limit: 50 }
  ]);
  const [countries, cities] = await Promise.all([groupBy('country'), groupBy('city')]);
  return { byCountry: countries, byCity: cities };
};

const realtime = async () => {
  const env = viewEnv();
  const since = minsAgo(5);
  const [online, sessions, currentPages, recentEvents] = await Promise.all([
    AnalyticsEvent.distinct('user', { env, user: { $ne: null }, timestamp: { $gte: since } }),
    AnalyticsEvent.distinct('sessionId', { env, sessionId: { $ne: '' }, timestamp: { $gte: since } }),
    AnalyticsEvent.aggregate([
      { $match: { env, category: 'page', timestamp: { $gte: since } } },
      { $group: { _id: '$page', active: { $sum: 1 } } },
      { $project: { page: '$_id', _id: 0, active: 1 } },
      { $sort: { active: -1 } },
      { $limit: 10 }
    ]),
    AnalyticsEvent.find({ env, category: { $in: ['event', 'page'] }, timestamp: { $gte: minsAgo(60) } })
      .sort({ timestamp: -1 }).limit(20)
      .select('eventType page role status timestamp -_id').lean()
  ]);
  return {
    usersOnline: online.length,
    activeSessions: sessions.length,
    currentPages,
    recentEvents
  };
};

module.exports = {
  // recording
  recordPageView, recordEvent, recordApiUsage, recordSession,
  // dashboard
  overview, pages, events, apis, users, funnels, features, geography, realtime
};
