// controllers/onboardingController.js
// Controller for managing business owner onboarding flow

const User = require('../models/User');
const BusinessProfile = require('../models/BusinessProfile');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

// ============================================
// STEP 1: PROFILE SETUP (Avatar Upload)
// ============================================

/**
 * @desc    Update user avatar (profile photo)
 * @route   PUT /api/onboarding/business/profile-setup
 * @access  Private
 */
const updateProfilePhoto = asyncHandler(async (req, res, next) => {
  const { avatar } = req.body; // Base64 image or URL
  
  if (!avatar) {
    return next(new AppError('Avatar image is required', 400));
  }
  
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { avatar },
    { returnDocument: 'after', runValidators: true }
  );
  
  // Update onboarding step
  user.onboarding.owner.currentStep = Math.max(user.onboarding.owner.currentStep, 1);
  await user.save({ validateBeforeSave: false });
  
  res.status(200).json({
    success: true,
    message: 'Profile photo updated successfully',
    user: {
      avatar: user.avatar
    },
    onboarding: user.onboarding.owner
  });
});

// ============================================
// STEP 2: PLATFORM USAGE
// ============================================

/**
 * @desc    Save platform usage selection
 * @route   PUT /api/onboarding/business/platform-usage
 * @access  Private
 */
const updatePlatformUsage = asyncHandler(async (req, res, next) => {
  const { platformUsageType } = req.body;
  
  const validTypes = ['single-team', 'agency', 'portfolio', 'personal'];
  if (!validTypes.includes(platformUsageType)) {
    return next(new AppError('Invalid platform usage type', 400));
  }
  
  const user = await User.findById(req.user._id);
  
  if (!user.hasOwnerProfile) {
    return next(new AppError('Business profile not found', 404));
  }
  
  const profile = await BusinessProfile.findByIdAndUpdate(
    user.profiles.owner,
    { platformUsageType },
    { returnDocument: 'after', runValidators: true }
  );
  
  // Update onboarding step
  user.onboarding.owner.currentStep = Math.max(user.onboarding.owner.currentStep, 2);
  await user.save({ validateBeforeSave: false });
  
  res.status(200).json({
    success: true,
    message: 'Platform usage saved successfully',
    data: {
      platformUsageType: profile.platformUsageType
    },
    onboarding: user.onboarding.owner
  });
});

// ============================================
// STEP 3: COMPANY DETAILS
// ============================================

/**
 * @desc    Save company details
 * @route   PUT /api/onboarding/business/company-details
 * @access  Private
 */
const updateCompanyDetails = asyncHandler(async (req, res, next) => {
  const { companyName, companySize, industry, website } = req.body;
  
  if (!companyName || !companySize || !industry) {
    return next(new AppError('Company name, size, and industry are required', 400));
  }
  
  const user = await User.findById(req.user._id);
  
  if (!user.hasOwnerProfile) {
    return next(new AppError('Business profile not found', 404));
  }
  
  const updateData = {
    'company.name': companyName,
    companySize,
    industry
  };
  
  if (website) {
    updateData['company.website'] = website;
  }
  
  const profile = await BusinessProfile.findByIdAndUpdate(
    user.profiles.owner,
    updateData,
    { returnDocument: 'after', runValidators: true }
  );
  
  // Update onboarding step
  user.onboarding.owner.currentStep = Math.max(user.onboarding.owner.currentStep, 3);
  await user.save({ validateBeforeSave: false });
  
  res.status(200).json({
    success: true,
    message: 'Company details saved successfully',
    data: {
      company: profile.company,
      companySize: profile.companySize,
      industry: profile.industry
    },
    onboarding: user.onboarding.owner
  });
});

// ============================================
// STEP 4: BRAND SETUP (Logo Upload)
// ============================================

/**
 * @desc    Save brand logo
 * @route   PUT /api/onboarding/business/brand-setup
 * @access  Private
 */
const updateBrandLogo = asyncHandler(async (req, res, next) => {
  const { logo } = req.body; // Base64 image or URL
  
  if (!logo) {
    return next(new AppError('Logo image is required', 400));
  }
  
  const user = await User.findById(req.user._id);
  
  if (!user.hasOwnerProfile) {
    return next(new AppError('Business profile not found', 404));
  }
  
  const profile = await BusinessProfile.findByIdAndUpdate(
    user.profiles.owner,
    { 'company.logo': logo },
    { returnDocument: 'after', runValidators: true }
  );
  
  // Update onboarding step
  user.onboarding.owner.currentStep = Math.max(user.onboarding.owner.currentStep, 4);
  await user.save({ validateBeforeSave: false });
  
  res.status(200).json({
    success: true,
    message: 'Brand logo saved successfully',
    data: {
      logo: profile.company.logo
    },
    onboarding: user.onboarding.owner
  });
});

// ============================================
// STEP 5: ICP DEFINITION
// ============================================

/**
 * @desc    Save Ideal Customer Profiles
 * @route   PUT /api/onboarding/business/icp-definition
 * @access  Private
 */
const updateICPs = asyncHandler(async (req, res, next) => {
  const { icps } = req.body;
  
  if (!icps || !Array.isArray(icps)) {
    return next(new AppError('ICPs must be an array', 400));
  }
  
  // Validate at least one ICP has name and description
  const validICPs = icps.filter(icp => icp.name && icp.description);
  if (validICPs.length === 0) {
    return next(new AppError('At least one ICP with name and description is required', 400));
  }
  
  const user = await User.findById(req.user._id);
  
  if (!user.hasOwnerProfile) {
    return next(new AppError('Business profile not found', 404));
  }
  
  // Format ICPs
  const formattedICPs = validICPs.map(icp => ({
    name: icp.name,
    description: icp.description,
    confirmed: icp.confirmed || false,
    createdAt: new Date()
  }));
  
  const profile = await BusinessProfile.findByIdAndUpdate(
    user.profiles.owner,
    { idealCustomerProfiles: formattedICPs },
    { returnDocument: 'after', runValidators: true }
  );
  
  // Update onboarding step
  user.onboarding.owner.currentStep = Math.max(user.onboarding.owner.currentStep, 5);
  await user.save({ validateBeforeSave: false });
  
  res.status(200).json({
    success: true,
    message: 'ICPs saved successfully',
    data: {
      idealCustomerProfiles: profile.idealCustomerProfiles
    },
    onboarding: user.onboarding.owner
  });
});

/**
 * @desc    Add a single ICP
 * @route   POST /api/onboarding/business/icp
 * @access  Private
 */
const addICP = asyncHandler(async (req, res, next) => {
  const { name, description, confirmed } = req.body;
  
  if (!name) {
    return next(new AppError('ICP name is required', 400));
  }
  
  const user = await User.findById(req.user._id);
  
  if (!user.hasOwnerProfile) {
    return next(new AppError('Business profile not found', 404));
  }
  
  const profile = await BusinessProfile.findById(user.profiles.owner);
  
  profile.idealCustomerProfiles.push({
    name,
    description: description || '',
    confirmed: confirmed || false,
    createdAt: new Date()
  });
  
  await profile.save();
  
  res.status(201).json({
    success: true,
    message: 'ICP added successfully',
    data: {
      icp: profile.idealCustomerProfiles[profile.idealCustomerProfiles.length - 1]
    }
  });
});

// ============================================
// STEP 6: MARKETING ACTIVITIES
// ============================================

/**
 * @desc    Save marketing activities
 * @route   PUT /api/onboarding/business/marketing-activities
 * @access  Private
 */
const updateMarketingActivities = asyncHandler(async (req, res, next) => {
  const { currentActivities, desiredPlan, goalsObjectives, monthlyBudget } = req.body;
  
  const user = await User.findById(req.user._id);
  
  if (!user.hasOwnerProfile) {
    return next(new AppError('Business profile not found', 404));
  }
  
  const updateData = {
    marketingActivities: {
      currentActivities: currentActivities || '',
      desiredPlan: desiredPlan || '',
      goalsObjectives: goalsObjectives || ''
    }
  };
  
  if (monthlyBudget) {
    updateData['marketingBudget.monthly'] = monthlyBudget;
  }
  
  const profile = await BusinessProfile.findByIdAndUpdate(
    user.profiles.owner,
    updateData,
    { returnDocument: 'after', runValidators: true }
  );
  
  // Update onboarding step
  user.onboarding.owner.currentStep = Math.max(user.onboarding.owner.currentStep, 6);
  await user.save({ validateBeforeSave: false });
  
  res.status(200).json({
    success: true,
    message: 'Marketing activities saved successfully',
    data: {
      marketingActivities: profile.marketingActivities,
      marketingBudget: profile.marketingBudget
    },
    onboarding: user.onboarding.owner
  });
});

// ============================================
// STEP 7: QUICK WINS
// ============================================

/**
 * @desc    Save quick wins and complete onboarding
 * @route   PUT /api/onboarding/business/quick-wins
 * @access  Private
 */
const updateQuickWins = asyncHandler(async (req, res, next) => {
  const { quickWins } = req.body;
  
  const user = await User.findById(req.user._id);
  
  if (!user.hasOwnerProfile) {
    return next(new AppError('Business profile not found', 404));
  }
  
  const profile = await BusinessProfile.findByIdAndUpdate(
    user.profiles.owner,
    { quickWins: quickWins || [] },
    { returnDocument: 'after', runValidators: true }
  );
  
  // Mark onboarding as complete
  user.onboarding.owner.currentStep = 7;
  user.onboarding.owner.completed = true;
  await user.save({ validateBeforeSave: false });
  
  res.status(200).json({
    success: true,
    message: 'Onboarding completed successfully!',
    data: {
      quickWins: profile.quickWins
    },
    onboarding: user.onboarding.owner
  });
});

// ============================================
// GET ONBOARDING STATUS
// ============================================

/**
 * @desc    Get current onboarding status and data
 * @route   GET /api/onboarding/business/status
 * @access  Private
 */
const getOnboardingStatus = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  
  if (!user.hasOwnerProfile) {
    return next(new AppError('Business profile not found', 404));
  }
  
  const profile = await BusinessProfile.findById(user.profiles.owner);
  
  res.status(200).json({
    success: true,
    onboarding: user.onboarding.owner,
    data: {
      avatar: user.avatar,
      platformUsageType: profile.platformUsageType,
      company: profile.company,
      companySize: profile.companySize,
      industry: profile.industry,
      idealCustomerProfiles: profile.idealCustomerProfiles,
      marketingActivities: profile.marketingActivities,
      marketingBudget: profile.marketingBudget,
      quickWins: profile.quickWins
    }
  });
});

// ============================================
// SKIP STEP
// ============================================

/**
 * @desc    Skip current onboarding step
 * @route   POST /api/onboarding/business/skip/:step
 * @access  Private
 */
const skipStep = asyncHandler(async (req, res, next) => {
  const { step } = req.params;
  const stepNum = parseInt(step);
  
  if (isNaN(stepNum) || stepNum < 1 || stepNum > 7) {
    return next(new AppError('Invalid step number', 400));
  }
  
  const user = await User.findById(req.user._id);
  
  // Update to the next step
  user.onboarding.owner.currentStep = Math.max(user.onboarding.owner.currentStep, stepNum);
  await user.save({ validateBeforeSave: false });
  
  res.status(200).json({
    success: true,
    message: `Step ${stepNum} skipped`,
    onboarding: user.onboarding.owner
  });
});

// ============================================
// SAVE ALL ONBOARDING DATA AT ONCE
// ============================================

/**
 * @desc    Save all onboarding data at once (batch save)
 * @route   PUT /api/onboarding/business/save-all
 * @access  Private
 */
const saveAllOnboardingData = asyncHandler(async (req, res, next) => {
  const {
    avatar,
    platformUsageType,
    companyName,
    companySize,
    industry,
    website,
    logo,
    icps,
    currentActivities,
    desiredPlan,
    goalsObjectives,
    monthlyBudget,
    quickWins
  } = req.body;
  
  const user = await User.findById(req.user._id);
  
  if (!user.hasOwnerProfile) {
    return next(new AppError('Business profile not found', 404));
  }
  
  // Update user avatar if provided
  if (avatar) {
    user.avatar = avatar;
  }
  
  // Build profile update object
  const profileUpdate = {};
  
  if (platformUsageType) profileUpdate.platformUsageType = platformUsageType;
  if (companyName) profileUpdate['company.name'] = companyName;
  if (companySize) profileUpdate.companySize = companySize;
  if (industry) profileUpdate.industry = industry;
  if (website) profileUpdate['company.website'] = website;
  if (logo) profileUpdate['company.logo'] = logo;
  
  if (icps && Array.isArray(icps)) {
    profileUpdate.idealCustomerProfiles = icps.map(icp => ({
      name: icp.name,
      description: icp.description,
      confirmed: icp.confirmed || false,
      createdAt: new Date()
    }));
  }
  
  profileUpdate.marketingActivities = {
    currentActivities: currentActivities || '',
    desiredPlan: desiredPlan || '',
    goalsObjectives: goalsObjectives || ''
  };
  
  if (monthlyBudget) {
    profileUpdate['marketingBudget.monthly'] = monthlyBudget;
  }
  
  if (quickWins) {
    profileUpdate.quickWins = quickWins;
  }
  
  // Update profile
  const profile = await BusinessProfile.findByIdAndUpdate(
    user.profiles.owner,
    profileUpdate,
    { returnDocument: 'after', runValidators: true }
  );
  
  // Mark onboarding as complete
  user.onboarding.owner.currentStep = 7;
  user.onboarding.owner.completed = true;
  await user.save({ validateBeforeSave: false });
  
  res.status(200).json({
    success: true,
    message: 'All onboarding data saved successfully',
    user: {
      avatar: user.avatar
    },
    profile,
    onboarding: user.onboarding.owner
  });
});

module.exports = {
  updateProfilePhoto,
  updatePlatformUsage,
  updateCompanyDetails,
  updateBrandLogo,
  updateICPs,
  addICP,
  updateMarketingActivities,
  updateQuickWins,
  getOnboardingStatus,
  skipStep,
  saveAllOnboardingData
};