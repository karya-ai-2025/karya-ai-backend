// controllers/authController.js
// Authentication controller with multi-profile support

const crypto = require('crypto');
const User = require('../models/User');
const BusinessProfile = require('../models/BusinessProfile');
const ExpertProfile = require('../models/ExpertProfile');
const Organization = require('../models/Organization');
const Membership = require('../models/Membership');
const { config } = require('../config/config');
const { sendTokenResponse, clearTokenCookie } = require('../utils/generateToken');
const { sendEmail, templates } = require('../utils/sendEmail');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { orgSummaryForUser, orgSummaryFromReq, hasCapability } = require('../middleware/orgContext');

// ============================================
// REGISTER
// ============================================

/**
 * @desc    Register new user with initial profile
 * @route   POST /api/auth/register
 * @access  Public
 */
const register = asyncHandler(async (req, res, next) => {
  const { fullName, email, password, role, company, phone, inviteToken } = req.body;

  // Joining a company through an emailed invitation is its own path: the
  // account type, organization and role all come from the invite, never from
  // what the browser sent.
  if (inviteToken) {
    return registerFromInvite(req, res, next);
  }

  // Individual or enterprise — asked once, at signup. Experts are always
  // individual; only a business account can be an enterprise.
  const accountType =
    role !== 'expert' && req.body.accountType === 'enterprise' ? 'enterprise' : 'individual';

  if (accountType === 'enterprise' && String(company || '').trim().length < 2) {
    return next(new AppError('Company name is required for an enterprise account', 400));
  }

  // Check if user already exists
  const existingUser = await User.findOne({ email: email.toLowerCase() });

  if (existingUser) {
    return next(new AppError('An account with this email already exists', 400));
  }

  // Create user
  const user = await User.create({
    fullName,
    email: email.toLowerCase(),
    password,
    phone,
    activeRole: role || 'owner'
  });

  // Create initial profile based on role
  if (role === 'expert') {
    const expertProfile = await ExpertProfile.create({
      user: user._id,
      profileStatus: {
        joinedAsExpert: new Date()
      }
    });

    user.profiles.expert = expertProfile._id;
    user.hasExpertProfile = true;
  } else {
    // Default to owner
    const businessProfile = await BusinessProfile.create({
      user: user._id,
      company: {
        name: company || `${fullName}'s Company`
      }
    });

    user.profiles.owner = businessProfile._id;
    user.hasOwnerProfile = true;
  }

  // Enterprise: create the company and make this person its first admin.
  // An individual account stops here and never touches the organization code.
  if (accountType === 'enterprise') {
    let organization;
    try {
      organization = await Organization.create({
        name: String(company).trim(),
        slug: await Organization.buildSlug(company),
        ownerUserId: user._id,
        createdBy: user._id,
        billingEmail: user.email
      });

      await Membership.create({
        organizationId: organization._id,
        userId: user._id,
        role: 'admin',
        status: 'active',
        acceptedAt: new Date()
      });
    } catch (error) {
      // Half an enterprise is worse than none: an 'enterprise' user with no
      // membership is locked out by `protect`. Undo everything so the email
      // is free to try again.
      console.error('Enterprise signup failed, rolling back:', error);
      if (organization) await Organization.deleteOne({ _id: organization._id }).catch(() => {});
      await BusinessProfile.deleteOne({ user: user._id }).catch(() => {});
      await User.deleteOne({ _id: user._id }).catch(() => {});
      return next(new AppError('Could not create your organization. Please try again.', 500));
    }

    user.accountType = 'enterprise';
    user.organizationId = organization._id;
  }

  // Generate email verification token
  const verificationToken = user.generateEmailVerificationToken();
  await user.save({ validateBeforeSave: false });

  // Create verification URL
  const verificationUrl = `${config.frontendUrl}/verify-email/${verificationToken}`;

  // NOTE: OTP verification is switched off. Registration no longer generates or
  // emails a 6-digit code — the user goes straight into onboarding. The model
  // methods (generateEmailOtp / verifyEmailOtp) and the /auth/verify-otp and
  // /auth/resend-otp routes remain in place, unused, so this can be turned back
  // on by restoring the generate + send here.

  // Welcome email is a nicety; losing it must not block registration.
  try {
    await sendEmail({
      to: user.email,
      subject: 'Welcome to Karya-AI! Your account has been created 🎉',
      html: templates.welcome(user.fullName)
    });
  } catch (error) {
    console.error('Failed to send welcome email:', error);
  }

  // Populate profiles before sending response
  await user.populate([
    { path: 'profiles.owner', select: 'company' },
    { path: 'profiles.expert', select: 'headline primaryCategory' }
  ]);

  // Send response with token
  sendTokenResponse(user, 201, res, 'Registration successful! Welcome to Karya-AI.', {
    organization: await orgSummaryForUser(user)
  });
});

/**
 * Register by accepting a team invitation.
 *
 * Reached from `register` when the body carries an inviteToken. The new
 * account joins the inviting organization in the invited role and shares the
 * company's existing business profile, so it skips company onboarding.
 */
const registerFromInvite = async (req, res, next) => {
  const { fullName, email, password, phone, inviteToken } = req.body;

  const invite = await Membership.findByInviteToken(inviteToken);
  if (!invite) {
    return next(new AppError('This invitation is invalid or has expired. Ask your administrator for a new one.', 400));
  }

  // The link was sent to one address; it only opens an account for that one.
  if (String(email).toLowerCase() !== invite.inviteEmail) {
    return next(new AppError('This invitation was sent to a different email address', 400));
  }

  const existingUser = await User.findOne({ email: invite.inviteEmail });
  if (existingUser) {
    return next(new AppError('An account with this email already exists', 400));
  }

  const organization = await Organization.findById(invite.organizationId);
  if (!organization || organization.status !== 'active') {
    return next(new AppError('This organization is no longer active', 400));
  }

  // Members work from the company's one business profile, held by the owner.
  const owner = await User.findById(organization.ownerUserId).select('profiles');

  const user = await User.create({
    fullName,
    email: invite.inviteEmail,
    password,
    phone,
    activeRole: 'owner',
    accountType: 'enterprise',
    organizationId: organization._id,
    hasOwnerProfile: !!(owner && owner.profiles && owner.profiles.owner),
    profiles: { owner: (owner && owner.profiles && owner.profiles.owner) || null },
    // Receiving the invitation link is proof they control this inbox.
    isEmailVerified: true,
    // The company is already set up; there is nothing for a member to onboard.
    isOnboardingComplete: true,
    onboarding: { owner: { completed: true } }
  });

  try {
    invite.userId = user._id;
    invite.status = 'active';
    invite.acceptedAt = new Date();
    invite.inviteEmail = null;
    invite.inviteTokenHash = undefined;
    invite.inviteExpires = undefined;
    await invite.save();
  } catch (error) {
    console.error('Accepting invitation failed, rolling back:', error);
    await User.deleteOne({ _id: user._id }).catch(() => {});
    return next(new AppError('Could not accept the invitation. Please try again.', 500));
  }

  try {
    await sendEmail({
      to: user.email,
      subject: 'Welcome to Karya-AI! Your account has been created 🎉',
      html: templates.welcome(user.fullName)
    });
  } catch (error) {
    console.error('Failed to send welcome email:', error);
  }

  await user.populate([{ path: 'profiles.owner', select: 'company' }]);

  sendTokenResponse(user, 201, res, `Welcome to ${organization.name}!`, {
    organization: await orgSummaryForUser(user)
  });
};

// ============================================
// EMAIL OTP VERIFICATION
// ============================================

/**
 * @desc    Verify an email with the 6-digit code sent at registration
 * @route   POST /api/auth/verify-otp
 * @access  Public
 */
const verifyEmailOtp = asyncHandler(async (req, res, next) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return next(new AppError('Email and verification code are required', 400));
  }

  // The OTP fields are select:false, so ask for them explicitly.
  const user = await User.findOne({ email: String(email).toLowerCase().trim() })
    .select('+emailOtpHash +emailOtpExpires +emailOtpAttempts +emailOtpLastSentAt');

  // Deliberately the same message as a wrong code: telling someone "no such
  // account" turns this endpoint into a way to discover who has registered.
  if (!user) {
    return next(new AppError('Invalid or expired verification code', 400));
  }

  if (user.isEmailVerified) {
    return res.json({ success: true, message: 'Email is already verified', data: { alreadyVerified: true } });
  }

  const result = user.verifyEmailOtp(otp);
  if (!result.ok) {
    // Persist the incremented attempt count, or the limit means nothing.
    await user.save({ validateBeforeSave: false });
    return next(new AppError(result.reason, 400));
  }

  user.isEmailVerified = true;
  user.clearEmailOtp();
  // The emailed link is now redundant — retire it so neither route lingers.
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;
  await user.save({ validateBeforeSave: false });

  try {
    await sendEmail({
      to: user.email,
      subject: 'Welcome to Karya-AI! 🎉',
      html: templates.welcome(user.fullName)
    });
  } catch (error) {
    console.error('Failed to send welcome email:', error);
  }

  res.json({ success: true, message: 'Email verified successfully', data: { verified: true } });
});

/**
 * @desc    Send a fresh verification code
 * @route   POST /api/auth/resend-otp
 * @access  Public
 */
const resendEmailOtp = asyncHandler(async (req, res, next) => {
  const { email } = req.body;
  if (!email) return next(new AppError('Email is required', 400));

  const user = await User.findOne({ email: String(email).toLowerCase().trim() })
    .select('+emailOtpHash +emailOtpExpires +emailOtpAttempts +emailOtpLastSentAt');

  // Always answer the same way, whether or not the account exists — otherwise
  // this endpoint reveals which email addresses are registered.
  const genericOk = () => res.json({
    success: true,
    message: 'If that account exists and is unverified, a new code is on its way.'
  });

  if (!user || user.isEmailVerified) return genericOk();

  const wait = user.otpResendWaitSeconds();
  if (wait > 0) {
    return next(new AppError(`Please wait ${wait}s before requesting another code`, 429));
  }

  const otp = user.generateEmailOtp();
  await user.save({ validateBeforeSave: false });

  try {
    await sendEmail({
      to: user.email,
      subject: `${otp} is your Karya-AI verification code`,
      html: templates.otp(user.fullName, otp)
    });
  } catch (error) {
    console.error('Failed to resend OTP email:', error);
    return next(new AppError('Could not send the verification code. Please try again.', 500));
  }

  genericOk();
});

// ============================================
// LOGIN
// ============================================

/**
 * @desc    Login user
 * @route   POST /api/auth/login
 * @access  Public
 */
const login = asyncHandler(async (req, res, next) => {
  const { email, password, role } = req.body;

  // Find user and verify credentials
  const user = await User.findByCredentials(email.toLowerCase(), password);

  // Enterprise accounts only work while their membership does. Say so here,
  // rather than letting them in to find every page refusing them.
  const organization = await orgSummaryForUser(user);
  if (user.accountType === 'enterprise' && !organization) {
    return next(new AppError(
      'Your access to this organization has been removed. Please contact your administrator.',
      403
    ));
  }

  // If specific role requested, check if user has that profile
  if (role) {
    if (role === 'owner' && !user.hasOwnerProfile) {
      return next(new AppError('You don\'t have a Business profile. Would you like to create one?', 400));
    }
    if (role === 'expert' && !user.hasExpertProfile) {
      return next(new AppError('You don\'t have an Expert profile. Would you like to create one?', 400));
    }

    // Set active role to requested role
    user.activeRole = role;
    await user.save({ validateBeforeSave: false });
  }

  // Populate profiles
  await user.populate([
    { path: 'profiles.owner', select: 'company subscription' },
    { path: 'profiles.expert', select: 'headline primaryCategory availability ratings' }
  ]);

  // Send response with token
  sendTokenResponse(user, 200, res, 'Login successful', { organization });
});

// ============================================
// DEMO LOGIN
// ============================================

// Demo accounts are stored as ordinary users whose email is <loginId>@<this
// domain> — a reserved TLD, so nothing we send can ever be delivered.
const DEMO_EMAIL_DOMAIN = 'demo.acerstone.invalid';

/**
 * @desc    Sign in to a demo (walkthrough) account with a login ID + password
 * @route   POST /api/auth/demo-login
 * @access  Public
 */
const demoLogin = asyncHandler(async (req, res, next) => {
  const loginId = String(req.body.loginId || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const invalid = () => next(new AppError('Invalid demo ID or password', 401));

  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(loginId) || !password) return invalid();

  let user;
  try {
    user = await User.findByCredentials(`${loginId}@${DEMO_EMAIL_DOMAIN}`, password);
  } catch (err) {
    // Same wording whether the ID or the password was wrong; lockouts keep their own message
    return next(new AppError(/locked/i.test(err.message) ? err.message : 'Invalid demo ID or password', 401));
  }

  if (!user.isDemo) return invalid();
  if (user.demo?.expiresAt && user.demo.expiresAt < new Date()) {
    return next(new AppError('This demo access has expired. Please ask us for a new one.', 401));
  }

  await user.populate({ path: 'profiles.expert', select: 'headline primaryCategory availability ratings' });
  sendTokenResponse(user, 200, res, 'Demo login successful');
});

// ============================================
// LOGOUT
// ============================================

/**
 * @desc    Logout user / clear cookie
 * @route   POST /api/auth/logout
 * @access  Private
 */
const logout = asyncHandler(async (req, res, next) => {
  clearTokenCookie(res);

  res.status(200).json({
    success: true,
    message: 'Logged out successfully'
  });
});

// ============================================
// GET CURRENT USER
// ============================================

/**
 * @desc    Get current logged in user with active profile
 * @route   GET /api/auth/me
 * @access  Private
 */
const getMe = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id).populate([
    { path: 'profiles.owner' },
    { path: 'profiles.expert' }
  ]);

  // Get active profile data
  const activeProfile = user.activeRole === 'expert'
    ? user.profiles.expert
    : user.profiles.owner;

  // For an enterprise account: which company, which role, what it allows.
  // Null for an individual account.
  const organization = orgSummaryFromReq(req);

  res.status(200).json({
    success: true,
    user: { ...user.toJSON(), organization },
    activeProfile,
    activeRole: user.activeRole,
    availableRoles: user.availableRoles
  });
});

// ============================================
// SWITCH ROLE
// ============================================

/**
 * @desc    Switch between owner and expert roles
 * @route   POST /api/auth/switch-role
 * @access  Private
 */
const switchRole = asyncHandler(async (req, res, next) => {
  const { role } = req.body;

  if (!['owner', 'expert'].includes(role)) {
    return next(new AppError('Invalid role. Must be owner or expert', 400));
  }

  const user = await User.findById(req.user._id);

  // Check if user has the profile for requested role
  if (role === 'owner' && !user.hasOwnerProfile) {
    return next(new AppError('You need to create a Business profile first', 400));
  }

  if (role === 'expert' && !user.hasExpertProfile) {
    return next(new AppError('You need to create an Expert profile first', 400));
  }

  // Switch role
  user.activeRole = role;
  await user.save({ validateBeforeSave: false });

  // Populate and return
  await user.populate([
    { path: 'profiles.owner' },
    { path: 'profiles.expert' }
  ]);

  // Generate new token with updated role
  sendTokenResponse(user, 200, res, `Switched to ${role} profile`, {
    organization: orgSummaryFromReq(req)
  });
});

// ============================================
// CREATE ADDITIONAL PROFILE
// ============================================

/**
 * @desc    Create an additional profile (owner or expert)
 * @route   POST /api/auth/create-profile
 * @access  Private
 */
const createProfile = asyncHandler(async (req, res, next) => {
  const { profileType, profileData } = req.body;

  if (!['owner', 'expert'].includes(profileType)) {
    return next(new AppError('Invalid profile type. Must be owner or expert', 400));
  }

  const user = await User.findById(req.user._id);

  if (profileType === 'owner') {
    if (user.hasOwnerProfile) {
      return next(new AppError('You already have a Business profile', 400));
    }

    // Create business profile
    const businessProfile = await BusinessProfile.create({
      user: user._id,
      company: {
        name: profileData?.companyName || `${user.fullName}'s Company`
      },
      industry: profileData?.industry,
      companySize: profileData?.companySize
    });

    user.profiles.owner = businessProfile._id;
    user.hasOwnerProfile = true;

  } else if (profileType === 'expert') {
    if (user.hasExpertProfile) {
      return next(new AppError('You already have an Expert profile', 400));
    }

    // Create expert profile
    const expertProfile = await ExpertProfile.create({
      user: user._id,
      headline: profileData?.headline,
      primaryCategory: profileData?.primaryCategory,
      yearsOfExperience: profileData?.yearsOfExperience,
      profileStatus: {
        joinedAsExpert: new Date()
      }
    });

    user.profiles.expert = expertProfile._id;
    user.hasExpertProfile = true;
  }

  await user.save({ validateBeforeSave: false });

  // Populate and return
  await user.populate([
    { path: 'profiles.owner' },
    { path: 'profiles.expert' }
  ]);

  res.status(201).json({
    success: true,
    message: `${profileType === 'owner' ? 'Business' : 'Expert'} profile created successfully`,
    user: { ...user.toJSON(), organization: orgSummaryFromReq(req) }
  });
});

// ============================================
// FORGOT PASSWORD
// ============================================

/**
 * @desc    Forgot password - send reset email
 * @route   POST /api/auth/forgot-password
 * @access  Public
 */
const forgotPassword = asyncHandler(async (req, res, next) => {
  const { email } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() });

  // Always return success to prevent email enumeration
  if (!user) {
    return res.status(200).json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.'
    });
  }

  // Generate reset token
  const resetToken = user.generatePasswordResetToken();
  await user.save({ validateBeforeSave: false });

  // Create reset URL
  const resetUrl = `${config.frontendUrl}/reset-password/${resetToken}`;

  try {
    await sendEmail({
      to: user.email,
      subject: 'Password Reset Request - Karya-AI',
      html: templates.passwordReset(user.fullName, resetUrl)
    });

    res.status(200).json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.'
    });
  } catch (error) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });

    return next(new AppError('Failed to send reset email. Please try again later.', 500));
  }
});

// ============================================
// RESET PASSWORD
// ============================================

/**
 * @desc    Reset password using token
 * @route   PUT /api/auth/reset-password/:token
 * @access  Public
 */
const resetPassword = asyncHandler(async (req, res, next) => {
  const { password } = req.body;
  const { token } = req.params;

  // Hash the token from URL
  const hashedToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  // Find user with valid reset token
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() }
  });

  if (!user) {
    return next(new AppError('Invalid or expired reset token', 400));
  }

  // Update password
  user.password = password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  // Send confirmation email
  try {
    await sendEmail({
      to: user.email,
      subject: 'Password Changed Successfully - Karya-AI',
      html: templates.passwordChanged(user.fullName)
    });
  } catch (error) {
    console.error('Failed to send password change confirmation:', error);
  }

  sendTokenResponse(user, 200, res, 'Password reset successful', {
    organization: await orgSummaryForUser(user)
  });
});

// ============================================
// CHANGE PASSWORD
// ============================================

/**
 * @desc    Change password for logged in user
 * @route   PUT /api/auth/change-password
 * @access  Private
 */
const changePassword = asyncHandler(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select('+password');

  const isMatch = await user.comparePassword(currentPassword);

  if (!isMatch) {
    return next(new AppError('Current password is incorrect', 401));
  }

  user.password = newPassword;
  await user.save();

  try {
    await sendEmail({
      to: user.email,
      subject: 'Password Changed Successfully - Karya-AI',
      html: templates.passwordChanged(user.fullName)
    });
  } catch (error) {
    console.error('Failed to send password change confirmation:', error);
  }

  sendTokenResponse(user, 200, res, 'Password changed successfully', {
    organization: orgSummaryFromReq(req)
  });
});

// ============================================
// VERIFY EMAIL
// ============================================

/**
 * @desc    Verify email using token
 * @route   GET /api/auth/verify-email/:token
 * @access  Public
 */
const verifyEmail = asyncHandler(async (req, res, next) => {
  const { token } = req.params;

  const hashedToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  const user = await User.findOne({
    emailVerificationToken: hashedToken,
    emailVerificationExpires: { $gt: Date.now() }
  });

  if (!user) {
    return next(new AppError('Invalid or expired verification token', 400));
  }

  user.isEmailVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;
  await user.save({ validateBeforeSave: false });

  try {
    await sendEmail({
      to: user.email,
      subject: 'Welcome to Karya-AI! 🎉',
      html: templates.welcome(user.fullName)
    });
  } catch (error) {
    console.error('Failed to send welcome email:', error);
  }

  res.status(200).json({
    success: true,
    message: 'Email verified successfully'
  });
});

// ============================================
// RESEND VERIFICATION
// ============================================

/**
 * @desc    Resend email verification
 * @route   POST /api/auth/resend-verification
 * @access  Public
 */
const resendVerification = asyncHandler(async (req, res, next) => {
  const { email } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    return res.status(200).json({
      success: true,
      message: 'If an account with that email exists, a verification email has been sent.'
    });
  }

  if (user.isEmailVerified) {
    return res.status(200).json({
      success: true,
      message: 'Email is already verified'
    });
  }

  const verificationToken = user.generateEmailVerificationToken();
  await user.save({ validateBeforeSave: false });

  const verificationUrl = `${config.frontendUrl}/verify-email/${verificationToken}`;

  try {
    await sendEmail({
      to: user.email,
      subject: 'Verify your Karya-AI account',
      html: templates.emailVerification(user.fullName, verificationUrl)
    });

    res.status(200).json({
      success: true,
      message: 'If an account with that email exists, a verification email has been sent.'
    });
  } catch (error) {
    return next(new AppError('Failed to send verification email. Please try again later.', 500));
  }
});

// ============================================
// UPDATE PROFILE (Enhanced for both User and BusinessProfile)
// ============================================

/**
 * @desc    Update user profile (both User and BusinessProfile fields)
 * @route   PUT /api/auth/update-profile
 * @access  Private
 */
const updateProfile = asyncHandler(async (req, res, next) => {
  // User model allowed fields
  const userAllowedFields = ['fullName', 'phone', 'avatar', 'preferences'];

  // BusinessProfile allowed fields
  const businessAllowedFields = [
    'company.name', 'company.website', 'company.description', 'company.logo',
    'industry', 'companySize', 'businessType',
    'location.address', 'location.city', 'location.state', 'location.country', 'location.pincode'
  ];

  // Separate updates for User and BusinessProfile
  const userUpdates = {};
  const businessUpdates = {};

  Object.keys(req.body).forEach((key) => {
    if (userAllowedFields.includes(key)) {
      userUpdates[key] = req.body[key];
    } else if (businessAllowedFields.includes(key)) {
      businessUpdates[key] = req.body[key];
    } else if (key === 'companyName') {
      // Handle companyName as company.name
      businessUpdates['company.name'] = req.body[key];
    } else if (key === 'companyWebsite') {
      // Handle companyWebsite as company.website
      businessUpdates['company.website'] = req.body[key];
    } else if (key === 'companyDescription') {
      // Handle companyDescription as company.description
      businessUpdates['company.description'] = req.body[key];
    }
  });

  // In an enterprise the company profile is shared by the whole team, so
  // only those who manage the organization may change it.
  if (Object.keys(businessUpdates).length > 0 && !hasCapability(req, 'org.manage')) {
    return next(new AppError('Only an organization admin can change company details', 403));
  }

  // Update User model if there are user updates
  let user;
  if (Object.keys(userUpdates).length > 0) {
    user = await User.findByIdAndUpdate(
      req.user._id,
      userUpdates,
      { returnDocument: 'after', runValidators: true }
    );
  } else {
    user = await User.findById(req.user._id);
  }

  // Update BusinessProfile if user has owner profile and there are business updates
  if (Object.keys(businessUpdates).length > 0 && user.hasOwnerProfile && user.profiles.owner) {
    await BusinessProfile.findByIdAndUpdate(
      user.profiles.owner,
      businessUpdates,
      { returnDocument: 'after', runValidators: true }
    );
  }

  // Populate and return updated user with profiles
  await user.populate([
    { path: 'profiles.owner' },
    { path: 'profiles.expert' }
  ]);

  res.status(200).json({
    success: true,
    message: 'Profile updated successfully',
    user: { ...user.toJSON(), organization: orgSummaryFromReq(req) }
  });
});

// ============================================
// CHECK EMAIL EXISTS
// ============================================

/**
 * @desc    Check if email already exists
 * @route   POST /api/auth/check-email
 * @access  Public
 */
const checkEmail = asyncHandler(async (req, res, next) => {
  const { email } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() });

  res.status(200).json({
    success: true,
    exists: !!user
  });
});

// ============================================
// DEACTIVATE ACCOUNT
// ============================================

/**
 * @desc    Deactivate user account
 * @route   DELETE /api/auth/deactivate
 * @access  Private
 */
const deactivateAccount = asyncHandler(async (req, res, next) => {
  const { password } = req.body;

  const user = await User.findById(req.user._id).select('+password');
  const isMatch = await user.comparePassword(password);

  if (!isMatch) {
    return next(new AppError('Password is incorrect', 401));
  }

  user.isActive = false;
  await user.save({ validateBeforeSave: false });

  clearTokenCookie(res);

  res.status(200).json({
    success: true,
    message: 'Account deactivated successfully'
  });
});

// ============================================
// GET USER PROFILES
// ============================================

/**
 * @desc    Get all profiles for current user
 * @route   GET /api/auth/profiles
 * @access  Private
 */
const getProfiles = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id).populate([
    { path: 'profiles.owner' },
    { path: 'profiles.expert' }
  ]);

  res.status(200).json({
    success: true,
    hasOwnerProfile: user.hasOwnerProfile,
    hasExpertProfile: user.hasExpertProfile,
    activeRole: user.activeRole,
    profiles: {
      owner: user.profiles.owner,
      expert: user.profiles.expert
    }
  });
});

module.exports = {
  DEMO_EMAIL_DOMAIN,
  register,
  login,
  demoLogin,
  logout,
  getMe,
  switchRole,
  createProfile,
  forgotPassword,
  resetPassword,
  changePassword,
  verifyEmail,
  verifyEmailOtp,
  resendEmailOtp,
  resendVerification,
  updateProfile,
  checkEmail,
  deactivateAccount,
  getProfiles
};
