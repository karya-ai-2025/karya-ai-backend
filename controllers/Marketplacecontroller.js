// controllers/marketplaceController.js
// Controller for public marketplace - fetching expert profiles

const User = require('../models/User');
const ExpertProfile = require('../models/ExpertProfile');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

// ============================================
// HELPER FUNCTIONS
// ============================================

// Generate avatar color based on name
const getAvatarColor = (name) => {
  const colors = [
    'from-blue-500 to-purple-600',
    'from-green-500 to-teal-600',
    'from-pink-500 to-rose-600',
    'from-orange-500 to-red-600',
    'from-indigo-500 to-blue-600',
    'from-purple-500 to-pink-600',
    'from-cyan-500 to-blue-600',
    'from-amber-500 to-orange-600',
    'from-emerald-500 to-green-600',
    'from-violet-500 to-purple-600',
    'from-rose-500 to-pink-600',
    'from-sky-500 to-cyan-600'
  ];
  
  // Simple hash based on name
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

// Get initials from name
const getInitials = (fullName) => {
  if (!fullName) return 'EX';
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0] ? parts[0].charAt(0).toUpperCase() : '';
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0).toUpperCase() : '';
  return `${first}${last}` || 'EX';
};

// Calculate match score (can be enhanced with actual matching logic)
const calculateMatchScore = (expert, filters = {}) => {
  let score = 70; // Base score
  
  // Boost for high rating
  if (expert.ratings?.overall >= 4.8) score += 10;
  else if (expert.ratings?.overall >= 4.5) score += 5;
  
  // Boost for completed projects
  if (expert.stats?.projectsCompleted >= 50) score += 8;
  else if (expert.stats?.projectsCompleted >= 20) score += 5;
  
  // Boost for verified
  if (expert.profileStatus?.isVerified) score += 5;
  
  // Boost for availability
  if (expert.availability?.status === 'available') score += 5;
  
  // Cap at 99
  return Math.min(99, score);
};

// Generate badges based on expert data
const generateBadges = (expert) => {
  const badges = [];
  
  if (expert.ratings?.overall >= 4.8 && expert.ratings?.totalReviews >= 20) {
    badges.push('Top Rated');
  }
  
  if (expert.profileStatus?.isVerified) {
    badges.push('Expert Vetted');
  }
  
  if (expert.stats?.repeatClients >= 5) {
    badges.push('Repeat Hire Rate');
  }
  
  // Default badge if none
  if (badges.length === 0 && expert.ratings?.totalReviews >= 5) {
    badges.push('Fast Response');
  }
  
  return badges;
};

// Get availability text
const getAvailabilityText = (status) => {
  switch (status) {
    case 'available': return 'Available now';
    case 'busy': return 'Available within 1 week';
    case 'unavailable': return 'Available within 1 month';
    default: return 'Available now';
  }
};

// Transform expert profile for frontend
const transformExpertForFrontend = (expert, user) => {
  const fullName = user.fullName || 'Expert';

  return {
    id: expert._id.toString(),
    name: fullName,
    title: expert.headline || 'Marketing Expert',
    avatar: getInitials(fullName),
    avatarImage: user.avatar || null,
    avatarColor: getAvatarColor(fullName),
    location: expert.location?.city && expert.location?.state 
      ? `${expert.location.city}, ${expert.location.state}`
      : expert.location?.city || 'Remote',
    timezone: expert.location?.timezone || 'UTC',
    online: expert.availability?.status === 'available',
    rating: expert.ratings?.overall || 0,
    reviews: expert.ratings?.totalReviews || 0,
    projectsCompleted: expert.stats?.projectsCompleted || 0,
    yearsExperience: expert.yearsOfExperience || 1,
    hourlyRate: expert.pricing?.hourlyRate?.min || 
                (expert.services?.[0]?.pricing ? parseInt(expert.services[0].pricing) : 100),
    matchScore: calculateMatchScore(expert),
    bio: expert.bio || '',
    expertise: expert.skills?.map(s => s.name) || [],
    industries: expert.industries || [],
    tools: expert.tools || [],
    badges: generateBadges(expert),
    caseStudy: expert.portfolio?.[0] ? {
      title: expert.portfolio[0].title,
      result: expert.portfolio[0].results || expert.portfolio[0].description?.substring(0, 50),
      thumbnail: '📈'
    } : null,
    availability: getAvailabilityText(expert.availability?.status),
    // Additional fields for detail view
    services: expert.services || [],
    socialLinks: expert.socialLinks || {},
    portfolio: expert.portfolio || [],
    primaryCategory: expert.primaryCategory || null
  };
};

// ============================================
// GET ALL PUBLIC EXPERTS
// ============================================

/**
 * @desc    Get all public expert profiles for marketplace
 * @route   GET /api/marketplace/experts
 * @access  Public
 */
const getExperts = asyncHandler(async (req, res, next) => {
  const {
    // Pagination
    page = 1,
    limit = 12,
    // Sorting
    sortBy = 'match', // match, rating, projects, price-low, price-high, availability
    // Filters
    search,
    expertise,      // comma-separated
    industries,     // comma-separated
    tools,          // comma-separated
    availability,   // comma-separated: "Available now,Available within 1 week"
    minPrice,
    maxPrice,
    minRating,
    projectRange,   // "1-5", "5-20", "20-50", "50+"
    timezones       // comma-separated
  } = req.query;

  // Build query for public profiles only
  const query = {
    'profileStatus.isPublic': true,
    'profileStatus.isSearchable': true
  };

  // Search filter
  if (search) {
    const searchRegex = new RegExp(search, 'i');
    query.$or = [
      { headline: searchRegex },
      { bio: searchRegex },
      { 'skills.name': searchRegex },
      { primaryCategory: searchRegex }
    ];
  }

  // Expertise filter
  if (expertise) {
    const expertiseArray = expertise.split(',').map(e => e.trim());
    query['skills.name'] = { $in: expertiseArray };
  }

  // Industries filter
  if (industries) {
    const industriesArray = industries.split(',').map(i => i.trim());
    query.industries = { $in: industriesArray };
  }

  // Tools filter
  if (tools) {
    const toolsArray = tools.split(',').map(t => t.trim());
    query.tools = { $in: toolsArray };
  }

  // Availability filter
  if (availability) {
    const availArray = availability.split(',').map(a => a.trim());
    const statusMap = {
      'Available now': 'available',
      'Available within 1 week': 'busy',
      'Available within 1 month': 'unavailable'
    };
    const statuses = availArray.map(a => statusMap[a]).filter(Boolean);
    if (statuses.length > 0) {
      query['availability.status'] = { $in: statuses };
    }
  }

  // Price range filter
  if (minPrice || maxPrice) {
    query['pricing.hourlyRate.min'] = {};
    if (minPrice) query['pricing.hourlyRate.min'].$gte = parseInt(minPrice);
    if (maxPrice) query['pricing.hourlyRate.min'].$lte = parseInt(maxPrice);
  }

  // Rating filter
  if (minRating) {
    query['ratings.overall'] = { $gte: parseFloat(minRating) };
  }

  // Projects completed filter
  if (projectRange) {
    const rangeMap = {
      '1-5': { min: 1, max: 5 },
      '5-20': { min: 5, max: 20 },
      '20-50': { min: 20, max: 50 },
      '50+': { min: 50, max: 999999 }
    };
    const range = rangeMap[projectRange];
    if (range) {
      query['stats.projectsCompleted'] = { $gte: range.min, $lte: range.max };
    }
  }

  // Timezone filter
  if (timezones) {
    const tzArray = timezones.split(',').map(tz => tz.trim());
    query['location.timezone'] = { $in: tzArray };
  }

  // Build sort options
  let sortOptions = {};
  switch (sortBy) {
    case 'rating':
      sortOptions = { 'ratings.overall': -1 };
      break;
    case 'projects':
      sortOptions = { 'stats.projectsCompleted': -1 };
      break;
    case 'price-low':
      sortOptions = { 'pricing.hourlyRate.min': 1 };
      break;
    case 'price-high':
      sortOptions = { 'pricing.hourlyRate.min': -1 };
      break;
    case 'availability':
      sortOptions = { 'availability.status': 1 }; // 'available' comes first alphabetically
      break;
    case 'match':
    default:
      sortOptions = { 'ratings.overall': -1, 'stats.projectsCompleted': -1 };
      break;
  }

  // Calculate pagination
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;

  // Execute query
  const [experts, total] = await Promise.all([
    ExpertProfile.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(limitNum)
      .lean(),
    ExpertProfile.countDocuments(query)
  ]);

  // Get user data for each expert
  const userIds = experts.map(e => e.user);
  const users = await User.find({ _id: { $in: userIds } })
    .select('fullName avatar email')
    .lean();

  // Create user lookup map
  const userMap = {};
  users.forEach(u => {
    userMap[u._id.toString()] = u;
  });

  // Transform experts for frontend
  const transformedExperts = experts.map(expert => {
    const user = userMap[expert.user.toString()] || {};
    return transformExpertForFrontend(expert, user);
  });

  // Sort by match score if needed (calculated field)
  if (sortBy === 'match') {
    transformedExperts.sort((a, b) => b.matchScore - a.matchScore);
  }

  res.status(200).json({
    success: true,
    data: transformedExperts,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
      hasMore: pageNum * limitNum < total
    }
  });
});

// ============================================
// GET SINGLE EXPERT PROFILE
// ============================================

/**
 * @desc    Get single expert profile by ID
 * @route   GET /api/marketplace/experts/:id
 * @access  Public
 */
const getExpertById = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const expert = await ExpertProfile.findOne({
    _id: id,
    'profileStatus.isPublic': true
  }).lean();

  if (!expert) {
    return next(new AppError('Expert not found', 404));
  }

  const user = await User.findById(expert.user)
    .select('fullName avatar email')
    .lean();

  if (!user) {
    return next(new AppError('Expert user not found', 404));
  }

  // Increment profile views
  await ExpertProfile.findByIdAndUpdate(id, {
    $inc: { 'stats.profileViews': 1 }
  });

  const transformedExpert = transformExpertForFrontend(expert, user);

  res.status(200).json({
    success: true,
    data: transformedExpert
  });
});

// ============================================
// GET FEATURED EXPERT
// ============================================

/**
 * @desc    Get featured expert for sidebar
 * @route   GET /api/marketplace/experts/featured
 * @access  Public
 */
const getFeaturedExpert = asyncHandler(async (req, res, next) => {
  // Get top rated, verified expert with most projects
  const expert = await ExpertProfile.findOne({
    'profileStatus.isPublic': true,
    'profileStatus.isSearchable': true,
    'profileStatus.isFeatured': true
  })
    .sort({ 'ratings.overall': -1, 'stats.projectsCompleted': -1 })
    .lean();

  // If no featured expert, get best rated one
  const fallbackExpert = expert || await ExpertProfile.findOne({
    'profileStatus.isPublic': true,
    'profileStatus.isSearchable': true
  })
    .sort({ 'ratings.overall': -1, 'stats.projectsCompleted': -1 })
    .lean();

  if (!fallbackExpert) {
    return res.status(200).json({
      success: true,
      data: null
    });
  }

  const user = await User.findById(fallbackExpert.user)
    .select('fullName avatar')
    .lean();

  const transformedExpert = transformExpertForFrontend(fallbackExpert, user || {});

  res.status(200).json({
    success: true,
    data: transformedExpert
  });
});

// ============================================
// GET FILTER OPTIONS (for dynamic filters)
// ============================================

/**
 * @desc    Get available filter options based on existing data
 * @route   GET /api/marketplace/filters
 * @access  Public
 */
const getFilterOptions = asyncHandler(async (req, res, next) => {
  // Aggregate distinct values from public profiles
  const [
    expertiseOptions,
    industryOptions,
    toolOptions,
    timezoneOptions
  ] = await Promise.all([
    ExpertProfile.distinct('skills.name', { 'profileStatus.isPublic': true }),
    ExpertProfile.distinct('industries', { 'profileStatus.isPublic': true }),
    ExpertProfile.distinct('tools', { 'profileStatus.isPublic': true }),
    ExpertProfile.distinct('location.timezone', { 'profileStatus.isPublic': true })
  ]);

  // Get price range
  const priceStats = await ExpertProfile.aggregate([
    { $match: { 'profileStatus.isPublic': true, 'pricing.hourlyRate.min': { $exists: true, $gt: 0 } } },
    {
      $group: {
        _id: null,
        minPrice: { $min: '$pricing.hourlyRate.min' },
        maxPrice: { $max: '$pricing.hourlyRate.min' }
      }
    }
  ]);

  res.status(200).json({
    success: true,
    data: {
      expertise: expertiseOptions.filter(Boolean).sort(),
      industries: industryOptions.filter(Boolean).sort(),
      tools: toolOptions.filter(Boolean).sort(),
      timezones: timezoneOptions.filter(Boolean).sort(),
      priceRange: priceStats[0] || { minPrice: 50, maxPrice: 250 },
      availability: ['Available now', 'Available within 1 week', 'Available within 1 month'],
      projectRanges: ['1-5 projects', '5-20 projects', '20-50 projects', '50+ projects']
    }
  });
});

// ============================================
// SEARCH EXPERTS (autocomplete)
// ============================================

/**
 * @desc    Search experts with autocomplete
 * @route   GET /api/marketplace/search
 * @access  Public
 */
const searchExperts = asyncHandler(async (req, res, next) => {
  const { q, limit = 5 } = req.query;

  if (!q || q.length < 2) {
    return res.status(200).json({
      success: true,
      data: []
    });
  }

  const searchRegex = new RegExp(q, 'i');

  const experts = await ExpertProfile.find({
    'profileStatus.isPublic': true,
    $or: [
      { headline: searchRegex },
      { bio: searchRegex },
      { 'skills.name': searchRegex },
      { primaryCategory: searchRegex }
    ]
  })
    .limit(parseInt(limit))
    .lean();

  const userIds = experts.map(e => e.user);
  const users = await User.find({ _id: { $in: userIds } })
    .select('fullName avatar')
    .lean();

  const userMap = {};
  users.forEach(u => {
    userMap[u._id.toString()] = u;
  });

  const results = experts.map(expert => {
    const user = userMap[expert.user.toString()] || {};
    const fullName = user.fullName || 'Expert';
    return {
      id: expert._id.toString(),
      name: fullName,
      title: expert.headline || 'Marketing Expert',
      avatar: getInitials(fullName),
      avatarColor: getAvatarColor(fullName)
    };
  });

  res.status(200).json({
    success: true,
    data: results
  });
});

module.exports = {
  getExperts,
  getExpertById,
  getFeaturedExpert,
  getFilterOptions,
  searchExperts
};
