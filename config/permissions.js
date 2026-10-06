// config/permissions.js
//
// What each role inside an organization may do.
//
// Checks ask for a CAPABILITY, never a role:
//
//     can(membership, 'campaign.start')        ✓
//     membership.role === 'admin'              ✗
//
// The second form looks shorter until a fourth role appears — then every
// scattered role check has to be found and edited. The same lesson as
// tabAccessFor: one place decides, everything else reads it.
//
// Platform admins (User.isAdmin) are NOT in this table. They are staff, not
// members of anyone's company, and are handled separately by restrictTo.

// ── The vocabulary ──────────────────────────────────────────────────────────
const CAPABILITIES = [
  // Campaigns
  'campaign.view',
  'campaign.create',
  'campaign.edit',
  'campaign.submitForApproval',
  'campaign.approve',        // sign off someone else's campaign
  'campaign.start',          // spends credits — the one that matters most
  'campaign.delete',

  // ICP
  'icp.view',
  'icp.approve',

  // Leads
  'leads.view',
  'leads.search',
  'leads.export',            // the valuable asset leaving the building

  // Templates
  'templates.view',
  'templates.manage',

  // Money
  'billing.view',
  'billing.manage',          // buy credits, change plan

  // People
  'members.view',
  'members.invite',
  'members.manage',          // change roles, suspend
  'contractors.manage',      // hire/remove experts

  // The org itself
  'org.view',
  'org.manage',              // rename, domains, settings
  'org.delete',
];

const ALL = new Set(CAPABILITIES);

// ── Role → capabilities ─────────────────────────────────────────────────────
//
// Read this table top to bottom; each role is a superset of the one below it,
// except contractor, which is deliberately a different shape rather than a
// smaller member.

const OWNER = [...CAPABILITIES];

const ADMIN = CAPABILITIES.filter((c) => ![
  'billing.manage',   // only an Owner spends the company's money on the plan
  'org.delete',
].includes(c));

const MEMBER = [
  'campaign.view',
  'campaign.create',
  'campaign.edit',
  'campaign.submitForApproval',   // builds it, then asks
  'icp.view',
  'leads.view',
  'leads.search',
  'templates.view',
  'templates.manage',
  'members.view',
  'org.view',
  // Deliberately absent: campaign.start, campaign.approve, icp.approve,
  // leads.export, billing.*. A member must not be able to spend the
  // company's credits or walk out with the lead list.
];

const CONTRACTOR = [
  'campaign.view',        // only their assigned campaigns — enforced by scope
  'campaign.edit',
  'campaign.submitForApproval',
  'icp.view',
  'templates.view',
  'templates.manage',
  'org.view',
  // Deliberately absent: everything to do with leads, money and people.
  // A hired expert may work for a competitor next month.
];

const ROLE_CAPABILITIES = {
  owner: new Set(OWNER),
  admin: new Set(ADMIN),
  member: new Set(MEMBER),
  contractor: new Set(CONTRACTOR),
};

// Contractors never see the raw lead list by default. An Owner can grant it
// per membership later; until then this stays off.
const GRANTABLE_TO_CONTRACTOR = new Set(['leads.view', 'leads.search']);

/**
 * Does this membership allow this capability?
 *
 * @param {object} membership  a Membership document or plain object
 * @param {string} capability  one of CAPABILITIES
 */
function can(membership, capability) {
  if (!membership || !capability) return false;
  if (!ALL.has(capability)) return false;              // typo — deny, don't guess

  // An expired or suspended membership grants nothing, whatever the role says.
  if (membership.status && membership.status !== 'active') return false;
  if (membership.expiresAt && new Date(membership.expiresAt).getTime() <= Date.now()) return false;

  const base = ROLE_CAPABILITIES[membership.role];
  if (!base) return false;
  if (base.has(capability)) return true;

  // Per-membership grants, currently only meaningful for contractors.
  const extra = Array.isArray(membership.extraCapabilities) ? membership.extraCapabilities : [];
  if (extra.includes(capability) && GRANTABLE_TO_CONTRACTOR.has(capability)) return true;

  return false;
}

/**
 * The flat list the frontend renders from.
 *
 * Sent once per org context so the UI can hide what it must, while every
 * route still checks independently — a hidden button is UX, not security.
 */
function capabilitiesFor(membership) {
  if (!membership) return [];
  return CAPABILITIES.filter((c) => can(membership, c));
}

/**
 * How much of the org this membership can see.
 *
 *   all  → every record in the org
 *   team → their own plus their team's (until teams exist, same as own)
 *   own  → only what they created
 *
 * Contractors are always narrowed to their assigned campaigns regardless.
 */
function visibilityFor(membership) {
  if (!membership) return { mode: 'none' };

  if (membership.role === 'contractor') {
    return {
      mode: 'campaigns',
      campaignIds: (membership.campaignIds || []).map(String),
    };
  }

  if (membership.role === 'owner' || membership.role === 'admin') {
    return { mode: 'all' };
  }

  return { mode: membership.scope === 'all' ? 'all' : membership.scope === 'team' ? 'team' : 'own' };
}

module.exports = {
  CAPABILITIES,
  ROLE_CAPABILITIES,
  can,
  capabilitiesFor,
  visibilityFor,
};
