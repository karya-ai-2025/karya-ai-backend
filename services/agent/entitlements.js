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
const { accountUserIdFor, userHasCapability } = require('../../middleware/orgContext');

const LEADS_SLUGS = ['hotlead-in-a-box', 'outbound-list-builder'];
const EMAIL_SLUGS = ['hotlead-in-a-box', 'ai-email-sales-agency'];

const ownsAnySlug = async (userId, slugs) => {
  if (!userId) return false;
  // Enterprise members are entitled to whatever their organization owns.
  const ownerId = await accountUserIdFor(userId);
  const doc = await ProjectUser.findOne({ userId: ownerId, projectSlug: { $in: slugs } })
    .select('_id')
    .lean();
  return Boolean(doc);
};

const hasLeadsAccess = (userId) => ownsAnySlug(userId, LEADS_SLUGS);
const hasEmailAccess = (userId) => ownsAnySlug(userId, EMAIL_SLUGS);

// Owning the project isn't the whole story: building a campaign also needs
// campaign.create, which a business only holds when Karya has switched
// self-serve on for it. Otherwise its partner or the Karya team builds it.
const canBuildCampaigns = (userId) => userHasCapability(userId, 'campaign.create');

const NOT_SELF_SERVE_MESSAGE =
  "Campaigns for your company are built by your partner or the Karya team, and sent to you for approval before anything goes out. " +
  "I can still help you plan the audience and the message, and you can ask the Karya team to write the emails for you.";

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
  canBuildCampaigns,
  NOT_SELF_SERVE_MESSAGE,
  buildBuyCard
};
