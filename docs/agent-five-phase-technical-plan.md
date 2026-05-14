# Karya AI Agent: Five Phase Plan

This document explains how the Karya AI agent should work at a high level.

The goal is to build Multi agent system that helps users move from onboarding to project selection and expert matching.

For the first version, we will keep the system simple:

```text
Next.js Agent UI
  -> Node.js backend API
    -> LangGraph.js workflow
      -> MongoDB / Mongoose data
      -> Anthropic model
      -> Karya platform tools
```

## Simple Definitions

### Agent

In our system, an agent is a LangGraph node.

Each node has one clear job.

Examples:

```text
memory_agent_node      -> collects and updates user data
orchestrator_node      -> replies to the user and decides the next step
diagnostic_agent_node  -> finds sales and marketing gaps
planner_agent_node     -> creates the 30-60-90 day plan
router_agent_node      -> matches a project to an expert
human_gate_node        -> waits for approval
```

### State

State is the object passed between LangGraph nodes during a conversation.

It contains the current working data for the agent.

Example:

```js
{
  userId,
  conversationId,
  userType,
  phase,
  messages,
  businessProfile,
  expertProfile,
  goal,
  gapScores,
  plan,
  selectedProject,
  matchedExpert,
  activeGate, // current approval step, if any
  nextAction
}
```

### KB

KB means Knowledge Base.

For our first version, KB means structured data stored in MongoDB/Mongoose and loaded into LangGraph state.

There are two types of KB:

```text
User KB:
Data about a specific user, business, or expert.

Platform KB:
Karya platform knowledge such as projects, sales and marketing playbooks, FAQs, rules, and expert matching logic.
```

For now, we do not need a separate long-term memory system.

We can use:

```text
MongoDB / Mongoose = saved data
LangGraph state = temporary working data during a chat turn
```

### Memory

Memory means data the agent remembers across sessions.

For the first version, this can simply come from MongoDB collections like:

```text
User
BusinessProfile
ExpertProfile
Conversation
Project
ExpertProfile
```

## Core Architecture

We will build one LangGraph.js workflow inside the existing Node.js backend.

The frontend will not run the agent.

The frontend will only:

```text
1. Show the chat UI.
2. Send user messages to backend.
3. Render agent responses.
4. Show approval UI when needed.
```

The backend will:

```text
1. Load user data from MongoDB.
2. Build the LangGraph state.
3. Run the graph.
4. Save updated data back to MongoDB.
5. Return the response to the frontend.
```

High-level graph:

```text
START
  -> memory_agent_node
  -> orchestrator_node
  -> route by nextAction
      -> diagnostic_agent_node
      -> planner_agent_node
      -> router_agent_node
      -> human_gate_node
      -> END
```

Nodes do not call each other directly.

Each node reads the shared state and writes its own updates.

The graph router decides which node runs next.

## Main Routing Field

The main field for routing should be `nextAction`.

```js
nextAction:
  | "ask_field"
  | "define_goal"
  | "run_diagnostic"
  | "run_planner"
  | "run_router"
  | "await_human"
  | "respond"
```

Simple routing logic:

```text
If profile is incomplete:
  ask the next onboarding question

If profile is complete enough but goal is missing:
  define the goal

If goal is confirmed:
  run diagnostic

If diagnostic is ready:
  create plan

If user selects a project:
  match expert

If approval is needed:
  wait for human decision
```

## Phase 1: Knowledge Base and Onboarding

### Purpose

The agent collects important information about the user.

Before collecting business or expert details, the system must first have basic identity data.

Minimum identity data:

```text
name
email
phone number
password
user type: business user or expert user
```

This is needed so the backend can create or update the correct database records.

Because the agent page is public, the user must be able to create an account during onboarding.

Password must be handled carefully:

```text
The password should be entered in a secure password input.
The password should go directly to the backend auth API.
The password should not be sent to the AI model.
The password should not be stored in conversation messages.
The backend should hash the password before saving the user.
```

This phase supports two user types:

```text
Business user
Expert user
```

For a business user, the agent collects:

```text
company name
website
industry
target customer
current sales and marketing channels
budget
constraints
desired outcome
```

For an expert user, the agent collects:

```text
skills
industries served
project experience
availability
capacity
preferred project types
portfolio or proof
```

### Main Nodes

```text
memory_agent_node
orchestrator_node
```

### What memory_agent_node Does

This node reads the latest user message and extracts useful fields.

It should first make sure the minimum identity data exists.

If identity data is missing, it should collect that before saving business or expert profile details.

Example:

User says:

```text
We are a B2B SaaS company selling to HR teams in the US.
```

The node can update:

```js
{
  industry: "B2B SaaS",
  targetCustomer: "HR teams",
  geography: "US"
}
```

It should then save the updated profile to MongoDB.

### What orchestrator_node Does

This node talks to the user.

It decides the next best question.

It should ask only one main question at a time.

Example:

```text
Thanks. What is the main outcome you want to achieve in the next 90 days?
```

### Phase 1 Routing

```text
If name, email, or phone number is missing:
  ask for the missing identity field

If password is missing:
  show a secure password input and send it directly to the backend auth API

If user type is missing:
  ask if they are a business user or expert user

If business profile is incomplete:
  ask the next business onboarding question

If expert profile is incomplete:
  ask the next expert onboarding question

If enough information is collected:
  move to Phase 2
```

### Data Saved

```text
User
BusinessProfile
ExpertProfile
Conversation
```

Recommended database flow:

```text
1. Create or find User by email or authenticated user ID.
2. Save name, email, phone number, hashed password, and user type.
3. If user type is business user, create or update BusinessProfile.
4. If user type is expert user, create or update ExpertProfile.
5. Save conversation messages against the user and conversation.
```

## Phase 2: Goal Definition

### Purpose

The agent helps the user define a clear goal.

For business users, the goal should usually be a 30, 60, or 90 day business outcome.

Examples:

```text
Book 20 qualified demos in 90 days.
Improve outbound reply rate from 2 percent to 6 percent.
Build a predictable founder-led sales process.
```

For expert users, the goal may be about matching preferences.

Examples:

```text
Get matched with outbound strategy projects.
Work with B2B SaaS companies for 10 hours per week.
```

### Main Node

```text
orchestrator_node
```

### What orchestrator_node Does

The node checks whether the user has a clear goal.

If the goal is unclear, it asks one follow-up question.

If the goal is clear, it asks the user to confirm it.

Example goal object:

```js
{
  type: "pipeline",
  description: "Book 20 qualified demos in 90 days",
  timeframeDays: 90,
  targetMetric: "20 qualified demos",
  confirmed: true
}
```

### Phase 2 Routing

```text
If profile is still incomplete:
  return to Phase 1

If goal is missing:
  ask for the desired outcome

If goal is unclear:
  ask one follow-up question

If goal is confirmed:
  move to Phase 3
```

### Data Saved

```text
Goal details
Goal confirmation status
Conversation history
```

## Phase 3: Gap Diagnostic

### Purpose

The agent checks where the business has gaps.

For business users, it can score these sales and marketing areas:

```text
Awareness
Discovery
Connect
Qualify
Convert
Retain
```

This phase helps the user understand what is weak, what is working, and where Karya can help.

For expert users, this phase may be different. Instead of sales and marketing scoring, we may check profile quality and matching readiness.

### Main Nodes

```text
diagnostic_agent_node
orchestrator_node
```

### What diagnostic_agent_node Does

This node reads:

```text
business profile
confirmed goal
conversation history
platform knowledge, if available
```

It produces a structured diagnosis.

Example:

```js
{
  awareness: { score: 5, signals: ["content exists but not consistent"] },
  discovery: { score: 4, signals: ["website has weak conversion path"] },
  connect: { score: 3, signals: ["no clear outbound system"] },
  qualify: { score: 6, signals: ["basic qualification process exists"] },
  convert: { score: 5, signals: ["case studies are missing"] },
  retain: { score: 4, signals: ["no clear referral motion"] },
  overallScore: 4.5
}
```

### What orchestrator_node Does

It explains the diagnosis to the user in simple language.

It should focus on the biggest gaps.

It should not overload the user with too many details.

### Phase 3 Routing

```text
If goal is not confirmed:
  return to Phase 2

If diagnostic already exists for the same goal:
  reuse it

If diagnostic is missing:
  run diagnostic_agent_node

After diagnostic is ready:
  move to Phase 4
```

### Data Saved

```text
Gap scores
Gap signals
Diagnostic result
Goal linked to diagnostic
```

## Phase 4: Plan Generation

### Purpose

The agent turns the diagnosis into a 30-60-90 day action plan.

The plan should recommend Karya projects that can help the user reach their goal.

The plan should include:

```text
recommended projects
why each project matters
expected output
30, 60, or 90 day timing
3 KPIs
```

### Main Nodes

```text
planner_agent_node
orchestrator_node
```

### What planner_agent_node Does

This node reads:

```text
business profile
confirmed goal
gap diagnostic
project catalogue
budget or constraints
```

It creates a plan.

Example:

```js
{
  planId: "plan_123",
  diagnosis: "The biggest issue is weak outbound foundation.",
  projects: [
    {
      slug: "contact-intelligence",
      title: "Contact Intelligence",
      phase: "30 days",
      priority: 1,
      rationale: "The user needs a better target account and contact base."
    },
    {
      slug: "email-engine",
      title: "Email Engine",
      phase: "60 days",
      priority: 2,
      rationale: "The user needs a repeatable outbound email motion."
    }
  ],
  kpis: [
    { name: "qualified demos", target: "20 in 90 days" },
    { name: "reply rate", target: "6 percent" },
    { name: "lead quality", target: "sales team rates leads above 7/10" }
  ]
}
```

### What orchestrator_node Does

It presents the plan to the user.

It explains why the projects were selected.

It asks the user which project they want to start with.

### Phase 4 Routing

```text
If diagnostic is missing:
  return to Phase 3

If plan already exists for the current diagnostic:
  reuse it

If plan is missing:
  run planner_agent_node

If user changes the goal:
  clear old diagnostic and plan

If user selects a project:
  move to Phase 5
```

### Data Saved

```text
Plan
Recommended projects
KPIs
Selected project, when user chooses one
```

## Phase 5: Project Selection and Expert Match

### Purpose

The agent moves the user from advice to execution.

When the user selects a project, the system matches that project with the best available expert.

Before anything is confirmed, the system should ask for human approval.

This is important because project and expert matching affects real users and experts.

### Main Nodes

```text
router_agent_node
human_gate_node
orchestrator_node
```

### What router_agent_node Does

This node reads:

```text
selected project
business profile
plan KPIs
expert profiles
expert availability
expert capacity
```

It then:

```text
filters experts
scores matching experts
selects the best expert
creates a project brief
creates an approval gate
```

The first version should keep matching mostly rule-based.

Example matching logic:

```text
Only consider experts who are active and available.
Only consider experts who have capacity.
Score experts by skill match and segment match.
Pick the highest scoring expert.
```

### What human_gate_node Does

This node handles approval.

It should support:

```text
approved
rejected
escalated
```

If approved, the project can move forward.

If rejected, the system should find another expert or return to planning.

If escalated, an admin should handle it manually.

### What orchestrator_node Does

It tells the user what happened.

Examples:

```text
Your project has been approved and the expert match is ready.
```

```text
This match needs review. Our team will handle it manually.
```

### Phase 5 Routing

```text
If no project is selected:
  stay in Phase 4

If project is selected:
  run router_agent_node

If expert is matched:
  create activeGate with status "pending"

activeGate means there is an approval step waiting for a user, expert, or admin.

If gate is pending:
  frontend shows approval UI

If gate is approved:
  confirm project activation

If gate is rejected:
  match another expert or return to plan

If gate is escalated:
  stop automated flow and notify admin
```

### Data Saved

```text
Selected project
Matched expert
Project brief
Approval gate
Gate history
Assignment status
```

## Backend API Plan

The backend should expose simple agent APIs.

```text
POST /api/agent/chat
GET  /api/agent/thread/:conversationId/state
POST /api/agent/gate/respond
```

### POST /api/agent/chat

Used when the user sends a chat message.

Request:

```js
{
  conversationId,
  message
}
```

Backend flow:

```text
1. Check if the user is already logged in.
2. If not logged in, collect basic signup data first.
3. Send password only through a secure password input to the backend auth API.
4. Create or find the User record.
5. Load conversation and profile from MongoDB.
6. Build LangGraph state.
7. Run the graph.
8. Save updated profile and messages.
9. Return assistant response.
```

### GET /api/agent/thread/:conversationId/state

Used when the frontend needs current agent state.

This is useful for showing:

```text
current phase
profile progress
active approval gate
selected project
matched expert
```

### POST /api/agent/gate/respond

Used when a user, expert, or admin approves or rejects an action.

Request:

```js
{
  conversationId,
  gateId,
  action: "approved" | "rejected" | "escalated",
  notes
}
```

## Frontend Plan

The existing page should stay as the main agent UI:

```text
karya-ai-frontend/src/app/agent/page.jsx
```

For the first version, the frontend should:

```text
show chat messages
send user messages to backend
show secure password input during public signup
show loading state
render markdown response
show approval UI if activeGate exists
```

## Environment Variables

For the first version, use one Anthropic model for all nodes that need the model.

LangGraph does not need a model API key by itself.

The model provider needs the API key.

For our current backend, that provider is Anthropic.

### Required for First Version

```env
# App runtime
NODE_ENV=development
PORT=5000
FRONTEND_URL=http://localhost:3000

# Database
MONGODB_URI=mongodb+srv://...

# Authentication
JWT_SECRET=...
JWT_EXPIRE=7d
JWT_COOKIE_EXPIRE=7

# Anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_API_VERSION=2023-06-01
ANTHROPIC_MODEL=claude-...
ANTHROPIC_MAX_TOKENS=1200
ANTHROPIC_TIMEOUT_MS=30000
ANTHROPIC_MAX_RETRIES=2
```

Important notes:

```text
Use one ANTHROPIC_MODEL for the first version.
Use the same model across all agent nodes.
Temperature configuration is not used.
Newer Anthropic models do not support custom temperature values.
Control behavior using prompts, structured output, and validation.
```

### Azure App Service Settings

In Azure App Service, set environment variables as Application Settings.

Do not commit secrets to GitHub.

Minimum production settings:

```text
NODE_ENV
PORT
FRONTEND_URL
MONGODB_URI
JWT_SECRET
ANTHROPIC_API_KEY
ANTHROPIC_API_VERSION
ANTHROPIC_MODEL
ANTHROPIC_MAX_TOKENS
ANTHROPIC_TIMEOUT_MS
ANTHROPIC_MAX_RETRIES
```

## First Build Scope

Do not build all five phases at once.

Build the system step by step.

### Milestone 1

```text
Agent API endpoint
LangGraph.js setup
Shared state object
memory_agent_node
orchestrator_node
MongoDB save/load
Business and expert onboarding
```

### Milestone 2

```text
Goal definition
nextAction routing
Phase changes
Goal save/load
```

### Milestone 3

```text
diagnostic_agent_node
Gap scores
Diagnostic save/load
Simple markdown diagnosis
```

### Milestone 4

```text
planner_agent_node
Project catalogue search
30-60-90 day plan
Plan save/load
```

### Milestone 5

```text
router_agent_node
Expert matching
activeGate
Approval endpoint
Frontend approval UI
```

## Final First Version Decision

For the first version:

```text
Use LangGraph.js inside the Node.js backend.
Use the existing Next.js page as the UI.
Use MongoDB/Mongoose as the saved data layer.
Use LangGraph state as the temporary working data object.
Use one Anthropic model for all nodes that need the model.
Treat agents as LangGraph nodes.
Use MongoDB/Mongoose for saved user and profile data.
Use the same model across all agent nodes.
Temperature configuration is not used.
Add human approval before expert/project commitment.
```
