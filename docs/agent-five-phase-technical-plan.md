# Karya AI Agent: Five Phase Plan

This document explains how the Karya AI agent works at a high level.

The goal is to move a user through a clear linear path:

```text
create account if needed
collect important business details
confirm goal
review business context from website
show areas where Karya AI can help
ask user to generate the final plan
create 30-60-90 day growth plan
recommend the first marketplace project to pick
generate a modern PPT
answer direct service or project recommendation requests
later: match expert and ask for human approval
```

The first version uses:

```text
Next.js Agent UI
  -> Node.js backend API
    -> LangGraph.js workflow
      -> MongoDB / Mongoose data
      -> Anthropic Claude model
      -> ProjectCatalog marketplace data
      -> AgentProjectRecommendation recommendation history
```

## Returning User Memory

The agent stores a compact memory summary in:

```text
Conversation.agentState.memorySummary
```

This summary captures:

```text
what profile details were collected
whether the goal was confirmed
whether website context was reviewed
areas where Karya AI can help
whether the 30-60-90 plan was generated
the first recommended project
whether a PPT exists
the next suggested action
```

When a user opens the same conversation later, the frontend can show a welcome-back message from `memorySummary.welcomeBackMessage`.

The full chat history remains stored in `Conversation.messages`, but the memory summary gives the agent a quick understanding of what was already covered.

## Nodes

In this system, an agent is a LangGraph node.

```text
intent_router_node       -> detects interruptions and restarts the right phase
memory_agent_node        -> extracts identity, profile, goal, and website URL data
orchestrator_node        -> asks the next question and controls the linear path
diagnostic_planner_node  -> internal name; manages website intake and website summary confirmation
diagnostic_agent_node    -> internal name; scores business gaps, maps weakest areas to ProjectCatalog subjects, and stores project recommendations
planner_agent_node       -> creates the 30-60-90 plan using deterministic gap-based marketplace recommendations
router_agent_node        -> future expert matching
human_gate_node          -> future human approval
```

Internal node names still use older names in code to avoid graph churn. The UI should not show the word "diagnostic"; it should say "business review", "website summary", and "growth plan".

The intent router also supports quick marketplace requests. If the user directly asks for a project, service, tool, or solution for a specific outcome, it routes to `find_marketplace_project`.

## State

State is passed between LangGraph nodes during a conversation.

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
  businessEvidence,
  gapScores,
  businessReview,
  plan,
  marketplaceProjectMatches,
  businessReview.recommendedProjects,
  memorySummary,
  selectedProject,
  matchedExpert,
  activeGate,
  interruptIntent,
  resetReason,
  nextAction
}
```

## Linear Flow

```text
1. If the user is not logged in, collect identity and show secure password signup.
2. Ask whether the user is a business user or expert user.
3. For business users, collect important business profile fields.
4. Ask for the business goal.
5. Confirm the goal.
6. Ask whether the user wants to share a website URL.
7. Crawl and summarize the website if provided.
8. Show the website summary and ask for confirmation or edits.
9. Sort the lowest individual gap scores and match projects through `ProjectCatalog.subjects`.
10. Ask the user to click Generate Plan.
11. Create the 30-60-90 day plan only after that click.
12. Reuse the stored gap-based recommendations and mark the first project to pick.
13. Generate a PPT for the business user with scores, gap areas, matched subjects, and projects.
```

## Business Profile Fields

For business users, the minimum fields required before goal planning are:

```text
company name
website
industry
target customer
```

The agent may also collect optional planning context when the user provides it:

```text
current sales and marketing channels
budget
constraints
desired outcome
```

These are saved to `BusinessProfile` and mirrored into LangGraph state.

## Goal Definition

The goal should be specific enough to plan against.

Examples:

```text
Book 20 qualified demos in 90 days.
Improve outbound reply rate from 2 percent to 6 percent.
Build a predictable founder-led sales process.
```

Goal details are saved in:

```text
Conversation.agentState.goal
BusinessProfile.marketingActivities.goalsObjectives
```

The frontend renders `uiRequest.type = "goal_confirmation"` as a goal review card.

## Website Business Review

After the goal is confirmed, the agent asks for an optional website URL.

The user can:

```text
share one or more public website URLs
skip the website URL
create the growth plan from profile + goal only
```

There is no document upload in this flow.

There is no Azure Blob Storage or Azure Document Intelligence dependency for this agent flow.

## Website Crawling

Website crawling is done by backend code, not by Claude.

Backend flow:

```text
1. Normalize the URL.
2. Reject private or local URLs.
3. Fetch the homepage with server-side fetch.
4. Find useful internal links.
5. Prefer pages like about, services, solutions, pricing, case studies, and contact.
6. Fetch those pages.
7. Strip scripts, styles, and HTML.
8. Keep readable text.
9. Send extracted text to Claude for a business summary and signals.
10. Save URL, extracted text, summary, signals, and crawl metadata to AgentEvidence.
```

Claude only summarizes extracted website text. Claude does not crawl the website.

## Website Summary Confirmation

After crawling, the user sees what the agent understood.

The user can:

```text
confirm the website summary and continue to help areas
edit the summary
share another website
create the plan without more website context
```

After confirmation, the agent does not immediately generate the full 30-60-90 plan.

It first shows:

```text
areas where Karya AI can help
why each area matters
which marketplace project can help with each area
```

Then the UI shows `Generate Plan`.

## Gap Review

The internal gap node scores:

```text
Awareness
Discovery
Connect
Qualify
Convert
Retain
```

The score is used to create the plan. User-facing copy should call this a business review or gap review.

Project recommendations do not use `overallScore` as the main decision point. The backend sorts the individual area scores from lowest to highest. Lower score means bigger gap:

```text
connect: 2
retain: 3
qualify: 4
discovery: 6
convert: 7
awareness: 8
```

In this example, the recommendation priorities are `connect`, `retain`, and `qualify`.

Each gap area has a deterministic subject-keyword map:

```text
awareness -> Brand Positioning, Content Strategy, Market Visibility, Social Proof, Website Messaging
discovery -> Lead Generation, ICP Strategy, Data Research, Market Research, Customer Research
connect   -> Cold Outreach, Cold Email, Email Campaigns, Prospecting, Outbound
qualify   -> Lead Qualification, ICP Research, CRM Workflow, Sales Qualification
convert   -> Landing Page Optimization, Conversion Optimization, Sales Assets, Case Studies
retain    -> Customer Retention, CRM Follow Up, Nurture Campaigns, Relationship Management
```

The backend searches those mapped values against `ProjectCatalog.subjects`, ranks subject matches with business goal and marketplace signals, and returns at least three recommendations when catalog inventory allows.

Each recommendation is persisted to `agent_project_recommendations` with:

```text
userId
conversationId
businessGoal
requirementSummary
gapArea
gapScore
searchedSubjects
matchedSubjects
recommended project id / slug / title
priority
matchScore
reason
gapSnapshot
recommendationRunId
```

## 30-60-90 Day Plan

The planner creates:

```text
plan summary
top gaps
30 day actions and outputs
60 day actions and outputs
90 day actions and outputs
3 KPIs
recommended marketplace projects
first project to pick
```

The planner loads active published marketplace projects from `ProjectCatalog`.

The deterministic recommendations produced during the gap review are the source of truth for the plan. Claude can still generate the narrative plan, but backend normalization keeps the gap-based project recommendations first.

The backend normalizes recommendations so the final plan points to real marketplace projects:

```js
{
  slug,
  title,
  phase,
  priority,
  gapArea,
  gapScore,
  searchedSubjects,
  matchedSubjects,
  matchScore,
  rationale,
  expectedOutput,
  marketplaceUrl: "/project-marketplace/<slug>"
}
```

The frontend plan card shows recommended projects and highlights priority 1 as "Start here".

Recommended project links open in a new browser tab so the user does not lose the generated plan conversation.

Frontend behavior:

```text
click recommended project
open marketplace URL in new tab
keep current agent plan visible in the original tab
```

## PPT Generation

When the final plan is generated, the backend also creates a PPTX file.

The PPT is generated by backend code in `services/agent/pptxService.js`.

It is dependency-free:

```text
no external PPT library
backend writes the PPTX XML parts
backend zips those parts into a .pptx file
frontend receives base64 and shows Download PPT
```

The PPT includes:

```text
Slide 1: Karya AI x <Company Name>
Slide 2: Business snapshot
Slide 3: Gap score analysis
Slide 4: Areas where Karya AI can help, with gap scores and matched subjects
One slide per recommended project
30-60-90 roadmap slide
Next step slide
```

The PPT should feel like a modern business deck, not a plain text export.

Current slide design:

```text
branded dark cover slide
colored top accent bars
large clean headings
white card-style content blocks
soft shadows
colored project recommendation tags
three-column 30-60-90 roadmap layout
final next-step slide
```

The frontend shows a `Download PPT` button on the plan card.

## Frontend Plan UI

The frontend renders the final plan from `uiRequest.type = "plan_summary"`.

It shows:

```text
plan summary
30-60-90 timeline cards
KPI chips
recommended marketplace projects
Start here label for priority 1
Download PPT button
```

Recommended project cards are clickable links.

```text
href: project.marketplaceUrl or /project-marketplace/<slug>
target: _blank
rel: noopener noreferrer
```

This lets the user inspect or start a marketplace project without losing the chat state.

## Direct Project / Service Matching

The user can ask for a project recommendation before completing the full business profile.

Examples:

```text
I need a service for cold emails.
Which project can help me create campaigns?
What should I use for lead generation?
I want something to improve reply rate.
```

The agent should give useful recommendations immediately, then ask for more context for a specialized recommendation.

Backend behavior:

```text
1. intent_router_node detects find_marketplace_project.
2. orchestrator_node calls ProjectCatalog matching.
3. backend loads active published marketplace projects.
4. matcher scores projects against the user's request.
5. matcher uses title, category, tagline, description, deliverables, subjects, tools, skills, target audience, industries, and success proof.
6. matcher expands common terms, such as cold email -> outbound, outreach, campaign, lead, prospecting, reply.
7. top matches are returned to the frontend.
```

Frontend behavior:

```text
uiRequest.type = "project_match"
show recommended project cards
show why each project matches
show output / KPI signal chips
open project links in a new tab
```

After showing matches, the agent asks the user to provide business type, website, target customer, and goal to get a more specialized recommendation and plan.

## APIs

```text
POST /api/agent/chat
GET  /api/agent/thread/:conversationId/state
GET  /api/agent/thread/:conversationId/evidence
POST /api/agent/evidence/website
POST /api/agent/gate/respond
```

## Environment Variables

Required:

```env
NODE_ENV=development
PORT=5000
FRONTEND_URL=http://localhost:3000
MONGODB_URI=mongodb+srv://...
JWT_SECRET=...
JWT_EXPIRE=7d
JWT_COOKIE_EXPIRE=7
ANTHROPIC_API_KEY=...
ANTHROPIC_API_VERSION=2023-06-01
ANTHROPIC_MODEL=claude-...
ANTHROPIC_MAX_TOKENS=1200
ANTHROPIC_TIMEOUT_MS=30000
ANTHROPIC_MAX_RETRIES=2
```

If `ANTHROPIC_MODEL` is set to a Claude Opus model, every Claude-backed node can use Opus through the shared Anthropic service.

## Current Build Status

Done:

```text
Claude-backed intent router with rule fallback
Goal extraction and confirmation
Website-only business review intake
Backend website crawling
Claude website summary
Website summary confirm/edit flow
AgentEvidence collection for website evidence
Gap scoring from profile, goal, and website context
Deterministic lowest-gap project matching through ProjectCatalog.subjects
AgentProjectRecommendation collection for recommendation history
30-60-90 plan generation with Claude
ProjectCatalog marketplace lookup for planner
Marketplace project recommendations in plan with gap area, gap score, and matched subjects
Direct project/service matching from ProjectCatalog
First recommended project marked as Start here
Business review step before final plan generation
PPTX generation with gap scores, gap areas, matched subjects, recommendations, and final plan
Modern styled PPT slides
Memory summary for returning users
Welcome-back message on reopened conversations
Plan summary UI
Recommended project links open in new tabs
Deterministic fallback review and plan
```

Pending:

```text
expert matching
human approval UI and endpoint
project purchase/start action from agent plan
```
