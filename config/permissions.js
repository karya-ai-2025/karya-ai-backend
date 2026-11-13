// config/permissions.js
//
// What each role may do, per kind of organization. The one place that decides.
//
// Checks ask for a CAPABILITY, never a role or an account flag:
//
//     can(membership, organization, 'campaign.start')    ✓
//     membership.role === 'admin'                         ✗
//     user.isAdmin                                        ✗
//
// The second and third forms look shorter until a new role or a new kind of
// account appears — then every scattered check has to be found and edited.
//
// Every account belongs to exactly one organization, and the organization's
// type matches the account's kind:
//
//   business → buys projects, sees its leads, reviews and approves work, pays.
//              It does NOT build campaigns itself: a partner or the Karya team
//              does, unless Karya has switched on `settings.selfServe` for it.
//   partner  → an agency doing the work. Its access to a business's project
//              comes from an engagement (a later step); here it only manages
//              its own team and organization.
//   platform → the Karya team (a later step); same here.
//
// Roles are the same three words in every organization — admin, manager,
// employee — and mean "owner / runs the team", "lead" and "member". The UI
// labels them per kind.

// ── The vocabulary ──────────────────────────────────────────────────────────
const CAPABILITIES = [
  // Campaigns
  'campaign.view',
  'campaign.create',
  'campaign.edit',
  'campaign.submitForApproval',
  'campaign.approve',        // sign off a campaign someone else built
  'campaign.start',          // spends credits — the one that matters most
  'campaign.delete',

  // ICP
  'icp.view',
  'icp.approve',

  // Leads
  'leads.view',
  'leads.search',            // search and reveal contact details (spends credits)
  'leads.save',              // keep a list of leads for later
  'leads.export',            // the valuable asset leaving the building

  // Templates
  'templates.view',
  'templates.manage',

  // Money — one plan and one credit pool per organization
  'billing.view',
  'billing.manage',          // buy projects and credits, change plan

  // People
  'members.view',
  'members.invite',
  'members.manage',          // change roles, suspend, remove

  // The organization itself
  'org.view',
  'org.manage',              // rename, company profile, settings

  // A project's plan — the agency's / expert's own milestones and tasks
  'plan.view',               // follow milestone progress (the business does this)
  'plan.edit',               // plan and track the work (the people doing it)

  // Workers (agencies / third-party experts) on the business's projects
  'partners.view',
  'partners.manage',         // invite a worker, change what they may do, pause / end
];

const ALL = new Set(CAPABILITIES);
const ROLES = ['admin', 'manager', 'employee'];
const ORG_TYPES = ['business', 'partner', 'platform'];

// ── Business ────────────────────────────────────────────────────────────────
// The buyer's side. Read top to bottom; each role is a superset of the next.

const BUSINESS = {
  admin: [
    'campaign.view', 'campaign.approve',
    'icp.view', 'icp.approve',
    'leads.view', 'leads.search', 'leads.save', 'leads.export',
    'templates.view',
    'billing.view', 'billing.manage',
    'members.view', 'members.invite', 'members.manage',
    'org.view', 'org.manage',
    'partners.view', 'partners.manage',
    'plan.view',
  ],
  manager: [
    'campaign.view', 'campaign.approve',
    'icp.view', 'icp.approve',
    'leads.view', 'leads.search', 'leads.save',
    'templates.view',
    'billing.view',
    'members.view', 'members.invite',
    'org.view',
    'partners.view', 'partners.manage',
    'plan.view',
  ],
  employee: [
    'campaign.view',
    'icp.view',
    'leads.view', 'leads.search', 'leads.save',
    'templates.view',
    'billing.view',
    'members.view',
    'org.view',
    'partners.view',
    'plan.view',
  ],
};

// Added on top only while Karya has switched self-serve on for the business:
// the business builds and runs its own campaigns, as it could before.
const BUSINESS_SELF_SERVE = {
  admin: ['campaign.create', 'campaign.edit', 'campaign.submitForApproval', 'campaign.start', 'campaign.delete', 'templates.manage'],
  manager: ['campaign.create', 'campaign.edit', 'campaign.submitForApproval', 'campaign.start', 'campaign.delete', 'templates.manage'],
  // An employee builds, then asks: no starting or deleting on their own.
  employee: ['campaign.create', 'campaign.edit', 'campaign.submitForApproval', 'templates.manage'],
};

// ── Partner and platform ────────────────────────────────────────────────────
// Only their own team and organization for now. What a partner may do inside
// a business's project comes from that project's engagement, and what the
// Karya team may do comes with the console — both later steps.

const TEAM_ONLY = {
  admin: ['members.view', 'members.invite', 'members.manage', 'org.view', 'org.manage'],
  manager: ['members.view', 'members.invite', 'org.view'],
  employee: ['members.view', 'org.view'],
};

const TABLE = {
  business: BUSINESS,
  partner: TEAM_ONLY,
  platform: TEAM_ONLY,
};

// Which roles someone may hand out, in any kind of organization. A manager
// can only bring in employees — otherwise inviting a second admin would be a
// way around every limit above.
const INVITABLE_ROLES = {
  admin: ['admin', 'manager', 'employee'],
  manager: ['employee'],
  employee: [],
};

// ── What a worker may be given inside one project ───────────────────────────
// A worker's (agency / expert) capabilities inside a business's project come
// from that project's engagement — never from their own organization's role
// table. The business chooses from GRANTABLE; everything else (starting
// campaigns, approving, billing, the business's team) can never be granted:
// spending and sign-off always stay with the business.
const GRANTABLE = [
  'campaign.view', 'campaign.create', 'campaign.edit', 'campaign.submitForApproval',
  'icp.view',
  'leads.view', 'leads.save',
  'leads.search',            // reveals contacts — spends the business's credits
  'leads.export',            // takes the lead list out of Karya
  'templates.view', 'templates.manage',
  'plan.view', 'plan.edit',  // the project's milestones and tasks
];

// What a new invitation grants unless the business changes it: everything
// needed to build and submit the work, nothing that spends or exports.
const DEFAULT_GRANTS = GRANTABLE.filter((c) => !['leads.search', 'leads.export'].includes(c));

/** Keep only grantable capabilities, de-duplicated, in vocabulary order. */
function cleanGrants(grants) {
  const wanted = new Set(Array.isArray(grants) ? grants : []);
  return GRANTABLE.filter((c) => wanted.has(c));
}

/**
 * Every capability this membership holds in this organization.
 *
 * @param {object} membership    a Membership (role, status)
 * @param {object} organization  its Organization (type, settings)
 */
function capabilitySet(membership, organization) {
  if (!membership || !organization) return new Set();
  // A suspended or still-pending membership grants nothing, whatever the role says.
  if (membership.status && membership.status !== 'active') return new Set();

  const table = TABLE[organization.type];
  if (!table || !table[membership.role]) return new Set();

  const caps = new Set(table[membership.role]);
  if (organization.type === 'business' && organization.settings?.selfServe) {
    (BUSINESS_SELF_SERVE[membership.role] || []).forEach((c) => caps.add(c));
  }
  return caps;
}

/** Does this membership allow this capability? Unknown capabilities are denied. */
function can(membership, organization, capability) {
  if (!ALL.has(capability)) return false;              // typo — deny, don't guess
  return capabilitySet(membership, organization).has(capability);
}

/**
 * The flat list the frontend renders from. Sent with the org context so the
 * UI can hide what it must, while every route still checks independently — a
 * hidden button is UX, not security.
 */
function capabilitiesFor(membership, organization) {
  const caps = capabilitySet(membership, organization);
  return CAPABILITIES.filter((c) => caps.has(c));
}

/**
 * How much of the organization's work this membership can see.
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
  ORG_TYPES,
  INVITABLE_ROLES,
  GRANTABLE,
  DEFAULT_GRANTS,
  cleanGrants,
  can,
  capabilitiesFor,
  visibilityFor,
  canAssignRole,
};
