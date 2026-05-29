const { randomUUID } = require('crypto');
const { generateThirtySixtyNinetyPlan } = require('../../anthropicService');
const {
  chooseFallbackProjects,
  getMarketplaceProjectsForPlanner
} = require('../projectCatalogService');
const { createPlanPptx } = require('../pptxService');

const userFacingText = (value = '') => String(value).replace(/\bdiagnostics?\b/gi, 'business review');

const buildFallbackPlan = (state, marketplaceProjects = []) => ({
  summary: `A 30-60-90 day plan to move toward: ${state.goal?.description || 'the confirmed goal'}.`,
  diagnosis: state.gapScores?.summary || 'The biggest opportunity is to create a clearer path from target customer to qualified opportunity.',
  timeline: [
    {
      phase: '30 days',
      focus: 'Foundation and evidence',
      actions: [
        'Clarify ICP and qualification criteria',
        'Audit website or sales assets for conversion gaps',
        'Create the first repeatable outreach or lead capture workflow'
      ],
      outputs: ['ICP brief', 'Gap checklist', 'First campaign or conversion workflow']
    },
    {
      phase: '60 days',
      focus: 'Pipeline motion',
      actions: [
        'Launch the highest-priority acquisition motion',
        'Build proof assets for the main objections',
        'Track weekly lead, reply, and meeting quality'
      ],
      outputs: ['Live campaign', 'Proof assets', 'Weekly KPI dashboard']
    },
    {
      phase: '90 days',
      focus: 'Scale and optimize',
      actions: [
        'Double down on the channel with strongest signal',
        'Improve qualification and conversion handoff',
        'Document the repeatable operating playbook'
      ],
      outputs: ['Optimized growth motion', 'Sales handoff process', '90-day playbook']
    }
  ],
  recommendedProjects: state.businessReview?.recommendedProjects?.length
    ? state.businessReview.recommendedProjects
    : chooseFallbackProjects({
      marketplaceProjects,
      gapScores: state.gapScores
    }),
  kpis: [
    { name: state.goal?.targetMetric || 'qualified opportunities', target: state.goal?.targetMetric || 'Defined weekly target' },
    { name: 'reply or conversion rate', target: 'Improve from baseline' },
    { name: 'lead quality', target: 'Qualified leads rated 7/10 or higher' }
  ],
  nextStep: 'Review the plan and choose the first project to start.'
});

const normalizeRecommendedProjects = (projects = [], marketplaceProjects = [], fallbackProjects = []) => {
  const catalogBySlug = new Map(marketplaceProjects.map((project) => [project.slug, project]));
  const catalogByTitle = new Map(marketplaceProjects.map((project) => [project.title.toLowerCase(), project]));

  const normalized = projects
    .map((project, index) => {
      const catalogProject = catalogBySlug.get(project.slug)
        || catalogByTitle.get(String(project.title || '').toLowerCase());

      if (!catalogProject) return null;

      return {
        slug: catalogProject.slug,
        title: catalogProject.title,
        phase: project.phase || (index === 0 ? '30 days' : index === 1 ? '60 days' : '90 days'),
        priority: Number(project.priority || index + 1),
        gapArea: project.gapArea || '',
        gapScore: project.gapScore,
        searchedSubjects: project.searchedSubjects || [],
        matchedSubjects: project.matchedSubjects || [],
        matchScore: project.matchScore,
        source: project.source || '',
        rationale: userFacingText(project.rationale || catalogProject.tagline || catalogProject.description.slice(0, 140)),
        expectedOutput: userFacingText(project.expectedOutput || catalogProject.deliverables?.[0] || catalogProject.successHighlight || ''),
        marketplaceUrl: catalogProject.marketplaceUrl
      };
    })
    .filter(Boolean);

  const merged = [...normalized];
  fallbackProjects.forEach((project) => {
    if (!merged.some((item) => item.slug === project.slug)) {
      merged.push({
        ...project,
        rationale: userFacingText(project.rationale || ''),
        expectedOutput: userFacingText(project.expectedOutput || '')
      });
    }
  });

  return merged
    .slice(0, 3)
    .map((project, index) => ({
      ...project,
      priority: index + 1
    }));
};

const normalizePlan = (plan, state, marketplaceProjects = []) => {
  const fallback = buildFallbackPlan(state, marketplaceProjects);
  const generatedProjects = Array.isArray(plan?.recommendedProjects) ? plan.recommendedProjects : [];
  const preferredProjects = fallback.recommendedProjects?.length
    ? fallback.recommendedProjects
    : generatedProjects;
  const secondaryProjects = fallback.recommendedProjects?.length
    ? generatedProjects
    : fallback.recommendedProjects;

  return {
    planId: `plan_${randomUUID()}`,
    summary: userFacingText(plan?.summary || fallback.summary),
    diagnosis: userFacingText(plan?.diagnosis || fallback.diagnosis),
    timeline: (Array.isArray(plan?.timeline) && plan.timeline.length > 0 ? plan.timeline : fallback.timeline).map((item) => ({
      ...item,
      focus: userFacingText(item.focus || ''),
      actions: (item.actions || []).map(userFacingText),
      outputs: (item.outputs || []).map(userFacingText)
    })),
    recommendedProjects: normalizeRecommendedProjects(
      preferredProjects,
      marketplaceProjects,
      secondaryProjects
    ),
    kpis: Array.isArray(plan?.kpis) && plan.kpis.length > 0 ? plan.kpis.slice(0, 3) : fallback.kpis,
    nextStep: userFacingText(plan?.nextStep || fallback.nextStep),
    generatedAt: new Date().toISOString()
  };
};

const formatBusinessReviewSection = (gapScores) => {
  if (!gapScores) return '';

  const topGaps = Array.isArray(gapScores.topGaps) ? gapScores.topGaps.join(', ') : 'Not available';
  return [
    `Business readiness score: ${gapScores.overallScore}/10`,
    `Top gaps: ${topGaps}`
  ].join('\n');
};

const formatPlanResponse = (plan, gapScores) => {
  const firstProject = plan.recommendedProjects?.[0];
  const lines = [
    'I reviewed the business context and created a 30-60-90 day plan.',
    '',
    formatBusinessReviewSection(gapScores),
    '',
    `Plan summary: ${plan.summary}`,
    '',
    ...plan.timeline.map((item) => (
      `**${item.phase}: ${item.focus}**\n${(item.actions || []).map((action) => `- ${action}`).join('\n')}`
    )),
    '',
    '**KPIs**',
    ...(plan.kpis || []).map((kpi) => `- ${kpi.name}: ${kpi.target}`),
    '',
    '**Recommended marketplace projects**',
    ...(plan.recommendedProjects || []).map((project) => `- ${project.priority}. ${project.title}: ${project.rationale}`),
    '',
    firstProject ? `First project to pick: ${firstProject.title}` : '',
    '',
    plan.nextStep
  ];

  return lines.filter(Boolean).join('\n');
};

const plannerAgentNode = async (state) => {
  let plan;
  let marketplaceProjects = [];

  try {
    marketplaceProjects = await getMarketplaceProjectsForPlanner();
  } catch {
    marketplaceProjects = [];
  }

  try {
    plan = normalizePlan(
      await generateThirtySixtyNinetyPlan({ state, marketplaceProjects }),
      state,
      marketplaceProjects
    );
  } catch (error) {
    plan = normalizePlan(null, state, marketplaceProjects);
  }

  plan = {
    ...plan,
    ppt: createPlanPptx({ state, plan })
  };

  return {
    plan,
    phase: 'plan_generation',
    nextAction: 'respond',
    uiRequest: {
      type: 'plan_summary',
      plan,
      gapScores: state.gapScores
    },
    response: formatPlanResponse(plan, state.gapScores)
  };
};

module.exports = {
  plannerAgentNode
};
