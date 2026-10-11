// config/permissions.js
//
// What each role inside an enterprise organization may do.
//
// Checks ask for a CAPABILITY, never a role:
//
//     can(membership, 'campaign.start')        ✓
//     membership.role === 'admin'              ✗
//
// The second form looks shorter until a fourth role appears — then every
// scattered role check has to be found and edited. One place decides,
// everything else reads it.
//
// Two kinds of account are NOT in this table:
//   • Individual accounts have no membership at all. They own their data
//     outright, so requireCapability lets them straight through.
//   • Platform admins (User.isAdmin) are staff, not members of anyone's
//     company, and are handled separately by restrictTo.

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

  // Money — one plan and one credit pool for the whole organization
  'billing.view',
  'billing.manage',          // buy projects and credits, change plan

  // People
  'members.view',
  'members.invite',
  'members.manage',          // change roles, suspend, remove

  // The org itself
  'org.view',
  'org.manage',              // rename, company profile, settings
];

const ALL = new Set(CAPABILITIES);

// ── Role → capabilities ─────────────────────────────────────────────────────
//
// Read top to bottom; each role is a superset of the one below it.

const ADMIN = [...CAPABILITIES];

const MANAGER = CAPABILITIES.filter((c) => ![
  'billing.manage',   // only an Admin spends the company's money
  'members.manage',   // a manager can bring people in, not change or remove them
  'org.manage',
].includes(c));

const EMPLOYEE = [
  'campaign.view',
  'campaign.create',
  'campaign.edit',
  'campaign.submitForApproval',   // builds it, then asks
  'icp.view',
  'leads.view',
  'leads.search',
  'templates.view',
  'templates.manage',
  'billing.view',
  'members.view',
  'org.view',
  // Deliberately absent: campaign.start, campaign.approve, campaign.delete,
  // icp.approve, leads.export, billing.manage. An employee must not be able
  // to spend the company's credits unreviewed or walk out with the lead list.
];

const ROLE_CAPABILITIES = {
  admin: new Set(ADMIN),
  manager: new Set(MANAGER),
  employee: new Set(EMPLOYEE),
};

const ROLES = Object.keys(ROLE_CAPABILITIES);

// Which roles someone may hand out. A manager can only bring in employees —
// otherwise inviting a second admin would be a way around every limit above.
const INVITABLE_ROLES = {
  admin: ['admin', 'manager', 'employee'],
  manager: ['employee'],
  employee: [],
};

/**
 * Does this membership allow this capability?
 *
 * @param {object} membership  a Membership document or plain object
 * @param {string} capability  one of CAPABILITIES
 */
function can(membership, capability) {
  if (!membership || !capability) return false;
  if (!ALL.has(capability)) return false;              // typo — deny, don't guess

  // A suspended or still-pending membership grants nothing, whatever the role says.
  if (membership.status && membership.status !== 'active') return false;

  const base = ROLE_CAPABILITIES[membership.role];
  return !!base && base.has(capability);
}

/**
 * The flat list the frontend renders from.
 *
 * Sent with the org context so the UI can hide what it must, while every
 * route still checks independently — a hidden button is UX, not security.
 */
function capabilitiesFor(membership) {
  if (!membership) return [];
  return CAPABILITIES.filter((c) => can(membership, c));
}

/**
 * How much of the org this membership can see.
 *
 *   all → every record in the org   (admin, manager)
 *   own → only what they created    (employee)
 */
function visibilityFor(membership) {
  if (!membership) return { mode: 'none' };
  return { mode: membership.role === 'employee' ? 'own' : 'all' };
}

/** May someone holding `actorRole` invite or assign `targetRole`? */
function canAssignRole(actorRole, targetRole) {
  return (INVITABLE_ROLES[actorRole] || []).includes(targetRole);
}

module.exports = {
  CAPABILITIES,
  ROLES,
  ROLE_CAPABILITIES,
  INVITABLE_ROLES,
  can,
  capabilitiesFor,
  visibilityFor,
  canAssignRole,
};
