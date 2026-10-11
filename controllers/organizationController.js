// controllers/organizationController.js
//
// An enterprise organization and the people in it: who belongs, in what
// role, and bringing new people in.
//
// Every route here sits behind requireOrg, so individual accounts never
// reach this file. The organization always comes from the caller's own
// membership (req.organizationId) — never from a path or body parameter.

const mongoose = require('mongoose');
const Organization = require('../models/Organization');
const Membership = require('../models/Membership');
const User = require('../models/User');
const { config } = require('../config/config');
const { sendEmail, templates } = require('../utils/sendEmail');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { orgSummaryFromReq } = require('../middleware/orgContext');
const { ROLES, INVITABLE_ROLES, canAssignRole } = require('../config/permissions');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inviteUrlFor = (token) => `${config.frontendUrl}/accept-invite/${token}`;

/** Shape one membership row for the client. */
function describeMember(m, organization) {
  const user = m.userId && typeof m.userId === 'object' ? m.userId : null;
  return {
    _id: m._id,
    user: user ? { _id: user._id, fullName: user.fullName, email: user.email } : null,
    email: user ? user.email : m.inviteEmail,
    role: m.role,
    status: m.status,
    isOwner: !!user && String(user._id) === String(organization.ownerUserId),
    invitedBy: m.invitedBy && m.invitedBy.fullName ? m.invitedBy.fullName : null,
    invitedAt: m.invitedAt || null,
    inviteExpires: m.status === 'invited' ? m.inviteExpires || null : null,
    joinedAt: m.acceptedAt || null,
  };
}

/**
 * Load a membership row of the caller's own organization, or null. The org
 * filter is what stops an id from another company resolving at all.
 */
function findOrgMembership(req, membershipId) {
  if (!mongoose.Types.ObjectId.isValid(String(membershipId))) return Promise.resolve(null);
  return Membership.findOne({ _id: membershipId, organizationId: req.organizationId });
}

async function sendInviteEmail(req, membership, token) {
  await sendEmail({
    to: membership.inviteEmail,
    subject: `${req.user.fullName} invited you to join ${req.organization.name} on Karya-AI`,
    html: templates.teamInvite(
      req.user.fullName,
      req.organization.name,
      membership.role,
      inviteUrlFor(token)
    ),
  });
}

// ============================================
// THE ORGANIZATION
// ============================================

/**
 * GET /api/organizations/me
 * The caller's organization, role and capabilities.
 */
const getMyOrganization = asyncHandler(async (req, res) => {
  const memberCount = await Membership.countDocuments({
    organizationId: req.organizationId,
    status: 'active',
  });

  res.json({
    success: true,
    data: {
      ...orgSummaryFromReq(req),
      memberCount,
      // Which roles this caller may hand out — drives the invite form.
      invitableRoles: INVITABLE_ROLES[req.membership.role] || [],
    },
  });
});

/**
 * PATCH /api/organizations/me        (org.manage)
 * @body { name }
 */
const updateMyOrganization = asyncHandler(async (req, res, next) => {
  const name = String((req.body && req.body.name) || '').trim();
  if (name.length < 2 || name.length > 120) {
    return next(new AppError('Organization name must be between 2 and 120 characters', 400));
  }

  const organization = await Organization.findByIdAndUpdate(
    req.organizationId,
    { name },
    { returnDocument: 'after', runValidators: true }
  );

  res.json({
    success: true,
    data: { _id: organization._id, name: organization.name, slug: organization.slug },
    message: 'Organization updated',
  });
});

// ============================================
// MEMBERS
// ============================================

/**
 * GET /api/organizations/members     (members.view)
 * Everyone in the organization, pending invitations included.
 */
const listMembers = asyncHandler(async (req, res) => {
  const members = await Membership.find({ organizationId: req.organizationId })
    .populate('userId', 'fullName email')
    .populate('invitedBy', 'fullName')
    .sort({ createdAt: 1 })
    .lean();

  res.json({
    success: true,
    count: members.length,
    data: members.map((m) => describeMember(m, req.organization)),
  });
});

/**
 * POST /api/organizations/invites    (members.invite)
 * @body { email, role }
 *
 * Creates a pending membership and emails a link. The account is created
 * when the link is opened — see registerFromInvite in authController.
 */
const inviteMember = asyncHandler(async (req, res, next) => {
  const email = String((req.body && req.body.email) || '').toLowerCase().trim();
  const role = String((req.body && req.body.role) || 'employee');

  if (!EMAIL_RE.test(email)) {
    return next(new AppError('Please provide a valid email address', 400));
  }
  if (!ROLES.includes(role)) {
    return next(new AppError('Role must be admin, manager or employee', 400));
  }
  if (!canAssignRole(req.membership.role, role)) {
    return next(new AppError(`Your role (${req.membership.role}) cannot invite someone as ${role}`, 403));
  }

  // One account belongs to one organization, so an address that already has
  // a Karya-AI account — in this company or as an individual — cannot be
  // invited. The message is the same for both so it does not reveal which.
  if (await User.exists({ email })) {
    return next(new AppError('This email already has a Karya-AI account and cannot be invited', 400));
  }
  if (await Membership.exists({ organizationId: req.organizationId, inviteEmail: email })) {
    return next(new AppError('This email has already been invited. Resend the invitation instead.', 400));
  }

  const membership = new Membership({
    organizationId: req.organizationId,
    inviteEmail: email,
    role,
    status: 'invited',
    invitedBy: req.user._id,
    invitedAt: new Date(),
  });
  const token = membership.generateInviteToken();
  await membership.save();

  // The invitation exists whether or not the email goes out; report a failed
  // send so the inviter knows to resend, rather than pretending it arrived.
  let emailSent = true;
  try {
    await sendInviteEmail(req, membership, token);
  } catch (error) {
    emailSent = false;
    console.error('Failed to send invitation email:', error);
  }

  res.status(201).json({
    success: true,
    data: describeMember(membership.toObject(), req.organization),
    emailSent,
    message: emailSent
      ? `Invitation sent to ${email}`
      : `Invitation created, but the email to ${email} could not be sent. Try resending it.`,
  });
});

/**
 * POST /api/organizations/invites/:id/resend   (members.invite)
 * Issues a fresh link; the previous one stops working.
 */
const resendInvite = asyncHandler(async (req, res, next) => {
  const membership = await findOrgMembership(req, req.params.id);
  if (!membership || membership.status !== 'invited') {
    return next(new AppError('Invitation not found', 404));
  }
  if (!canAssignRole(req.membership.role, membership.role)) {
    return next(new AppError('Your role cannot manage this invitation', 403));
  }

  const token = membership.generateInviteToken();
  membership.invitedAt = new Date();
  await membership.save();

  try {
    await sendInviteEmail(req, membership, token);
  } catch (error) {
    console.error('Failed to resend invitation email:', error);
    return next(new AppError('Could not send the invitation email. Please try again.', 500));
  }

  res.json({ success: true, message: `Invitation resent to ${membership.inviteEmail}` });
});

/**
 * DELETE /api/organizations/invites/:id        (members.invite)
 * Withdraw an invitation nobody has accepted yet.
 */
const revokeInvite = asyncHandler(async (req, res, next) => {
  const membership = await findOrgMembership(req, req.params.id);
  if (!membership || membership.status !== 'invited') {
    return next(new AppError('Invitation not found', 404));
  }
  if (!canAssignRole(req.membership.role, membership.role)) {
    return next(new AppError('Your role cannot manage this invitation', 403));
  }

  // Nothing was ever created under a pending invite, so the row can simply go.
  await membership.deleteOne();

  res.json({ success: true, message: 'Invitation withdrawn' });
});

/**
 * Load a member the caller is about to change, refusing the two cases that
 * are never allowed: the organization's owner, and the caller themselves.
 * Returns null after calling next() with the reason.
 */
async function loadManageableMember(req, next) {
  const membership = await findOrgMembership(req, req.params.id);
  if (!membership || membership.status === 'invited') {
    next(new AppError('Member not found', 404));
    return null;
  }
  if (String(membership.userId) === String(req.organization.ownerUserId)) {
    next(new AppError('The organization owner cannot be changed', 403));
    return null;
  }
  if (String(membership.userId) === String(req.user._id)) {
    next(new AppError('You cannot change your own membership', 403));
    return null;
  }
  return membership;
}

/**
 * PATCH /api/organizations/members/:id         (members.manage)
 * @body { role }
 */
const updateMemberRole = asyncHandler(async (req, res, next) => {
  const role = String((req.body && req.body.role) || '');
  if (!ROLES.includes(role)) {
    return next(new AppError('Role must be admin, manager or employee', 400));
  }

  const membership = await loadManageableMember(req, next);
  if (!membership) return;

  membership.role = role;
  await membership.save();
  await membership.populate('userId', 'fullName email');

  res.json({
    success: true,
    data: describeMember(membership.toObject(), req.organization),
    message: `Role changed to ${role}`,
  });
});

/**
 * POST /api/organizations/members/:id/suspend      (members.manage)
 * POST /api/organizations/members/:id/reactivate   (members.manage)
 *
 * Suspending withdraws access at once — `protect` re-checks the membership
 * on every request — while the row and everything the person built stay.
 */
const setMemberStatus = (status) => asyncHandler(async (req, res, next) => {
  const membership = await loadManageableMember(req, next);
  if (!membership) return;

  membership.status = status;
  if (status === 'suspended') {
    membership.suspendedAt = new Date();
    membership.suspendedBy = req.user._id;
  } else {
    membership.suspendedAt = undefined;
    membership.suspendedBy = undefined;
  }
  await membership.save();
  await membership.populate('userId', 'fullName email');

  res.json({
    success: true,
    data: describeMember(membership.toObject(), req.organization),
    message: status === 'suspended' ? 'Member suspended' : 'Member reactivated',
  });
});

const suspendMember = setMemberStatus('suspended');
const reactivateMember = setMemberStatus('active');

// ============================================
// PUBLIC — INVITATION LOOKUP
// ============================================

/**
 * GET /api/organizations/invites/lookup/:token     (public)
 *
 * What the accept-invite page shows before the person sets a password:
 * which company, which role, and the address the account will be created for.
 */
const lookupInvite = asyncHandler(async (req, res, next) => {
  const invite = await Membership.findByInviteToken(req.params.token);
  if (!invite) {
    return next(new AppError('This invitation is invalid or has expired', 404));
  }

  const [organization, inviter] = await Promise.all([
    Organization.findById(invite.organizationId).select('name status').lean(),
    invite.invitedBy ? User.findById(invite.invitedBy).select('fullName').lean() : null,
  ]);
  if (!organization || organization.status !== 'active') {
    return next(new AppError('This invitation is invalid or has expired', 404));
  }

  res.json({
    success: true,
    data: {
      email: invite.inviteEmail,
      role: invite.role,
      organizationName: organization.name,
      invitedBy: inviter ? inviter.fullName : null,
      expiresAt: invite.inviteExpires,
    },
  });
});

module.exports = {
  getMyOrganization,
  updateMyOrganization,
  listMembers,
  inviteMember,
  resendInvite,
  revokeInvite,
  updateMemberRole,
  suspendMember,
  reactivateMember,
  lookupInvite,
};
