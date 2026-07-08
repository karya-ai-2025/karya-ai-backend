/**
 * Capability Registry — single source of truth for what this platform can do.
 *
 * To add a new specialist agent:
 *   1. Add an entry here with id, description, nextAction, node, fields
 *   2. Create the node file in services/agent/nodes/
 *   3. Register the node in workflow.js
 *   That's it. No other routing code changes needed.
 */

const CAPABILITIES = [
  {
    id: 'leads',
    description: [
      'Find B2B contacts, leads, prospects, people to reach out to or sell to.',
      'Includes finding executives, VCs, CTOs, decision makers, buyers, or any specific role.',
      'User is looking for a list of people or companies to contact.'
    ].join(' '),
    nextAction: 'run_leads_agent',
    node: 'leads_agent_node',
    // Which extractedFields keys this capability cares about
    fields: ['industry', 'location', 'segment', 'seniority', 'title', 'company'],
    // Where in state to put the extracted fields before the node runs
    stateKey: 'leadsFilter'
  },
  {
    id: 'email_campaign',
    description: [
      'Write, draft, or set up a cold email / outbound email campaign or email sequence to send to leads, prospects, or contacts.',
      'User wants to email prospects, do outreach, build an email sequence, or send a campaign to the leads they found.'
    ].join(' '),
    nextAction: 'run_email_agent',
    node: 'email_agent_node',
    // No structured fields — the node drafts copy from the business profile,
    // goal, and the existing leadsFilter (its recipient source).
    fields: [],
    stateKey: null
  },
  {
    id: 'growth_plan',
    description: [
      'Create a 30-60-90 day business growth plan, roadmap, go-to-market strategy, or action plan.',
      'User wants structured steps to achieve a business goal.'
    ].join(' '),
    nextAction: 'run_planner',
    node: 'planner_agent_node',
    fields: ['goalDescription', 'goalTimeframeDays', 'goalTargetMetric'],
    stateKey: null
  },
  {
    id: 'project_match',
    description: [
      'Find a Karya marketplace project, service, or expert for a specific problem, workflow, or outcome.',
      'User asks which project or service can help them with something specific.'
    ].join(' '),
    nextAction: 'match_marketplace_project',
    node: null, // handled inside orchestratorNode directly
    fields: ['need'],
    stateKey: null
  }
];

const getById     = (id)         => CAPABILITIES.find((c) => c.id         === id)         || null;
const getByAction = (nextAction) => CAPABILITIES.find((c) => c.nextAction  === nextAction) || null;
const getByNode   = (node)       => CAPABILITIES.find((c) => c.node        === node)       || null;

// Returns the subset of CAPABILITIES formatted for Claude prompt injection
const describeForClaude = () =>
  CAPABILITIES.map((c) => `- id: "${c.id}"\n  description: ${c.description}\n  fields: ${c.fields.join(', ')}`).join('\n\n');

module.exports = {
  CAPABILITIES,
  getById,
  getByAction,
  getByNode,
  describeForClaude
};
