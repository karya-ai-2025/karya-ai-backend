// controllers/profileController.js
// Controller for managing Business and Expert profiles

const User = require('../models/User');
const BusinessProfile = require('../models/BusinessProfile');
const ExpertProfile = require('../models/ExpertProfile');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

// ============================================
// BUSINESS PROFILE CONTROLLERS
// ============================================

/**
 * @desc    Get current user's business profile
 * @route   GET /api/profiles/business
 * @access  Private
 */
const getBusinessProfile = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  
  if (!user.hasOwnerProfile) {
    return next(new AppError('You don\'t have a Business profile yet', 404));
  }
  
  const profile = await BusinessProfile.findById(user.profiles.owner);
  
  res.status(200).json({
    success: true,
    profile
  });
});

/**
 * @desc    Update business profile
 * @route   PUT /api/profiles/business
 * @access  Private
 */
const updateBusinessProfile = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  
  if (!user.hasOwnerProfile) {
    return next(new AppError('You don\'t have a Business profile yet', 404));
  }
  
  const allowedUpdates = [
    'company', 'industry', 'companySize', 'annualRevenue', 'businessType',
    'location', 'marketingGoals', 'marketingBudget', 'currentChallenges',
    'targetAudience', 'preferences'
  ];
  
  const updates = {};
  Object.keys(req.body).forEach(key => {
    if (allowedUpdates.includes(key)) {
      updates[key] = req.body[key];
    }
  });
  
  const profile = await BusinessProfile.findByIdAndUpdate(
    user.profiles.owner,
    updates,
    { returnDocument: 'after', runValidators: true }
  );
  
  if (profile.completionPercentage >= 80 && !user.onboarding.owner.completed) {
    user.onboarding.owner.completed = true;
    await user.save({ validateBeforeSave: false });
  }
  
  res.status(200).json({
    success: true,
    message: 'Business profile updated successfully',
    profile
  });
});

/**
 * @desc    Update onboarding progress for business profile
 * @route   PUT /api/profiles/business/onboarding
 * @access  Private
 */
const updateBusinessOnboarding = asyncHandler(async (req, res, next) => {
  const { step, data, completed } = req.body;
  const user = await User.findById(req.user._id);
  
  if (!user.hasOwnerProfile) {
    return next(new AppError('You don\'t have a Business profile yet', 404));
  }
  
  if (data && Object.keys(data).length > 0) {
    await BusinessProfile.findByIdAndUpdate(
      user.profiles.owner, data, { returnDocument: 'after', runValidators: true }
    );
  }
  
  if (typeof step === 'number') user.onboarding.owner.currentStep = step;
  if (completed) user.onboarding.owner.completed = true;
  
  await user.save({ validateBeforeSave: false });
  const profile = await BusinessProfile.findById(user.profiles.owner);
  
  res.status(200).json({
    success: true,
    message: 'Onboarding progress updated',
    onboarding: user.onboarding.owner,
    profile
  });
});

// ============================================
// EXPERT PROFILE CONTROLLERS
// ============================================

/**
 * @desc    Get current user's expert profile
 * @route   GET /api/profiles/expert
 * @access  Private
 */
const getExpertProfile = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  
  if (!user.hasExpertProfile) {
    return next(new AppError('You don\'t have an Expert profile yet', 404));
  }
  
  const profile = await ExpertProfile.findById(user.profiles.expert);
  
  res.status(200).json({
    success: true,
    profile
  });
});

/**
 * @desc    Update expert profile
 * @route   PUT /api/profiles/expert
 * @access  Private
 */
const updateExpertProfile = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  
  if (!user.hasExpertProfile) {
    return next(new AppError('You don\'t have an Expert profile yet', 404));
  }
  
  const allowedUpdates = [
    'headline', 'bio', 'yearsOfExperience', 'primaryCategory', 'secondaryCategories',
    'skills', 'tools', 'industries', 'pricing', 'availability', 'location',
    'education', 'certifications', 'experience', 'socialLinks', 'preferences'
  ];
  
  const updates = {};
  Object.keys(req.body).forEach(key => {
    if (allowedUpdates.includes(key)) {
      updates[key] = req.body[key];
    }
  });
  
  const profile = await ExpertProfile.findByIdAndUpdate(
    user.profiles.expert,
    updates,
    { returnDocument: 'after', runValidators: true }
  );
  
  if (profile.completionPercentage >= 80 && !user.onboarding.expert.completed) {
    user.onboarding.expert.completed = true;
    await user.save({ validateBeforeSave: false });
  }
  
  res.status(200).json({
    success: true,
    message: 'Expert profile updated successfully',
    profile
  });
});

/**
 * @desc    Update onboarding progress for expert profile
 * @route   PUT /api/profiles/expert/onboarding
 * @access  Private
 */
const updateExpertOnboarding = asyncHandler(async (req, res, next) => {
  const { step, data, completed } = req.body;
  const user = await User.findById(req.user._id);
  
  if (!user.hasExpertProfile) {
    return next(new AppError('You don\'t have an Expert profile yet', 404));
  }
  
  if (data && Object.keys(data).length > 0) {
    await ExpertProfile.findByIdAndUpdate(
      user.profiles.expert, data, { returnDocument: 'after', runValidators: true }
    );
  }
  
  if (typeof step === 'number') user.onboarding.expert.currentStep = step;
  if (completed) user.onboarding.expert.completed = true;
  
  await user.save({ validateBeforeSave: false });
  const profile = await ExpertProfile.findById(user.profiles.expert);
  
  res.status(200).json({
    success: true,
    message: 'Onboarding progress updated',
    onboarding: user.onboarding.expert,
    profile
  });
});

/**
 * @desc    Add portfolio item
 * @route   POST /api/profiles/expert/portfolio
 * @access  Private
 */
const addPortfolioItem = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  
  if (!user.hasExpertProfile) {
    return next(new AppError('You don\'t have an Expert profile yet', 404));
  }
  
  const profile = await ExpertProfile.findById(user.profiles.expert);
  const newItem = await profile.addPortfolioItem(req.body);
  
  res.status(201).json({
    success: true,
    message: 'Portfolio item added successfully',
    item: newItem
  });
});

/**
 * @desc    Delete portfolio item
 * @route   DELETE /api/profiles/expert/portfolio/:itemId
 * @access  Private
 */
const deletePortfolioItem = asyncHandler(async (req, res, next) => {
  const { itemId } = req.params;
  const user = await User.findById(req.user._id);
  
  if (!user.hasExpertProfile) {
    return next(new AppError('You don\'t have an Expert profile yet', 404));
  }
  
  const profile = await ExpertProfile.findById(user.profiles.expert);
  profile.portfolio = profile.portfolio.filter(item => item._id.toString() !== itemId);
  await profile.save();
  
  res.status(200).json({
    success: true,
    message: 'Portfolio item deleted successfully'
  });
});

/**
 * @desc    Update availability status
 * @route   PUT /api/profiles/expert/availability
 * @access  Private
 */
const updateAvailability = asyncHandler(async (req, res, next) => {
  const { status, hoursPerWeek, workType, remoteOnly } = req.body;
  const user = await User.findById(req.user._id);
  
  if (!user.hasExpertProfile) {
    return next(new AppError('You don\'t have an Expert profile yet', 404));
  }
  
  const profile = await ExpertProfile.findById(user.profiles.expert);
  
  if (status) profile.availability.status = status;
  if (hoursPerWeek !== undefined) profile.availability.hoursPerWeek = hoursPerWeek;
  if (workType) profile.availability.workType = workType;
  if (remoteOnly !== undefined) profile.availability.remoteOnly = remoteOnly;
  profile.profileStatus.lastActive = new Date();
  
  await profile.save();
  
  res.status(200).json({
    success: true,
    message: 'Availability updated successfully',
    availability: profile.availability
  });
});

/**
 * @desc    Toggle profile visibility
 * @route   PUT /api/profiles/expert/visibility
 * @access  Private
 */
const toggleProfileVisibility = asyncHandler(async (req, res, next) => {
  const { isPublic, isSearchable } = req.body;
  const user = await User.findById(req.user._id);
  
  if (!user.hasExpertProfile) {
    return next(new AppError('You don\'t have an Expert profile yet', 404));
  }
  
  const profile = await ExpertProfile.findById(user.profiles.expert);
  
  if (isPublic && !profile.canGoPublic()) {
    return next(new AppError(
      'Complete your profile (headline, bio, category, skills, pricing) before going public',
      400
    ));
  }
  
  if (isPublic !== undefined) profile.profileStatus.isPublic = isPublic;
  if (isSearchable !== undefined) profile.profileStatus.isSearchable = isSearchable;
  await profile.save();
  
  res.status(200).json({
    success: true,
    message: 'Profile visibility updated',
    profileStatus: profile.profileStatus
  });
});

/**
 * @desc    Get public expert profile by ID
 * @route   GET /api/profiles/experts/:id
 * @access  Public
 */
const getPublicExpertProfile = asyncHandler(async (req, res, next) => {
  const profile = await ExpertProfile.findById(req.params.id)
    .populate('user', 'fullName avatar');
  
  if (!profile) {
    return next(new AppError('Expert profile not found', 404));
  }
  
  if (!profile.profileStatus.isPublic) {
    return next(new AppError('This profile is private', 403));
  }
  
  profile.stats.profileViews += 1;
  await profile.save({ validateBeforeSave: false });
  
  res.status(200).json({
    success: true,
    profile
  });
});

/**
 * @desc    Search expert profiles
 * @route   GET /api/profiles/experts/search
 * @access  Public
 */
const searchExperts = asyncHandler(async (req, res, next) => {
  const {
    q, category, skills, minRate, maxRate, availability,
    location, minRating, page = 1, limit = 10, sortBy = 'ratings.overall'
  } = req.query;
  
  const query = {
    'profileStatus.isPublic': true,
    'profileStatus.isSearchable': true
  };
  
  if (q) query.$text = { $search: q };
  if (category) {
    query.$or = [
      { primaryCategory: category },
      { secondaryCategories: category }
    ];
  }
  if (skills) {
    const skillsArray = skills.split(',').map(s => s.trim());
    query['skills.name'] = { $in: skillsArray };
  }
  if (minRate || maxRate) {
    query['pricing.hourlyRate.min'] = {};
    if (minRate) query['pricing.hourlyRate.min'].$gte = Number(minRate);
    if (maxRate) query['pricing.hourlyRate.min'].$lte = Number(maxRate);
  }
  if (availability) query['availability.status'] = availability;
  if (location) query['location.city'] = new RegExp(location, 'i');
  if (minRating) query['ratings.overall'] = { $gte: Number(minRating) };
  
  const skip = (Number(page) - 1) * Number(limit);
  
  const profiles = await ExpertProfile.find(query)
    .populate('user', 'fullName avatar')
    .sort({ [sortBy]: -1 })
    .skip(skip)
    .limit(Number(limit))
    .select('-paymentInfo');
  
  const total = await ExpertProfile.countDocuments(query);
  
  res.status(200).json({
    success: true,
    count: profiles.length,
    total,
    pages: Math.ceil(total / Number(limit)),
    currentPage: Number(page),
    profiles
  });
});

module.exports = {
  getBusinessProfile,
  updateBusinessProfile,
  updateBusinessOnboarding,
  getExpertProfile,
  updateExpertProfile,
  updateExpertOnboarding,
  addPortfolioItem,
  deletePortfolioItem,
  updateAvailability,
  toggleProfileVisibility,
  getPublicExpertProfile,
  searchExperts
};