// controllers/expertOnboardingController.js
// Controller for managing expert onboarding flow

const User = require('../models/User');
const ExpertProfile = require('../models/ExpertProfile');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

// ============================================
// STEP 1: PROFILE SETUP
// ============================================

/**
 * @desc    Update expert profile setup (avatar, headline, bio, etc.)
 * @route   PUT /api/onboarding/expert/profile-setup
 * @access  Private
 */
const updateProfileSetup = asyncHandler(async (req, res, next) => {
  const { 
    avatar, 
    fullName, 
    headline, 
    bio, 
    communicationStyle, 
    yearsOfExperience, 
    location 
  } = req.body;
  
  console.log('=== EXPERT PROFILE SETUP DEBUG ===');
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  
  const user = await User.findById(req.user._id);
  
  if (!user) {
    return next(new AppError('User not found', 404));
  }
  
  // Update user fields
  if (avatar) {
    user.avatar = avatar;
  }
  if (fullName) {
    user.fullName = fullName;
  }
  
  // Check if user has expert profile
  if (!user.hasExpertProfile || !user.profiles?.expert) {
    return next(new AppError('Expert profile not found. Please create an expert profile first.', 404));
  }
  
  // Get expert profile
  const profile = await ExpertProfile.findById(user.profiles.expert);
  
  if (!profile) {
    return next(new AppError('Expert profile document not found', 404));
  }
  
  // Update profile fields
  if (headline) profile.headline = headline;
  if (bio) profile.bio = bio;
  if (communicationStyle) profile.communicationStyle = communicationStyle;
  
  // Parse years of experience
  if (yearsOfExperience) {
    const expMap = {
      '1-3 years': 2,
      '3-5 years': 4,
      '5-10 years': 7,
      '10+ years': 12
    };
    profile.yearsOfExperience = expMap[yearsOfExperience] || parseInt(yearsOfExperience) || 0;
  }
  
  // Update location
  if (location) {
    const locationParts = location.split(',').map(s => s.trim());
    if (!profile.location) profile.location = {};
    profile.location.city = locationParts[0] || '';
    profile.location.state = locationParts[1] || '';
  }
  
  await profile.save();
  await user.save({ validateBeforeSave: false });
  
  // Update onboarding step
  if (!user.onboarding) {
    user.onboarding = { expert: { currentStep: 0, completed: false } };
  }
  if (!user.onboarding.expert) {
    user.onboarding.expert = { currentStep: 0, completed: false };
  }
  user.onboarding.expert.currentStep = Math.max(user.onboarding.expert.currentStep || 0, 1);
  await user.save({ validateBeforeSave: false });
  
  res.status(200).json({
    success: true,
    message: 'Profile setup saved successfully',
    data: {
      avatar: user.avatar,
      fullName: user.fullName,
      headline: profile.headline,
      bio: profile.bio,
      communicationStyle: profile.communicationStyle,
      yearsOfExperience: profile.yearsOfExperience,
      location: profile.location
    },
    onboarding: user.onboarding.expert
  });
});

// ============================================
// STEP 2: SKILLS
// ============================================

/**
 * @desc    Update expert skills
 * @route   PUT /api/onboarding/expert/skills
 * @access  Private
 */
const updateSkills = asyncHandler(async (req, res, next) => {
  const { skills } = req.body;
  
  console.log('=== EXPERT SKILLS DEBUG ===');
  console.log('Skills received:', skills);
  
  if (!skills || !Array.isArray(skills) || skills.length === 0) {
    return next(new AppError('At least one skill is required', 400));
  }
  
  const user = await User.findById(req.user._id);
  
  if (!user) {
    return next(new AppError('User not found', 404));
  }
  
  if (!user.hasExpertProfile || !user.profiles?.expert) {
    return next(new AppError('Expert profile not found', 404));
  }
  
  const profile = await ExpertProfile.findById(user.profiles.expert);
  
  if (!profile) {
    return next(new AppError('Expert profile document not found', 404));
  }
  
  // Format skills - each skill is just a string from frontend
  const formattedSkills = skills.map(skill => {
    if (typeof skill === 'string') {
      return { name: skill.trim(), level: 'Intermediate' };
    }
    return {
      name: skill.name?.trim() || skill,
      level: skill.level || 'Intermediate'
    };
  });
  
  profile.skills = formattedSkills;
  
  // Try to determine primary category from skills
  const categoryKeywords = {
    'Digital Marketing': ['digital', 'marketing', 'campaign'],
    'SEO': ['seo', 'search', 'keywords'],
    'Content Marketing': ['content', 'blog', 'article'],
    'Social Media Marketing': ['social', 'instagram', 'facebook', 'twitter', 'linkedin'],
    'Email Marketing': ['email', 'newsletter', 'mailchimp'],
    'PPC & Paid Ads': ['ppc', 'ads', 'google ads', 'facebook ads'],
    'Analytics & Data': ['analytics', 'data', 'google analytics', 'tableau'],
    'UX/UI Design': ['ux', 'ui', 'design', 'figma'],
    'Web Development': ['html', 'css', 'javascript', 'wordpress']
  };
  
  const skillNames = formattedSkills.map(s => s.name.toLowerCase());
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(kw => skillNames.some(skill => skill.includes(kw)))) {
      if (!profile.primaryCategory) {
        profile.primaryCategory = category;
      }
      break;
    }
  }
  
  await profile.save();
  
  // Update onboarding step
  if (!user.onboarding.expert) {
    user.onboarding.expert = { currentStep: 0, completed: false };
  }
  user.onboarding.expert.currentStep = Math.max(user.onboarding.expert.currentStep || 0, 2);
  await user.save({ validateBeforeSave: false });
  
  res.status(200).json({
    success: true,
    message: 'Skills saved successfully',
    data: {
      skills: profile.skills,
      primaryCategory: profile.primaryCategory
    },
    onboarding: user.onboarding.expert
  });
});

// ============================================
// STEP 3: SERVICES & PRICING
// ============================================

/**
 * @desc    Update expert services and pricing
 * @route   PUT /api/onboarding/expert/services
 * @access  Private
 */
const updateServices = asyncHandler(async (req, res, next) => {
  const { services } = req.body;
  
  console.log('=== EXPERT SERVICES DEBUG ===');
  console.log('Services received:', JSON.stringify(services, null, 2));
  
  if (!services || !Array.isArray(services)) {
    return next(new AppError('Services must be an array', 400));
  }
  
  // Filter valid services
  const validServices = services.filter(s => s.name && s.name.trim());
  
  if (validServices.length === 0) {
    return next(new AppError('At least one service with a name is required', 400));
  }
  
  const user = await User.findById(req.user._id);
  
  if (!user) {
    return next(new AppError('User not found', 404));
  }
  
  if (!user.hasExpertProfile || !user.profiles?.expert) {
    return next(new AppError('Expert profile not found', 404));
  }
  
  const profile = await ExpertProfile.findById(user.profiles.expert);
  
  if (!profile) {
    return next(new AppError('Expert profile document not found', 404));
  }
  
  // Format services
  const formattedServices = validServices.map(service => ({
    name: service.name.trim(),
    description: service.description?.trim() || '',
    pricingType: service.pricingType || 'hourly',
    pricing: service.pricing?.trim() || '',
    duration: service.duration?.trim() || '',
    createdAt: new Date()
  }));
  
  profile.services = formattedServices;
  
  // Try to extract hourly rate for summary pricing
  const hourlyService = formattedServices.find(s => s.pricingType === 'hourly' && s.pricing);
  if (hourlyService) {
    const rateMatch = hourlyService.pricing.match(/(\d+)/);
    if (rateMatch) {
      if (!profile.pricing) profile.pricing = {};
      if (!profile.pricing.hourlyRate) profile.pricing.hourlyRate = {};
      profile.pricing.hourlyRate.min = parseInt(rateMatch[1]);
      profile.pricing.pricingModel = 'flexible';
    }
  }
  
  await profile.save();
  
  // Update onboarding step
  if (!user.onboarding.expert) {
    user.onboarding.expert = { currentStep: 0, completed: false };
  }
  user.onboarding.expert.currentStep = Math.max(user.onboarding.expert.currentStep || 0, 3);
  await user.save({ validateBeforeSave: false });
  
  res.status(200).json({
    success: true,
    message: 'Services saved successfully',
    data: {
      services: profile.services,
      pricing: profile.pricing
    },
    onboarding: user.onboarding.expert
  });
});

// ============================================
// STEP 4: PORTFOLIO
// ============================================

/**
 * @desc    Update expert portfolio and social links
 * @route   PUT /api/onboarding/expert/portfolio
 * @access  Private
 */
const updatePortfolio = asyncHandler(async (req, res, next) => {
  const { caseStudies, links } = req.body;
  
  console.log('=== EXPERT PORTFOLIO DEBUG ===');
  console.log('Case Studies:', JSON.stringify(caseStudies, null, 2));
  console.log('Links:', JSON.stringify(links, null, 2));
  
  const user = await User.findById(req.user._id);
  
  if (!user) {
    return next(new AppError('User not found', 404));
  }
  
  if (!user.hasExpertProfile || !user.profiles?.expert) {
    return next(new AppError('Expert profile not found', 404));
  }
  
  const profile = await ExpertProfile.findById(user.profiles.expert);
  
  if (!profile) {
    return next(new AppError('Expert profile document not found', 404));
  }
  
  // Update portfolio/case studies
  if (caseStudies && Array.isArray(caseStudies)) {
    const validCaseStudies = caseStudies.filter(cs => cs.title || cs.description);
    
    profile.portfolio = validCaseStudies.map(cs => ({
      title: cs.title?.trim() || '',
      client: cs.client?.trim() || '',
      description: cs.description?.trim() || '',
      results: cs.results?.trim() || '',
      link: cs.link?.trim() || '',
      attachments: cs.attachments || [],
      createdAt: new Date()
    }));
  }
  
  // Update social links
  if (links) {
    if (!profile.socialLinks) profile.socialLinks = {};
    if (links.website) profile.socialLinks.website = links.website.trim();
    if (links.linkedin) profile.socialLinks.linkedin = links.linkedin.trim();
    if (links.portfolio) profile.socialLinks.portfolio = links.portfolio.trim();
    if (links.other) profile.socialLinks.other = links.other.trim();
  }
  
  // Mark profile as ready to go public
  if (!profile.profileStatus) profile.profileStatus = {};
  profile.profileStatus.isPublic = true;
  profile.profileStatus.isSearchable = true;
  profile.profileStatus.lastActive = new Date();
  
  await profile.save();
  
  // Mark onboarding as complete
  if (!user.onboarding) {
    user.onboarding = { expert: { currentStep: 0, completed: false } };
  }
  if (!user.onboarding.expert) {
    user.onboarding.expert = { currentStep: 0, completed: false };
  }
  user.onboarding.expert.currentStep = 4;
  user.onboarding.expert.completed = true;
  await user.save({ validateBeforeSave: false });
  
  res.status(200).json({
    success: true,
    message: 'Portfolio saved and onboarding completed!',
    data: {
      portfolio: profile.portfolio,
      socialLinks: profile.socialLinks
    },
    onboarding: user.onboarding.expert
  });
});

// ============================================
// GET ONBOARDING STATUS
// ============================================

/**
 * @desc    Get current expert onboarding status and data
 * @route   GET /api/onboarding/expert/status
 * @access  Private
 */
const getOnboardingStatus = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  
  if (!user) {
    return next(new AppError('User not found', 404));
  }
  
  if (!user.hasExpertProfile || !user.profiles?.expert) {
    return next(new AppError('Expert profile not found', 404));
  }
  
  const profile = await ExpertProfile.findById(user.profiles.expert);
  
  if (!profile) {
    return next(new AppError('Expert profile document not found', 404));
  }
  
  res.status(200).json({
    success: true,
    onboarding: user.onboarding?.expert || { currentStep: 0, completed: false },
    data: {
      // Step 1 data
      avatar: user.avatar,
      fullName: user.fullName,
      headline: profile.headline,
      bio: profile.bio,
      communicationStyle: profile.communicationStyle,
      yearsOfExperience: profile.yearsOfExperience,
      location: profile.location,
      
      // Step 2 data
      skills: profile.skills,
      primaryCategory: profile.primaryCategory,
      
      // Step 3 data
      services: profile.services,
      pricing: profile.pricing,
      
      // Step 4 data
      portfolio: profile.portfolio,
      socialLinks: profile.socialLinks
    }
  });
});

// ============================================
// SKIP STEP
// ============================================

/**
 * @desc    Skip current expert onboarding step
 * @route   POST /api/onboarding/expert/skip/:step
 * @access  Private
 */
const skipStep = asyncHandler(async (req, res, next) => {
  const { step } = req.params;
  const stepNum = parseInt(step);
  
  if (isNaN(stepNum) || stepNum < 1 || stepNum > 4) {
    return next(new AppError('Invalid step number', 400));
  }
  
  const user = await User.findById(req.user._id);
  
  if (!user) {
    return next(new AppError('User not found', 404));
  }
  
  // Initialize onboarding if needed
  if (!user.onboarding) {
    user.onboarding = { expert: { currentStep: 0, completed: false } };
  }
  if (!user.onboarding.expert) {
    user.onboarding.expert = { currentStep: 0, completed: false };
  }
  
  // Update to the next step
  user.onboarding.expert.currentStep = Math.max(user.onboarding.expert.currentStep || 0, stepNum);
  
  // If skipping to step 4, mark as complete and make profile public
  if (stepNum >= 4) {
    user.onboarding.expert.completed = true;

    // Also set profile as public/searchable
    if (user.profiles?.expert) {
      await ExpertProfile.findByIdAndUpdate(user.profiles.expert, {
        'profileStatus.isPublic': true,
        'profileStatus.isSearchable': true,
        'profileStatus.lastActive': new Date()
      });
    }
  }

  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    message: `Step ${stepNum} skipped`,
    onboarding: user.onboarding.expert
  });
});

// ============================================
// SAVE ALL ONBOARDING DATA AT ONCE
// ============================================

/**
 * @desc    Save all expert onboarding data at once (batch save)
 * @route   PUT /api/onboarding/expert/save-all
 * @access  Private
 */
const saveAllOnboardingData = asyncHandler(async (req, res, next) => {
  const {
    // Step 1
    avatar,
    fullName,
    headline,
    bio,
    communicationStyle,
    yearsOfExperience,
    location,
    // Step 2
    skills,
    // Step 3
    services,
    // Step 4
    caseStudies,
    links
  } = req.body;
  
  const user = await User.findById(req.user._id);
  
  if (!user) {
    return next(new AppError('User not found', 404));
  }
  
  if (!user.hasExpertProfile || !user.profiles?.expert) {
    return next(new AppError('Expert profile not found', 404));
  }
  
  const profile = await ExpertProfile.findById(user.profiles.expert);
  
  if (!profile) {
    return next(new AppError('Expert profile document not found', 404));
  }
  
  // Update user fields
  if (avatar) user.avatar = avatar;
  if (fullName) user.fullName = fullName;
  
  // Update Step 1 fields
  if (headline) profile.headline = headline;
  if (bio) profile.bio = bio;
  if (communicationStyle) profile.communicationStyle = communicationStyle;
  if (yearsOfExperience) {
    const expMap = { '1-3 years': 2, '3-5 years': 4, '5-10 years': 7, '10+ years': 12 };
    profile.yearsOfExperience = expMap[yearsOfExperience] || parseInt(yearsOfExperience) || 0;
  }
  if (location) {
    const parts = location.split(',').map(s => s.trim());
    if (!profile.location) profile.location = {};
    profile.location.city = parts[0] || '';
    profile.location.state = parts[1] || '';
  }
  
  // Update Step 2 fields
  if (skills && Array.isArray(skills)) {
    profile.skills = skills.map(skill => ({
      name: typeof skill === 'string' ? skill : skill.name,
      level: skill.level || 'Intermediate'
    }));
  }
  
  // Update Step 3 fields
  if (services && Array.isArray(services)) {
    profile.services = services.filter(s => s.name).map(s => ({
      name: s.name.trim(),
      description: s.description?.trim() || '',
      pricingType: s.pricingType || 'hourly',
      pricing: s.pricing?.trim() || '',
      duration: s.duration?.trim() || '',
      createdAt: new Date()
    }));
  }
  
  // Update Step 4 fields
  if (caseStudies && Array.isArray(caseStudies)) {
    profile.portfolio = caseStudies.filter(cs => cs.title || cs.description).map(cs => ({
      title: cs.title?.trim() || '',
      client: cs.client?.trim() || '',
      description: cs.description?.trim() || '',
      results: cs.results?.trim() || '',
      link: cs.link?.trim() || '',
      attachments: cs.attachments || [],
      createdAt: new Date()
    }));
  }
  
  if (links) {
    if (!profile.socialLinks) profile.socialLinks = {};
    Object.assign(profile.socialLinks, links);
  }
  
  // Save profile
  await profile.save();
  
  // Mark onboarding as complete
  if (!user.onboarding) {
    user.onboarding = { expert: { currentStep: 0, completed: false } };
  }
  if (!user.onboarding.expert) {
    user.onboarding.expert = { currentStep: 0, completed: false };
  }
  user.onboarding.expert.currentStep = 4;
  user.onboarding.expert.completed = true;
  await user.save({ validateBeforeSave: false });
  
  res.status(200).json({
    success: true,
    message: 'All expert onboarding data saved successfully',
    user: {
      avatar: user.avatar,
      fullName: user.fullName
    },
    profile,
    onboarding: user.onboarding.expert
  });
});

module.exports = {
  updateProfileSetup,
  updateSkills,
  updateServices,
  updatePortfolio,
  getOnboardingStatus,
  skipStep,
  saveAllOnboardingData
};