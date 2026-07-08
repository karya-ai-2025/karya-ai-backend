const { extractMessageContext } = require('../../anthropicService');
const { describeForClaude, getById } = require('../capabilityRegistry');

const getLatestUserMessage = (messages = []) => {
  const latest = [...messages].reverse().find((m) => m.role === 'user');
  return latest?.content || '';
};

// ── Regex fallback — only fires when Claude call fails completely ─────────────

const ruleFallbackInterrupt = (message) => {
  if (/\b(change|revise|edit|new|different)\b.*\bgoal\b|\bgoal\b.*\b(change|revise|edit|different)\b/.test(message)) {
    return 'change_goal';
  }
  if (/\b(website|url|link)\b.*\b(review|plan|business|diagnostic)\b|\b(diagnostic|review|plan)\b.*\b(website|url|link)\b/.test(message)) {
    return 'add_diagnostic_evidence';
  }
  if (/\b(rerun|run again|redo|restart)\b.*\b(diagnostic|review|plan)\b/.test(message)) {
    return 'rerun_diagnostic';
  }
  if (/\b(regenerate|rebuild|redo|update)\b.*\b(plan|30-60-90)\b/.test(message)) {
    return 'regenerate_plan';
  }
  return null;
};

const ruleFallbackCapability = (message) => {
  if (/\b(find|get|show|looking for|need|want)\b.{0,40}\b(leads?|contacts?|people|vcs?|ctos?|decision makers?|buyers?|prospects?)\b/.test(message)) {
    return 'leads';
  }
  if (/\b(which|what|recommend|suggest|find|need|want)\b.*\b(project|service|tool|solution)\b/.test(message)) {
    return 'project_match';
  }
  if (/\b(create|build|generate|make)\b.*\b(plan|roadmap|strategy|30-60-90)\b/.test(message)) {
    return 'growth_plan';
  }
  return null;
};

// ── Apply the result of Claude (or fallback) to state ────────────────────────

const resetDownstream = (state, reason) => ({
  ...state,
  gapScores: null,
  businessReview: null,
  plan: null,
  selectedProject: null,
  matchedExpert: null,
  activeGate: null,
  memorySummary: null,
  resetReason: reason
});

const applyInterrupt = (state, interruptType, reason) => {
  if (interruptType === 'change_goal') {
    return {
      ...resetDownstream(state, reason),
      goal: null,
      phase: 'goal_definition',
      nextAction: 'define_goal',
      missingField: 'goal.description',
      uiRequest: null
    };
  }

  if (interruptType === 'add_diagnostic_evidence' || interruptType === 'rerun_diagnostic') {
    return {
      ...resetDownstream(state, reason),
      phase: 'diagnostic_intake',
      nextAction: 'collect_evidence',
      missingField: null,
      uiRequest: null,
      businessEvidence: {
        ...(state.businessEvidence || {}),
        websites: state.businessEvidence?.websites || [],
        intakeStatus: 'open',
        reviewStatus: 'not_ready',
        canRunBasic: true
      }
    };
  }

  if (interruptType === 'regenerate_plan') {
    return {
      ...state,
      plan: null,
      phase: state.gapScores ? 'gap_diagnostic' : 'diagnostic_intake',
      nextAction: state.gapScores ? 'run_planner' : 'collect_evidence',
      missingField: null,
      uiRequest: null,
      resetReason: reason
    };
  }

  return null;
};

const intentRouterNode = async (state) => {
  const latestMessage = getLatestUserMessage(state.messages);
  let interruptType = null;
  let matchedCapabilityId = null;
  let extractedFields = {};
  let unmetNeed = null;

  // ── Primary: one Claude call handles everything ───────────────────────────
  try {
    const result = await extractMessageContext({
      state,
      capabilitiesDescription: describeForClaude()
    });

    if (result) {
      interruptType       = result.interruptType       || null;
      matchedCapabilityId = result.matchedCapabilityId || null;
      extractedFields     = result.extractedFields     || {};
      unmetNeed           = result.unmetNeed           || null;

      // Low confidence capability match → treat as no match
      if (result.confidence < 0.65) matchedCapabilityId = null;
    }
  } catch {
    // Fall through to regex
  }

  // ── Fallback: regex when Claude failed ───────────────────────────────────
  if (!interruptType && !matchedCapabilityId) {
    console.log('[intentRouter] Claude gave no match — falling back to regex');
    interruptType       = ruleFallbackInterrupt(latestMessage.toLowerCase());
    matchedCapabilityId = ruleFallbackCapability(latestMessage.toLowerCase());
    console.log('[intentRouter] Regex result:', { interruptType, matchedCapabilityId });
  } else {
    console.log('[intentRouter] Claude matched:', { interruptType, matchedCapabilityId, extractedFields });
  }

  // ── Apply interrupt if detected ──────────────────────────────────────────
  if (interruptType) {
    const interrupted = applyInterrupt(state, interruptType, `Interrupt: ${interruptType}`);
    if (interrupted) {
      return {
        ...interrupted,
        extractedContext:   extractedFields,
        matchedCapability:  null,
        unmetNeed:          null
      };
    }
  }

  // ── Apply matched capability ─────────────────────────────────────────────
  if (matchedCapabilityId) {
    const capability = getById(matchedCapabilityId);

    if (capability) {
      // Pick only the fields this capability cares about (from THIS message)
      const capabilityFields = {};
      capability.fields.forEach((f) => {
        if (extractedFields[f] !== undefined && extractedFields[f] !== null) {
          capabilityFields[f] = extractedFields[f];
        }
      });

      // Merge onto the existing filter so refinements accumulate instead of
      // wiping it. "decision makers" keeps the earlier industry/location/segment
      // and just adds seniority; re-stating a field (e.g. a new location)
      // overwrites only that one dimension.
      const previousFilter = capability.stateKey ? (state[capability.stateKey] || {}) : {};
      const mergedFields = { ...previousFilter, ...capabilityFields };

      return {
        phase:             matchedCapabilityId,
        nextAction:        capability.nextAction,
        missingField:      null,
        uiRequest:         null,
        extractedContext:  extractedFields,    // full extraction for memoryAgentNode
        matchedCapability: { id: matchedCapabilityId, fields: mergedFields },
        // Write to the capability's state key if defined (e.g. leadsFilter)
        ...(capability.stateKey ? { [capability.stateKey]: mergedFields } : {}),
        // Record what THIS turn added, so the specialist can tell a real
        // refinement from an empty "refine further" click (avoids re-running
        // the identical query). Only meaningful for the leads filter.
        leadsFilterDelta:  capability.stateKey === 'leadsFilter' ? capabilityFields : null,
        unmetNeed:         null,
        resetReason:       null
      };
    }
  }

  // ── Unmet need — we don't have a capability for this yet ─────────────────
  if (unmetNeed) {
    return {
      extractedContext:  extractedFields,
      matchedCapability: null,
      unmetNeed,
      resetReason:       null
    };
  }

  // ── Default: normal conversation turn, just pass extracted fields along ──
  return {
    extractedContext:  extractedFields,
    matchedCapability: null,
    unmetNeed:         null,
    resetReason:       null
  };
};

module.exports = { intentRouterNode };
