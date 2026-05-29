const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_REGEX = /(?:\+?\d[\d\s().-]{7,}\d)/;
const URL_REGEX = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?\b/i;
const URL_GLOBAL_REGEX = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?\b/gi;

const cleanValue = (value = '') => String(value)
  .replace(/^[\s:,-]+/, '')
  .replace(/[\s.]+$/, '')
  .trim();

const extractByLabels = (message, labels) => {
  const updates = {};
  const lines = String(message || '').split(/\r?\n|;/);

  lines.forEach((line) => {
    labels.forEach(({ key, aliases }) => {
      if (updates[key]) return;

      const aliasPattern = aliases.map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      const match = line.match(new RegExp(`\\b(?:${aliasPattern})\\b\\s*(?:is|are|=|:|-)?\\s*(.+)$`, 'i'));
      if (match?.[1]) {
        updates[key] = cleanValue(match[1]);
      }
    });
  });

  return updates;
};

const splitList = (value) => String(value || '')
  .split(/,|\/|\band\b/i)
  .map((item) => cleanValue(item))
  .filter(Boolean);

const extractWebsiteUrls = (message) => {
  const text = String(message || '');
  const matches = text.match(URL_GLOBAL_REGEX) || [];

  return [...new Set(matches)]
    .filter((url) => !EMAIL_REGEX.test(url))
    .map((url) => cleanValue(url));
};

const detectDiagnosticRunIntent = (message) => (
  /\b(run|start|continue|proceed|go ahead|skip|basic|diagnostic|diagnose|review|plan|create growth plan|growth plan|business review|nothing else|that's all|that is all)\b/i.test(String(message || ''))
);

const extractTimeframeDays = (message) => {
  const text = String(message || '').toLowerCase();
  const explicitDayMatch = text.match(/\b(30|60|90)\s*[- ]?\s*days?\b/);
  if (explicitDayMatch?.[1]) return Number(explicitDayMatch[1]);

  const weekMatch = text.match(/\b([1-9]\d?)\s*[- ]?\s*weeks?\b/);
  if (weekMatch?.[1]) return Number(weekMatch[1]) * 7;

  const monthMatch = text.match(/\b([1-9]\d?)\s*[- ]?\s*months?\b/);
  if (monthMatch?.[1]) return Number(monthMatch[1]) * 30;

  if (/\b(next quarter|quarterly|in a quarter)\b/.test(text)) return 90;
  if (/\b(next month|monthly|in a month)\b/.test(text)) return 30;

  return null;
};

const extractTargetMetric = (message) => {
  const text = cleanValue(message);
  const cleanMetricValue = (value) => cleanValue(value)
    .replace(/\s+\b(?:in|within)\s+\d+\s*(?:days?|months?)\b/i, '')
    .replace(/\s+\b(?:in|within)\s+(?:a|one)\s+month\b/i, '')
    .replace(/\s+\b(?:next quarter|this quarter)\b/i, '');

  const rateRange = text.match(/\b(?:improve|increase|grow|raise|lift)?\s*([^.,;\n]{0,50}?(?:reply|conversion|close|open|lead|win)?\s*rate[^.,;\n]{0,40}?\d+(?:\.\d+)?\s*(?:%|percent)?\s*(?:to|from)\s*\d+(?:\.\d+)?\s*(?:%|percent)?)/i);
  if (rateRange?.[1]) return cleanMetricValue(rateRange[1]);

  const actionMetric = text.match(/\b(?:book|generate|get|close|create|schedule|source|improve|increase|grow|raise|lift|reduce|work with|work)\s+([^.,;\n]{0,120}?\d[\d,.]*\s*(?:%|percent)?[^.,;\n]*)/i);
  if (actionMetric?.[1]) return cleanMetricValue(actionMetric[1]);

  const nounMetric = text.match(/\b\d[\d,.]*\s*(?:qualified\s+)?(?:demos?|leads?|meetings?|calls?|opportunities?|customers?|clients?|projects?|hours?(?:\s+per\s+week)?|percent|%)\b[^.,;\n]*/i);
  if (nounMetric?.[0]) return cleanMetricValue(nounMetric[0]);

  return '';
};

const classifyGoalType = (message, userType) => {
  const text = String(message || '').toLowerCase();

  if (userType === 'expert') {
    if (/\b(match|matched|client|project|work with|opportunity)\b/.test(text)) return 'matching';
    if (/\b(hour|availability|capacity|week)\b/.test(text)) return 'availability';
    return 'expert_preference';
  }

  if (/\b(demos?|leads?|pipeline|opportunit(?:y|ies)|meetings?|bookings?)\b/.test(text)) return 'pipeline';
  if (/\b(reply|conversion|convert|close rate|win rate)\b/.test(text)) return 'conversion';
  if (/\b(revenue|mrr|arr|sales)\b/.test(text)) return 'revenue';
  if (/\b(process|system|playbook|motion|foundation)\b/.test(text)) return 'process';

  return 'growth';
};

const hasClearGoalSignal = ({ message, userType, targetMetric, timeframeDays }) => {
  const text = String(message || '').toLowerCase();

  if (targetMetric || timeframeDays) return true;

  if (userType === 'expert') {
    return /\b(match|matched|project|client|work with|hours? per week|availability|capacity|preferred)\b/.test(text);
  }

  return /\b(process|system|playbook|motion|foundation|predictable|repeatable)\b/.test(text)
    && /\b(sales|marketing|outbound|inbound|growth|founder-led)\b/.test(text);
};

const buildGoalClarificationQuestion = (userType) => {
  if (userType === 'expert') {
    return 'What kind of projects or clients do you want to be matched with, and how much weekly capacity should we plan around?';
  }

  return 'What measurable target and timeframe should we use for this goal, for example demos, leads, reply rate, revenue, or a 30/60/90 day target?';
};

const extractGoalFields = (message, userType = 'business') => {
  const description = cleanValue(message);
  if (!description) return {};

  const timeframeDays = extractTimeframeDays(description);
  const targetMetric = extractTargetMetric(description);
  const type = classifyGoalType(description, userType);
  const isClear = hasClearGoalSignal({
    message: description,
    userType,
    targetMetric,
    timeframeDays
  });

  return {
    type,
    description,
    timeframeDays,
    targetMetric,
    confirmed: false,
    isClear,
    clarificationQuestion: isClear ? null : buildGoalClarificationQuestion(userType)
  };
};

const detectGoalConfirmation = (message) => {
  const text = String(message || '').toLowerCase();
  if (/\b(no|not quite|change|revise|edit|different|wrong|incorrect)\b/.test(text)) return false;
  return /\b(yes|confirm|confirmed|correct|right|looks good|sounds good|proceed|go ahead|that works)\b/.test(text);
};

const detectGoalRevisionRequest = (message) => (
  /\b(no|not quite|change|revise|edit|different|wrong|incorrect|start over)\b/i.test(String(message || ''))
);

const extractIdentityFields = (message) => {
  const text = String(message || '');
  const updates = {};
  const email = text.match(EMAIL_REGEX)?.[0];
  const phone = text.match(PHONE_REGEX)?.[0];

  if (email) updates.email = email.toLowerCase();
  if (phone) updates.phone = cleanValue(phone);

  const labelUpdates = extractByLabels(text, [
    { key: 'name', aliases: ['name', 'full name'] },
    { key: 'email', aliases: ['email', 'email address'] },
    { key: 'phone', aliases: ['phone', 'phone number', 'mobile'] }
  ]);

  Object.assign(updates, labelUpdates);

  if (!updates.name) {
    const nameMatch = text.match(/\b(?:my name is|i am|i'm)\s+([a-z][a-z\s.'-]{1,60})/i);
    if (nameMatch?.[1]) {
      updates.name = cleanValue(nameMatch[1]);
    }
  }

  return updates;
};

const extractUserType = (message) => {
  const text = String(message || '').toLowerCase();

  if (/\b(expert|consultant|freelancer|agency partner|service provider)\b/.test(text)) {
    return 'expert';
  }

  if (/\b(business|business user|owner|founder|company|startup|brand)\b/.test(text)) {
    return 'business';
  }

  return null;
};

const extractBusinessFields = (message) => {
  const text = String(message || '');
  const updates = extractByLabels(text, [
    { key: 'companyName', aliases: ['company', 'company name', 'business name'] },
    { key: 'website', aliases: ['website', 'site', 'url'] },
    { key: 'industry', aliases: ['industry', 'sector'] },
    { key: 'targetCustomer', aliases: ['target customer', 'target audience', 'icp', 'customers'] },
    { key: 'channels', aliases: ['channels', 'sales channels', 'marketing channels'] },
    { key: 'budget', aliases: ['budget', 'monthly budget'] },
    { key: 'constraints', aliases: ['constraints', 'blockers', 'limitations'] },
    { key: 'desiredOutcome', aliases: ['desired outcome', 'goal', 'outcome'] }
  ]);

  const website = text.match(URL_REGEX)?.[0];
  if (website && !updates.website && !EMAIL_REGEX.test(website)) {
    updates.website = website;
  }

  if (!updates.industry) {
    const industryMatch = text.match(/\b(?:we are|we're|our company is)\s+(?:a|an)?\s*([^.,\n]{2,80}?)\s+(?:company|business|startup|brand)\b/i);
    if (industryMatch?.[1]) {
      updates.industry = cleanValue(industryMatch[1]);
    }
  }

  if (!updates.targetCustomer) {
    const targetMatch = text.match(/\b(?:selling to|targeting|serving|serve)\s+([^.,\n]{2,120})/i);
    if (targetMatch?.[1]) {
      updates.targetCustomer = cleanValue(targetMatch[1]);
    }
  }

  return updates;
};

const extractExpertFields = (message) => {
  const text = String(message || '');
  const updates = extractByLabels(text, [
    { key: 'skills', aliases: ['skills', 'skill set', 'expertise'] },
    { key: 'industriesServed', aliases: ['industries served', 'industries', 'markets'] },
    { key: 'projectExperience', aliases: ['project experience', 'experience', 'past projects'] },
    { key: 'availability', aliases: ['availability', 'available'] },
    { key: 'capacity', aliases: ['capacity', 'hours per week', 'weekly capacity'] },
    { key: 'preferredProjectTypes', aliases: ['preferred project types', 'project types', 'preferred projects'] },
    { key: 'portfolioProof', aliases: ['portfolio', 'proof', 'case study', 'case studies'] }
  ]);

  ['skills', 'industriesServed', 'preferredProjectTypes'].forEach((key) => {
    if (typeof updates[key] === 'string') {
      updates[key] = splitList(updates[key]);
    }
  });

  const url = text.match(URL_REGEX)?.[0];
  if (url && !updates.portfolioProof && !EMAIL_REGEX.test(url)) {
    updates.portfolioProof = url;
  }

  return updates;
};

module.exports = {
  extractIdentityFields,
  extractUserType,
  extractBusinessFields,
  extractExpertFields,
  extractGoalFields,
  extractWebsiteUrls,
  detectGoalConfirmation,
  detectGoalRevisionRequest,
  detectDiagnosticRunIntent,
  splitList
};
