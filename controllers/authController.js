// controllers/authController.js
// Authentication controller with multi-profile support

const crypto = require('crypto');
const User = require('../models/User');
const BusinessProfile = require('../models/BusinessProfile');
const ExpertProfile = require('../models/ExpertProfile');
const { config } = require('../config/config');
const { sendTokenResponse, clearTokenCookie } = require('../utils/generateToken');
const { sendEmail, templates } = require('../utils/sendEmail');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

// ============================================
// REGISTER
// ============================================

/**
 * @desc    Register new user with initial profile
 * @route   POST /api/auth/register
 * @access  Public
 */
const register = asyncHandler(async (req, res, next) => {
  const { fullName, email, password, role, company, phone } = req.body;
  
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
  
  // Generate email verification token
  const verificationToken = user.generateEmailVerificationToken();
  await user.save({ validateBeforeSave: false });
  
  // Create verification URL
  const verificationUrl = `${config.frontendUrl}/verify-email/${verificationToken}`;
  
  // Send verification email
  try {
    await sendEmail({
      to: user.email,
      subject: 'Verify your Karya-AI account',
      html: templates.emailVerification(user.fullName, verificationUrl)
    });
  } catch (error) {
    console.error('Failed to send verification email:', error);
  }
  
  // Populate profiles before sending response
  await user.populate([
    { path: 'profiles.owner', select: 'company' },
    { path: 'profiles.expert', select: 'headline primaryCategory' }
  ]);
  
  // Send response with token
  sendTokenResponse(user, 201, res, 'Registration successful! Please check your email to verify your account.');
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
  sendTokenResponse(user, 200, res, 'Login successful');
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
  
  res.status(200).json({
    success: true,
    user,
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
  sendTokenResponse(user, 200, res, `Switched to ${role} profile`);
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
    user
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
  
  sendTokenResponse(user, 200, res, 'Password reset successful');
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
  
  sendTokenResponse(user, 200, res, 'Password changed successfully');
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
// UPDATE PROFILE (Core user data)
// ============================================

/**
 * @desc    Update core user profile (name, phone, avatar)
 * @route   PUT /api/auth/update-profile
 * @access  Private
 */
const updateProfile = asyncHandler(async (req, res, next) => {
  const allowedFields = ['fullName', 'phone', 'avatar', 'preferences'];
  
  const updates = {};
  Object.keys(req.body).forEach((key) => {
    if (allowedFields.includes(key)) {
      updates[key] = req.body[key];
    }
  });
  
  const user = await User.findByIdAndUpdate(
    req.user._id,
    updates,
    { new: true, runValidators: true }
  ).populate([
    { path: 'profiles.owner' },
    { path: 'profiles.expert' }
  ]);
  
  res.status(200).json({
    success: true,
    message: 'Profile updated successfully',
    user
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
  register,
  login,
  logout,
  getMe,
  switchRole,
  createProfile,
  forgotPassword,
  resetPassword,
  changePassword,
  verifyEmail,
  resendVerification,
  updateProfile,
  checkEmail,
  deactivateAccount,
  getProfiles
};