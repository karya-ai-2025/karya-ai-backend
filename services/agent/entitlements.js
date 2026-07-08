/**
 * Agent entitlements — does this user own the project that unlocks a paid action?
 *
 * Ownership lives in ProjectUser (one doc per purchased project slug). Access is
 * per-slug/per-tab, mirroring the frontend PROJECT_TAB_ACCESS map:
 *   leads      → owns 'hotlead-in-a-box' OR 'outbound-list-builder'
 *   campaigns  → owns 'hotlead-in-a-box' OR 'ai-email-sales-agency'
 *
 * No new storage — this only reads existing ProjectUser records.
 */

const ProjectUser = require('../../models/ProjectUser');

const LEADS_SLUGS = ['hotlead-in-a-box', 'outbound-list-builder'];
const EMAIL_SLUGS = ['hotlead-in-a-box', 'ai-email-sales-agency'];

const ownsAnySlug = async (userId, slugs) => {
  if (!userId) return false;
  const doc = await ProjectUser.findOne({ userId, projectSlug: { $in: slugs } })
    .select('_id')
    .lean();
  return Boolean(doc);
};

const hasLeadsAccess = (userId) => ownsAnySlug(userId, LEADS_SLUGS);
const hasEmailAccess = (userId) => ownsAnySlug(userId, EMAIL_SLUGS);

// A uiRequest the chat renders as a "buy this project to unlock" card.
const buildBuyCard = (kind, feature) => {
  if (kind === 'email') {
    return {
      type: 'buy_project',
      feature: feature || 'send email campaigns',
      projectSlug: 'ai-email-sales-agency',
      projectName: 'AI Email Outbound Engine',
      marketplaceUrl: '/project-marketplace/ai-email-sales-agency'
    };
  }
  return {
    type: 'buy_project',
    feature: feature || 'unlock the full lead list',
    projectSlug: 'outbound-list-builder',
    projectName: 'B2B Contact Intelligence Engine',
    marketplaceUrl: '/project-marketplace/outbound-list-builder'
  };
};

module.exports = {
  LEADS_SLUGS,
  EMAIL_SLUGS,
  hasLeadsAccess,
  hasEmailAccess,
  buildBuyCard
};
