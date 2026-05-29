const ProjectCatalog = require('../../models/ProjectCatalog');

const normalizeProject = (project) => ({
  id: String(project._id || project.id || ''),
  slug: project.slug,
  title: project.title,
  subtitle: project.subtitle || '',
  tagline: project.tagline || '',
  description: project.description || '',
  category: project.category || '',
  difficulty: project.difficulty || '',
  duration: project.duration || '',
  budgetRange: project.budgetRange || '',
  subProjects: Array.isArray(project.subProjects) ? project.subProjects.slice(0, 6) : [],
  howItWorks: Array.isArray(project.howItWorks) ? project.howItWorks.slice(0, 6) : [],
  deliverables: Array.isArray(project.deliverables) ? project.deliverables.slice(0, 5) : [],
  subjects: Array.isArray(project.subjects) ? project.subjects.slice(0, 6) : [],
  tools: Array.isArray(project.tools) ? project.tools.slice(0, 6) : [],
  targetFor: Array.isArray(project.targetFor) ? project.targetFor.slice(0, 5) : [],
  expertSkills: Array.isArray(project.expertSkills) ? project.expertSkills.slice(0, 5) : [],
  matchIndustries: Array.isArray(project.matchIndustries) ? project.matchIndustries.slice(0, 6) : [],
  successHighlight: project.successHighlight || '',
  successROI: project.successROI || '',
  successStoryResult: project.successStory?.result || '',
  isFeatured: Boolean(project.isFeatured),
  isTrending: Boolean(project.isTrending),
  completedCount: project.stats?.completedCount || 0,
  avgRating: project.stats?.avgRating || 0,
  marketplaceUrl: `/project-marketplace/${project.slug}`
});

const GAP_AREAS = ['awareness', 'discovery', 'connect', 'qualify', 'convert', 'retain'];

const GAP_AREA_SUBJECT_KEYWORDS = {
  awareness: [
    'Brand Positioning',
    'Content Strategy',
    'Market Visibility',
    'Social Proof',
    'Website Messaging',
    'Brand Awareness',
    'Traffic'
  ],
  discovery: [
    'Lead Generation',
    'ICP Strategy',
    'Data Research',
    'Market Research',
    'Customer Research',
    'Prospecting',
    'Discovery'
  ],
  connect: [
    'Cold Outreach',
    'Cold Email',
    'Email Campaigns',
    'Prospecting',
    'Outbound',
    'LinkedIn Outreach',
    'Lead Nurturing'
  ],
  qualify: [
    'Lead Qualification',
    'ICP Research',
    'CRM Workflow',
    'Sales Qualification',
    'Customer Segmentation',
    'Pipeline Qualification'
  ],
  convert: [
    'Landing Page Optimization',
    'Conversion Optimization',
    'Sales Assets',
    'Case Studies',
    'Demo Booking',
    'Funnel Optimization',
    'Proposal'
  ],
  retain: [
    'Customer Retention',
    'CRM Follow Up',
    'Nurture Campaigns',
    'Relationship Management',
    'Customer Success',
    'Lifecycle Marketing',
    'Reactivation'
  ]
};

const getMarketplaceProjectsForPlanner = async (limit = 24) => {
  const projects = await ProjectCatalog.find({ isActive: true, isPublished: true })
    .select('slug title subtitle tagline description category difficulty duration budgetRange subProjects howItWorks deliverables subjects tools targetFor expertSkills matchIndustries successHighlight successROI successStory isFeatured isTrending stats')
    .sort({ isFeatured: -1, isTrending: -1, 'stats.trendingCount': -1, createdAt: -1 })
    .limit(limit)
    .lean();

  return projects.map(normalizeProject);
};

const tokenize = (value = '') => (
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2)
);

const unique = (items = []) => [...new Set(items.filter(Boolean))];

const normalizeSearchText = (value = '') => String(value)
  .toLowerCase()
  .replace(/[^a-z0-9\s-]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const subjectMatchesKeyword = (subject, keyword) => {
  const normalizedSubject = normalizeSearchText(subject);
  const normalizedKeyword = normalizeSearchText(keyword);
  if (!normalizedSubject || !normalizedKeyword) return false;
  if (normalizedSubject === normalizedKeyword) return true;
  if (normalizedSubject.includes(normalizedKeyword) || normalizedKeyword.includes(normalizedSubject)) return true;

  const subjectTokens = new Set(tokenize(normalizedSubject));
  const keywordTokens = tokenize(normalizedKeyword);
  if (keywordTokens.length === 0 || subjectTokens.size === 0) return false;

  const overlapCount = keywordTokens.filter((token) => subjectTokens.has(token)).length;
  const keywordOverlap = overlapCount / keywordTokens.length;
  const subjectOverlap = overlapCount / subjectTokens.size;
  return keywordOverlap >= 0.67 || subjectOverlap >= 0.67;
};

const getGapAreaScores = (gapScores = {}) => (
  GAP_AREAS
    .map((area) => ({
      area,
      score: Number(gapScores?.[area]?.score)
    }))
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) => left.score - right.score)
);

const getRequirementText = (state = {}) => [
  state.goal?.description,
  state.goal?.targetMetric,
  state.businessProfile?.desiredOutcome,
  state.businessProfile?.targetCustomer,
  state.businessProfile?.industry,
  state.businessProfile?.constraints,
  state.memorySummary?.summary
].filter(Boolean).join(' ');

const getRequirementSummary = (state = {}) => {
  const parts = [
    state.businessProfile?.companyName ? `Company: ${state.businessProfile.companyName}` : '',
    state.businessProfile?.industry ? `Industry: ${state.businessProfile.industry}` : '',
    state.businessProfile?.targetCustomer ? `Target customer: ${state.businessProfile.targetCustomer}` : '',
    state.goal?.description ? `Goal: ${state.goal.description}` : ''
  ].filter(Boolean);

  return parts.join('. ').slice(0, 600);
};

const scoreProjectForGapArea = ({ project, gapArea, gapScore, requirementTokens }) => {
  const searchedSubjects = GAP_AREA_SUBJECT_KEYWORDS[gapArea] || [];
  const projectSubjects = Array.isArray(project.subjects) ? project.subjects : [];
  const matchedSubjects = unique(projectSubjects.filter((subject) => (
    searchedSubjects.some((keyword) => subjectMatchesKeyword(subject, keyword))
  )));

  if (matchedSubjects.length === 0) {
    return {
      score: 0,
      searchedSubjects,
      matchedSubjects
    };
  }

  const subjectScore = matchedSubjects.reduce((total, subject) => {
    const bestKeywordScore = searchedSubjects.reduce((best, keyword) => {
      const normalizedSubject = normalizeSearchText(subject);
      const normalizedKeyword = normalizeSearchText(keyword);
      if (normalizedSubject === normalizedKeyword) return Math.max(best, 12);
      if (normalizedSubject.includes(normalizedKeyword) || normalizedKeyword.includes(normalizedSubject)) return Math.max(best, 8);
      return Math.max(best, 4);
    }, 0);
    return total + bestKeywordScore;
  }, 0);

  const projectSubjectTokens = tokenize(projectSubjects.join(' '));
  const requirementBoost = projectSubjectTokens.reduce((total, token) => (
    requirementTokens.includes(token) ? total + 1 : total
  ), 0);
  const gapPriorityBoost = Math.max(0, 10 - gapScore);
  const marketplaceBoost = (project.isFeatured ? 2 : 0)
    + (project.isTrending ? 2 : 0)
    + Math.min(project.completedCount || 0, 50) / 25
    + Math.min(project.avgRating || 0, 5) / 2;

  return {
    score: subjectScore + requirementBoost + gapPriorityBoost + marketplaceBoost,
    searchedSubjects,
    matchedSubjects
  };
};

const buildGapRecommendationReason = ({ gapArea, gapScore, matchedSubjects }) => {
  const subjects = matchedSubjects.length ? matchedSubjects.join(', ') : 'the mapped project subjects';
  return `Recommended because ${gapArea} is one of the lowest gap scores at ${gapScore}/10 and the project subjects match ${subjects}.`;
};

const buildGapBasedProjectRecommendations = ({
  state = {},
  gapScores = {},
  marketplaceProjects = [],
  limit = 3
}) => {
  const areaScores = getGapAreaScores(gapScores);
  const priorityAreas = areaScores.slice(0, limit);
  const requirementTokens = expandQueryTokens(getRequirementText(state));
  const usedProjectSlugs = new Set();
  const recommendations = [];
  const getBestMatchForArea = ({ area, score, excludeUsed = true }) => marketplaceProjects
    .filter((project) => project?.slug && (!excludeUsed || !usedProjectSlugs.has(project.slug)))
    .map((project) => {
      const match = scoreProjectForGapArea({
        project,
        gapArea: area,
        gapScore: score,
        requirementTokens
      });
      return {
        project,
        ...match
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)[0];

  const reservedMatchedProjectSlugs = new Set(priorityAreas
    .map(({ area, score }) => getBestMatchForArea({ area, score, excludeUsed: false })?.project?.slug)
    .filter(Boolean));

  const chooseAvailableFallbackProject = () => marketplaceProjects
    .filter((project) => (
      project?.slug
      && !usedProjectSlugs.has(project.slug)
      && !reservedMatchedProjectSlugs.has(project.slug)
    ))
    .sort((left, right) => {
      const leftScore = (left.isFeatured ? 4 : 0) + (left.isTrending ? 3 : 0) + (left.completedCount || 0);
      const rightScore = (right.isFeatured ? 4 : 0) + (right.isTrending ? 3 : 0) + (right.completedCount || 0);
      return rightScore - leftScore;
    })[0] || marketplaceProjects
    .filter((project) => project?.slug && !usedProjectSlugs.has(project.slug))
    .sort((left, right) => {
      const leftScore = (left.isFeatured ? 4 : 0) + (left.isTrending ? 3 : 0) + (left.completedCount || 0);
      const rightScore = (right.isFeatured ? 4 : 0) + (right.isTrending ? 3 : 0) + (right.completedCount || 0);
      return rightScore - leftScore;
    })[0];

  priorityAreas.forEach(({ area, score }) => {
    if (recommendations.length >= limit) return;

    const best = getBestMatchForArea({ area, score });
    if (!best) {
      const fallbackProject = chooseAvailableFallbackProject();
      if (!fallbackProject) return;

      usedProjectSlugs.add(fallbackProject.slug);
      recommendations.push({
        id: fallbackProject.id,
        slug: fallbackProject.slug,
        title: fallbackProject.title,
        category: fallbackProject.category,
        phase: recommendations.length === 0 ? '30 days' : recommendations.length === 1 ? '60 days' : '90 days',
        priority: recommendations.length + 1,
        gapArea: area,
        gapScore: score,
        searchedSubjects: GAP_AREA_SUBJECT_KEYWORDS[area] || [],
        matchedSubjects: [],
        matchScore: 0,
        rationale: `Recommended as an available marketplace fallback for the ${area} gap area because no subject-level match was found.`,
        expectedOutput: fallbackProject.deliverables?.[0] || fallbackProject.successHighlight || 'A measurable growth asset or operating workflow',
        marketplaceUrl: fallbackProject.marketplaceUrl,
        source: 'gap_subject_mapping_fallback'
      });
      return;
    }

    usedProjectSlugs.add(best.project.slug);
    recommendations.push({
      id: best.project.id,
      slug: best.project.slug,
      title: best.project.title,
      category: best.project.category,
      phase: recommendations.length === 0 ? '30 days' : recommendations.length === 1 ? '60 days' : '90 days',
      priority: recommendations.length + 1,
      gapArea: area,
      gapScore: score,
      searchedSubjects: best.searchedSubjects,
      matchedSubjects: best.matchedSubjects,
      matchScore: Math.round(best.score),
      rationale: buildGapRecommendationReason({
        gapArea: area,
        gapScore: score,
        matchedSubjects: best.matchedSubjects
      }),
      expectedOutput: best.project.deliverables?.[0] || best.project.successHighlight || 'A measurable growth asset or operating workflow',
      marketplaceUrl: best.project.marketplaceUrl,
      source: 'gap_subject_mapping'
    });
  });

  return recommendations;
};

const expandQueryTokens = (query) => {
  const raw = String(query || '').toLowerCase();
  const tokens = tokenize(raw);
  const expanded = [...tokens];

  const expansions = [
    {
      pattern: /\b(cold\s*email|cold\s*outreach|email\s*campaign|email\s*campaigns|campaigns?|outbound|prospecting)\b/i,
      terms: ['email', 'outbound', 'outreach', 'campaign', 'lead', 'prospecting', 'sequence', 'reply']
    },
    {
      pattern: /\b(lead\s*gen|lead\s*generation|qualified\s*leads|leads?|pipeline)\b/i,
      terms: ['lead', 'pipeline', 'prospecting', 'outbound', 'qualification', 'discovery']
    },
    {
      pattern: /\b(brand|positioning|content|social|awareness)\b/i,
      terms: ['brand', 'positioning', 'content', 'awareness', 'traffic']
    },
    {
      pattern: /\b(convert|conversion|landing|website|funnel|demo|bookings?)\b/i,
      terms: ['conversion', 'funnel', 'landing', 'demo', 'booking', 'website']
    },
    {
      pattern: /\b(research|icp|customer|persona|market|intelligence)\b/i,
      terms: ['research', 'icp', 'customer', 'persona', 'market', 'intelligence']
    },
    {
      pattern: /\b(relationship|crm|follow\s*up|nurture|retain|retention)\b/i,
      terms: ['relationship', 'crm', 'follow', 'nurture', 'retention']
    }
  ];

  expansions.forEach(({ pattern, terms }) => {
    if (pattern.test(raw)) expanded.push(...terms);
  });

  return unique(expanded);
};

const projectSearchFields = (project) => [
  project.title,
  project.subtitle,
  project.tagline,
  project.description,
  project.category,
  project.successHighlight,
  project.successROI,
  project.successStoryResult,
  ...(project.subProjects || []),
  ...(project.howItWorks || []),
  ...(project.deliverables || []),
  ...(project.subjects || []),
  ...(project.tools || []),
  ...(project.targetFor || []),
  ...(project.expertSkills || []),
  ...(project.matchIndustries || [])
].filter(Boolean);

const scoreMarketplaceProject = ({ project, query, queryTokens }) => {
  const weightedFields = [
    { value: project.title, weight: 8, label: 'title' },
    { value: project.category, weight: 7, label: 'category' },
    { value: project.tagline, weight: 6, label: 'tagline' },
    { value: project.subtitle, weight: 5, label: 'subtitle' },
    { value: project.description, weight: 4, label: 'description' },
    { value: (project.deliverables || []).join(' '), weight: 6, label: 'deliverables' },
    { value: (project.subjects || []).join(' '), weight: 5, label: 'subjects' },
    { value: (project.tools || []).join(' '), weight: 5, label: 'tools' },
    { value: (project.expertSkills || []).join(' '), weight: 4, label: 'skills' },
    { value: (project.howItWorks || []).join(' '), weight: 4, label: 'workflow' },
    { value: `${project.successHighlight || ''} ${project.successROI || ''} ${project.successStoryResult || ''}`, weight: 4, label: 'proof' },
    { value: (project.targetFor || []).join(' '), weight: 3, label: 'target audience' },
    { value: (project.matchIndustries || []).join(' '), weight: 3, label: 'industry fit' }
  ];

  const normalizedQuery = String(query || '').toLowerCase();
  const matchedFields = new Map();
  let score = 0;

  weightedFields.forEach((field) => {
    const text = String(field.value || '').toLowerCase();
    if (!text) return;

    queryTokens.forEach((token) => {
      if (text.includes(token)) {
        score += field.weight;
        matchedFields.set(field.label, (matchedFields.get(field.label) || 0) + 1);
      }
    });

    if (normalizedQuery.length > 6 && text.includes(normalizedQuery)) {
      score += field.weight * 3;
      matchedFields.set(field.label, (matchedFields.get(field.label) || 0) + 3);
    }
  });

  if (project.isFeatured) score += 2;
  if (project.isTrending) score += 2;
  score += Math.min(project.completedCount || 0, 50) / 25;
  score += Math.min(project.avgRating || 0, 5) / 2;

  return {
    score,
    matchedFields: [...matchedFields.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([label]) => label)
      .slice(0, 4)
  };
};

const buildMatchReason = ({ project, matchedFields }) => {
  const basis = matchedFields.length ? matchedFields.join(', ') : 'catalog details';
  const reason = project.tagline || project.description || 'This project matches the requested service area.';
  return `Matched on ${basis}. ${reason}`.slice(0, 220);
};

const getProjectSignals = (project) => unique([
  ...(project.deliverables || []).slice(0, 2),
  project.successHighlight,
  project.successROI,
  project.successStoryResult
]).slice(0, 4);

const matchMarketplaceProjects = ({ query, marketplaceProjects = [], limit = 3 }) => {
  const queryTokens = expandQueryTokens(query);

  if (!queryTokens.length) return [];

  return marketplaceProjects
    .map((project) => {
      const { score, matchedFields } = scoreMarketplaceProject({ project, query, queryTokens });
      return {
        project,
        score,
        matchedFields
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ project, score, matchedFields }, index) => ({
      slug: project.slug,
      title: project.title,
      category: project.category,
      priority: index + 1,
      score: Math.round(score),
      tagline: project.tagline || project.subtitle || '',
      rationale: buildMatchReason({ project, matchedFields }),
      expectedOutput: project.deliverables?.[0] || project.successHighlight || 'A useful Karya project output',
      kpiSignals: getProjectSignals(project),
      matchedFields,
      marketplaceUrl: project.marketplaceUrl
    }));
};

const buildMarketplaceProjectMatch = async ({ query, limit = 3 }) => {
  const marketplaceProjects = await getMarketplaceProjectsForPlanner(50);
  const matches = matchMarketplaceProjects({
    query,
    marketplaceProjects,
    limit
  });

  return {
    query,
    matches,
    generatedAt: new Date().toISOString()
  };
};

const chooseFallbackProjects = ({ marketplaceProjects = [], gapScores }) => {
  const gapRecommendations = buildGapBasedProjectRecommendations({
    gapScores,
    marketplaceProjects,
    limit: 3
  });

  if (gapRecommendations.length > 0) return gapRecommendations;

  const topGaps = Array.isArray(gapScores?.topGaps)
    ? gapScores.topGaps.join(' ').toLowerCase()
    : '';

  const scored = marketplaceProjects.map((project) => {
    const searchable = [
      project.title,
      project.tagline,
      project.description,
      project.category,
      ...(project.deliverables || []),
      ...(project.targetFor || []),
      ...(project.expertSkills || [])
    ].join(' ').toLowerCase();

    let score = 0;
    if (project.isFeatured) score += 4;
    if (project.isTrending) score += 3;
    score += Math.min(project.completedCount || 0, 50) / 25;
    score += Math.min(project.avgRating || 0, 5) / 2;

    ['outbound', 'email', 'lead', 'pipeline', 'conversion', 'discovery', 'icp', 'contact', 'traffic', 'brand'].forEach((keyword) => {
      if (topGaps.includes(keyword) && searchable.includes(keyword)) score += 4;
    });

    return { project, score };
  });

  return scored
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map(({ project }, index) => ({
      slug: project.slug,
      title: project.title,
      phase: index === 0 ? '30 days' : index === 1 ? '60 days' : '90 days',
      priority: index + 1,
      rationale: project.tagline || project.description.slice(0, 140) || 'This marketplace project matches the highest-priority growth work.',
      expectedOutput: project.deliverables?.[0] || project.successHighlight || 'A measurable growth asset or operating workflow',
      marketplaceUrl: project.marketplaceUrl
    }));
};

const toHelpArea = (gap, project, index) => ({
  title: gap || project?.title || `Growth area ${index + 1}`,
  whyItMatters: project?.rationale
    || 'This is one of the highest-leverage areas to improve before scaling execution.',
  project: project ? {
    slug: project.slug,
    title: project.title,
    marketplaceUrl: project.marketplaceUrl,
    phase: project.phase,
    priority: index + 1,
    gapArea: project.gapArea || '',
    gapScore: project.gapScore,
    matchedSubjects: project.matchedSubjects || []
  } : null
});

const formatGapAreaTitle = (area) => String(area || '')
  .replace(/[_-]+/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const buildBusinessReview = ({ state, gapScores, marketplaceProjects = [], recommendedProjects = null }) => {
  const projectRecommendations = Array.isArray(recommendedProjects) && recommendedProjects.length > 0
    ? recommendedProjects
    : chooseFallbackProjects({
    marketplaceProjects,
    gapScores
    });

  const topGaps = projectRecommendations.length > 0
    ? projectRecommendations.map((project) => `${formatGapAreaTitle(project.gapArea)} gap`)
    : Array.isArray(gapScores?.topGaps) && gapScores.topGaps.length > 0
    ? gapScores.topGaps
    : ['Discovery path', 'Connect motion', 'Conversion proof'];

  const helpAreas = topGaps.slice(0, 3).map((gap, index) => (
    toHelpArea(gap, projectRecommendations[index], index)
  ));

  return {
    summary: gapScores?.summary || `Karya can help turn ${state.goal?.description || 'the confirmed goal'} into a focused execution plan.`,
    overallScore: gapScores?.overallScore || null,
    helpAreas,
    recommendedProjects: projectRecommendations,
    generatedAt: new Date().toISOString()
  };
};

module.exports = {
  GAP_AREA_SUBJECT_KEYWORDS,
  buildGapBasedProjectRecommendations,
  buildBusinessReview,
  buildMarketplaceProjectMatch,
  chooseFallbackProjects,
  getMarketplaceProjectsForPlanner,
  getRequirementSummary,
  matchMarketplaceProjects
};
