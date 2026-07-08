const { END, START, StateGraph } = require('@langchain/langgraph');
const { AgentStateAnnotation } = require('./state');
const { intentRouterNode }      = require('./nodes/intentRouterNode');
const { memoryAgentNode }       = require('./nodes/memoryAgentNode');
const { orchestratorNode }      = require('./nodes/orchestratorNode');
const { diagnosticPlannerNode } = require('./nodes/diagnosticPlannerNode');
const { diagnosticAgentNode }   = require('./nodes/diagnosticAgentNode');
const { plannerAgentNode }      = require('./nodes/plannerAgentNode');
const { leadsAgentNode }        = require('./nodes/leadsAgentNode');
const { emailAgentNode }        = require('./nodes/emailAgentNode');
const { getByAction }           = require('./capabilityRegistry');

/**
 * routeAfterOrchestrator — reads state.nextAction and routes to the right node.
 *
 * For registry-based capabilities: looks up the node name from the registry.
 * For built-in flow steps: uses hardcoded checks.
 * Adding a new capability never requires changing this function —
 * just add the capability to capabilityRegistry.js and create its node.
 */
const routeAfterOrchestrator = (state) => {
  // Registry lookup — covers all specialist agents (leads, future email, etc.)
  const capability = getByAction(state.nextAction);
  if (capability?.node) return capability.node;

  // Built-in flow steps that aren't in the registry
  if (state.nextAction === 'run_planner') return 'planner_agent_node';

  if (state.phase === 'diagnostic_intake' || state.nextAction === 'collect_evidence') {
    return 'diagnostic_planner_node';
  }

  return END;
};

const routeAfterDiagnosticPlanner = (state) => {
  if (state.nextAction === 'run_diagnostic') return 'diagnostic_agent_node';
  if (state.nextAction === 'run_planner')    return 'planner_agent_node';
  return END;
};

const routeAfterDiagnosticAgent = (state) => {
  if (state.nextAction === 'run_planner') return 'planner_agent_node';
  return END;
};

const agentGraph = new StateGraph(AgentStateAnnotation)
  .addNode('intent_router_node',      intentRouterNode)
  .addNode('memory_agent_node',       memoryAgentNode)
  .addNode('orchestrator_node',       orchestratorNode)
  .addNode('diagnostic_planner_node', diagnosticPlannerNode)
  .addNode('diagnostic_agent_node',   diagnosticAgentNode)
  .addNode('planner_agent_node',      plannerAgentNode)
  .addNode('leads_agent_node',        leadsAgentNode)
  .addNode('email_agent_node',        emailAgentNode)
  // Future specialist nodes get added here — one line each
  .addEdge(START,                     'intent_router_node')
  .addEdge('intent_router_node',      'memory_agent_node')
  .addEdge('memory_agent_node',       'orchestrator_node')
  .addConditionalEdges('orchestrator_node',       routeAfterOrchestrator)
  .addConditionalEdges('diagnostic_planner_node', routeAfterDiagnosticPlanner)
  .addConditionalEdges('diagnostic_agent_node',   routeAfterDiagnosticAgent)
  .addEdge('planner_agent_node', END)
  .addEdge('leads_agent_node',   END)
  .addEdge('email_agent_node',   END)
  .compile();

const runAgentGraph = async (state) => agentGraph.invoke(state);

module.exports = { runAgentGraph, runMilestoneOneGraph: runAgentGraph };
