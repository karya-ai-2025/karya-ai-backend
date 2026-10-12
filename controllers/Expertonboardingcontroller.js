// controllers/expertOnboardingController.js
// Controller for managing expert onboarding flow

const User = require('../models/User');
const ExpertProfile = require('../models/ExpertProfile');
const ProjectCatalog = require('../models/ProjectCatalog');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

const CATEGORY_MAP = {
  'Digital Marketing':      'outbound',
  'SEO':                    'traffic',
  'Content Marketing':      'brand',
  'Social Media Marketing': 'outreach',
  'Email Marketing':        'email',
  'PPC & Paid Ads':         'traffic',
  'Branding':               'brand',
  'Marketing Strategy':     'outbound',
  'Growth Hacking':         'outbound',
  'PR & Communications':    'brand',
  'Influencer Marketing':   'outreach',
  'Video Marketing':        'brand',
  'Analytics & Data':       'intelligence',
  'UX/UI Design':           'assistant',
  'Web Development':        'assistant',
  'Copywriting':            'email',
  'Graphic Design':         'brand',
  'E-commerce Marketing':   'traffic',
};

async function resolveBestProjectSlug(projectType) {
  const catalogCat = CATEGORY_MAP[projectType];
  if (!catalogCat) return null;
  const project = await ProjectCatalog.findOne({ category: catalogCat, isActive: true, isPublished: true })
    .sort({ isFeatured: -1, 'stats.completedCount': -1 })
    .select('slug')
    .lean();
  return project?.slug || null;
}

async function linkExpertToProjects(expertProfileId, linkedSlugs, portfolioItems) {
  for (const slug of linkedSlugs) {
    const catalogDoc = await ProjectCatalog.findOne({ slug, isActive: true });
    if (!catalogDoc) continue;
    const alreadyLinked = catalogDoc.associatedExperts?.some(
      ae => ae.expertId?.toString() === expertProfileId.toString()
    );
    if (alreadyLinked) continue;
    const match = portfolioItems.find(p => p.linkedProjectSlug === slug);
    catalogDoc.associatedExperts.push({
      expertId:        expertProfileId,
      portfolioItemId: match?._id || null,
      contribution:    match?.category || '',
      isVerified:      false,
      addedAt:         new Date(),
    });
    await catalogDoc.save();
  }
}

// Load the member's expert profile, creating it when it is missing — e.g. an
// account that was first created as a business owner and is now onboarding as
// an expert.
async function getOrCreateExpertProfile(user, select) {
  const find = (filter) => {
    const query = ExpertProfile.findOne(filter);
    return select ? query.select(select) : query;
  };

  let profile = user.profiles?.expert ? await find({ _id: user.profiles.expert }) : null;
  if (!profile) profile = await find({ user: user._id });
  if (!profile) {
    profile = await ExpertProfile.create({
      user: user._id,
      profileStatus: { joinedAsExpert: new Date() }
    });
  }

  if (!user.hasExpertProfile || String(user.profiles?.expert) !== String(profile._id)) {
    user.set('profiles.expert', profile._id);
    user.hasExpertProfile = true;
    await User.updateOne(
      { _id: user._id },
      { $set: { 'profiles.expert': profile._id, hasExpertProfile: true } }
    );
  }

  return profile;
}

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
  
  const profile = await getOrCreateExpertProfile(user);
  
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
  
  const profile = await getOrCreateExpertProfile(user);
  
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
  
  const profile = await getOrCreateExpertProfile(user);
  
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
  
  const profile = await getOrCreateExpertProfile(user);
  
  // Update portfolio/case studies
  if (caseStudies && Array.isArray(caseStudies)) {
    const validCaseStudies = caseStudies.filter(cs => cs.title || cs.description);

    const portfolioItems = [];
    for (const cs of validCaseStudies) {
      let linkedProjectSlug = cs.linkedProjectSlug || null;

      // If expert picked a projectType but slug not already resolved, look it up now
      if (!linkedProjectSlug && cs.projectType) {
        linkedProjectSlug = await resolveBestProjectSlug(cs.projectType);
      }

      portfolioItems.push({
        title:             cs.title?.trim()       || '',
        client:            cs.client?.trim()      || '',
        description:       cs.description?.trim() || '',
        results:           cs.results?.trim()     || '',
        category:          cs.projectType         || '',
        linkedProjectSlug: linkedProjectSlug      || '',
        link:              cs.link?.trim()        || '',
        attachments:       cs.attachments         || [],
        createdAt:         new Date(),
      });
    }

    profile.portfolio = portfolioItems;
  }

  // Update social links
  if (links) {
    if (!profile.socialLinks) profile.socialLinks = {};
    if (links.website)   profile.socialLinks.website   = links.website.trim();
    if (links.linkedin)  profile.socialLinks.linkedin  = links.linkedin.trim();
    if (links.portfolio) profile.socialLinks.portfolio = links.portfolio.trim();
    if (links.other)     profile.socialLinks.other     = links.other.trim();
  }

  // Mark profile as ready to go public
  if (!profile.profileStatus) profile.profileStatus = {};
  profile.profileStatus.isPublic     = true;
  profile.profileStatus.isSearchable = true;
  profile.profileStatus.lastActive   = new Date();

  await profile.save();

  // Link expert to catalog projects derived from portfolio projectTypes
  const linkedSlugs = [...new Set(profile.portfolio.map(p => p.linkedProjectSlug).filter(Boolean))];
  if (linkedSlugs.length > 0) {
    await linkExpertToProjects(profile._id, linkedSlugs, profile.portfolio);
  }

  // Mark onboarding as complete
  if (!user.onboarding) {
    user.onboarding = { expert: { currentStep: 0, completed: false } };
  }
  if (!user.onboarding.expert) {
    user.onboarding.expert = { currentStep: 0, completed: false };
  }
  user.onboarding.expert.currentStep = 4;
  user.onboarding.expert.completed   = true;
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    message: 'Portfolio saved and onboarding completed!',
    data: {
      portfolio:   profile.portfolio,
      socialLinks: profile.socialLinks,
    },
    onboarding: user.onboarding.expert,
  });
});

// ============================================
// PROFILING QUESTIONS
// ============================================

const EXPERIENCE_YEARS = { '0-2': 1, '3-5': 4, '6-10': 8, '11-15': 13, '16-20': 18, '20+': 22 };

const cleanText = (value, max = 120) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const cleanList = (value, maxItems = 30) =>
  Array.isArray(value) ? [...new Set(value.map((v) => cleanText(v, 80)).filter(Boolean))].slice(0, maxItems) : null;
const yearOf = (value) => {
  const year = parseInt(value, 10);
  return year >= 1950 && year <= new Date().getFullYear() + 10 ? year : undefined;
};
const yearToDate = (value) => (yearOf(value) ? new Date(Date.UTC(yearOf(value), 0, 1)) : undefined);

/**
 * @desc    Save the onboarding profiling answers. Every field is optional so the
 *          wizard can save after each step; `complete: true` finishes onboarding.
 * @route   PUT /api/expert-onboarding/expert/profiling
 * @access  Private
 */
const updateProfiling = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  if (!user) return next(new AppError('User not found', 404));
  const profile = await getOrCreateExpertProfile(user, '+profiling.ageBand');

  const body = req.body || {};
  if (!profile.profiling) profile.profiling = {};
  const p = profile.profiling;

  for (const key of ['segments', 'subSegments', 'functions', 'topics', 'engagementTypes', 'geographies']) {
    const list = cleanList(body[key]);
    if (list) p[key] = list;
  }
  for (const key of ['otherIndustry', 'seniority', 'currentTitle', 'currentCompany', 'highestQualification']) {
    if (typeof body[key] === 'string') p[key] = cleanText(body[key]);
  }
  if (typeof body.experienceBand === 'string') p.experienceBand = body.experienceBand;
  if (typeof body.ageBand === 'string') p.ageBand = body.ageBand;
  if (typeof body.wantsCall === 'boolean') p.wantsCall = body.wantsCall;

  // Keep the fields the directory, search and matching already read in sync
  if (body.segments || body.subSegments) {
    profile.industries = [...new Set([...(p.segments || []), ...(p.subSegments || [])])];
  }
  if (EXPERIENCE_YEARS[p.experienceBand] !== undefined && typeof body.experienceBand === 'string') {
    profile.yearsOfExperience = EXPERIENCE_YEARS[p.experienceBand];
  }
  if (typeof body.bio === 'string') profile.bio = cleanText(body.bio, 2500);
  if (typeof body.headline === 'string' && body.headline.trim()) profile.headline = cleanText(body.headline);
  else if (!profile.headline && p.currentTitle) {
    profile.headline = cleanText([p.currentTitle, p.currentCompany].filter(Boolean).join(' at '));
  }
  if (body.topics && !profile.skills?.length) {
    profile.skills = p.topics.map((name) => ({ name, level: 'Advanced' }));
  }
  if (body.location && typeof body.location === 'object') {
    if (!profile.location) profile.location = {};
    profile.location.city = cleanText(body.location.city, 80);
    if (cleanText(body.location.country, 80)) profile.location.country = cleanText(body.location.country, 80);
  }

  if (Array.isArray(body.education)) {
    profile.education = body.education.slice(0, 10)
      .map((e) => ({
        institution: cleanText(e?.institution),
        degree: cleanText(e?.degree),
        field: cleanText(e?.field),
        yearFrom: yearOf(e?.yearFrom),
        yearTo: yearOf(e?.yearTo)
      }))
      .filter((e) => e.institution || e.degree);
  }
  if (Array.isArray(body.experience)) {
    profile.experience = body.experience.slice(0, 20)
      .map((e) => ({
        title: cleanText(e?.title),
        company: cleanText(e?.company),
        description: cleanText(e?.description, 500),
        startDate: yearToDate(e?.yearFrom),
        endDate: e?.isCurrent ? undefined : yearToDate(e?.yearTo),
        isCurrent: !!e?.isCurrent
      }))
      .filter((e) => e.title || e.company);
  }
  if (Array.isArray(body.certifications)) {
    profile.certifications = body.certifications.slice(0, 20)
      .map((c) => ({ name: cleanText(typeof c === 'string' ? c : c?.name), issuer: cleanText(c?.issuer) }))
      .filter((c) => c.name);
  }

  if (!user.onboarding) user.onboarding = {};
  if (!user.onboarding.expert) user.onboarding.expert = { currentStep: 0, completed: false };

  if (body.complete === true) {
    p.completedAt = new Date();
    if (!profile.profileStatus) profile.profileStatus = {};
    profile.profileStatus.isPublic = true;
    profile.profileStatus.isSearchable = true;
    profile.profileStatus.lastActive = new Date();
    user.onboarding.expert.currentStep = 4;
    user.onboarding.expert.completed = true;
  } else {
    user.onboarding.expert.currentStep = Math.max(user.onboarding.expert.currentStep || 0, 1);
  }

  await profile.save();
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    message: 'Profile saved',
    data: {
      profiling: profile.profiling,
      education: profile.education,
      experience: profile.experience,
      certifications: profile.certifications
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
  
  const profile = await getOrCreateExpertProfile(user, '+profiling.ageBand');
  
  res.status(200).json({
    success: true,
    profileId: profile._id, // ExpertProfile id — used to open the public expert profile
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
      socialLinks: profile.socialLinks,

      // Profiling questions
      profiling: profile.profiling,
      education: profile.education,
      experience: profile.experience,
      certifications: profile.certifications
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
      await ExpertProfile.findOneAndUpdate({ _id: user.profiles.expert, 'profileStatus.isDemo': { $ne: true } }, {
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
  
  const profile = await getOrCreateExpertProfile(user);
  
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
  
  // Mark profile as public and searchable on completion
  if (!profile.profileStatus) profile.profileStatus = {};
  profile.profileStatus.isPublic = true;
  profile.profileStatus.isSearchable = true;
  profile.profileStatus.lastActive = new Date();

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
  updateProfiling,
  getOnboardingStatus,
  skipStep,
  saveAllOnboardingData
};