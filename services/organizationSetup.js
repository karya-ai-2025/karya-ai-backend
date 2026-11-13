// services/organizationSetup.js
//
// Every new account that isn't joining by invitation founds its own
// organization and becomes its first admin. Email signup and social signup
// both come through here, so the two can't drift apart.

const Organization = require('../models/Organization');
const Membership = require('../models/Membership');
const { audit } = require('../utils/audit');

/**
 * Create the organization and the founder's admin membership, and point the
 * user at it. The user must already be saved (the membership needs its id);
 * the caller saves it again afterwards for `organizationId`.
 *
 * On failure, removes whatever it created and rethrows — an account left
 * without its organization is locked out by `protect`.
 *
 * @param {object} user   saved User document; its `kind` decides the organization type
 * @param {string} name   organization name
 * @param {object} [req]  request, for the audit log's IP
 */
async function foundOrganization(user, name, req) {
  let organization;
  try {
    organization = await Organization.create({
      name: String(name).trim(),
      slug: await Organization.buildSlug(name),
      type: user.kind,
      ownerUserId: user._id,
      createdBy: user._id,
      billingEmail: user.email,
    });

    await Membership.create({
      organizationId: organization._id,
      userId: user._id,
      role: 'admin',
      status: 'active',
      acceptedAt: new Date(),
    });
  } catch (error) {
    if (organization) await Organization.deleteOne({ _id: organization._id }).catch(() => {});
    throw error;
  }

  user.organizationId = organization._id;

  await audit(req, 'org.created', {
    actor: { userId: user._id, orgId: organization._id },
    tenantOrgId: organization._id,
    target: { type: 'Organization', id: organization._id },
    summary: `${user.fullName} created ${organization.name}`,
    details: { type: organization.type },
  });

  return organization;
}

/**
 * The company name lives on the business profile (what onboarding and settings
 * edit) and on the organization (what invites, the team page and the audit
 * log show). Call this wherever the profile's company name changes so the two
 * stay the same. Callers have already checked org.manage.
 */
async function syncOrganizationName(req, name) {
  const trimmed = String(name || '').trim();
  if (!req.organizationId || trimmed.length < 2) return;
  await Organization.updateOne({ _id: req.organizationId }, { $set: { name: trimmed.slice(0, 120) } });
}

module.exports = { foundOrganization, syncOrganizationName };
