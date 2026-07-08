const { prisma } = require('../../../utils/prismaClient');
const UserCRM = require('../../../models/UserCRM');
const { hasLeadsAccess, buildBuyCard } = require('../entitlements');
const { saveLeadsToLibrary } = require('../leadsLibraryService');

const getLatestUserMessage = (messages = []) => {
  const m = [...messages].reverse().find((x) => x.role === 'user');
  return (m?.content || '').trim();
};

// Resolve region name → ISO-2 country array from tbl_regions
const resolveRegion = async (location) => {
  if (!location) return null;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT countries FROM tbl_regions WHERE region_name = LOWER($1)`,
      location.trim()
    );
    return rows[0]?.countries || null;
  } catch { return null; }
};

// Resolve segment name → employee range from tbl_segments
const resolveSegment = async (segment) => {
  if (!segment) return null;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT min_employees, max_employees FROM tbl_segments WHERE segment_name = LOWER($1)`,
      segment.trim()
    );
    return rows[0] || null;
  } catch { return null; }
};

// Resolve seniority name → title keyword patterns from tbl_seniority
const resolveSeniority = async (seniority) => {
  if (!seniority) return null;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT title_keywords FROM tbl_seniority WHERE level_name = LOWER($1)`,
      seniority.trim()
    );
    return rows[0]?.title_keywords || null;
  } catch { return null; }
};

const describeFilter = (filter) => [
  filter.industry  && `industry: ${filter.industry}`,
  filter.location  && `location: ${filter.location}`,
  filter.segment   && `segment: ${filter.segment}`,
  filter.seniority && `seniority: ${filter.seniority}`,
  filter.title     && `title: ${filter.title}`,
  filter.company   && `company: ${filter.company}`
].filter(Boolean).join(', ');

const leadsAgentNode = async (state) => {
  const filter = state.leadsFilter || {};
  const delta = state.leadsFilterDelta || {};
  const userId = state.userId;
  const latest = getLatestUserMessage(state.messages);

  const hasFilter = Object.keys(filter).length > 0;
  const addedThisTurn = Object.keys(delta).length > 0;

  // ── Paid-tier intents: more than the 10-lead preview, or save to library ──
  const numMatch = latest.match(/\b(\d{2,})\b/);
  const requestedCount = numMatch ? parseInt(numMatch[1], 10) : null;
  const wantsSave = /\b(save|library|add to (my )?(crm|list|library)|store these)\b/i.test(latest);
  const wantsBulk = (Boolean(requestedCount) && requestedCount > 10)
    || /\b(more leads|show more|all of them|all leads|full list|entire list|download|export|give me all)\b/i.test(latest);

  // Gate: bulk/save requires the leads project. Free 10-preview is never gated.
  if ((wantsBulk || wantsSave) && hasFilter) {
    const allowed = await hasLeadsAccess(userId);
    if (!allowed) {
      return {
        phase: 'leads_request',
        nextAction: 'respond',
        leadsFilter: filter,
        leadsFilterDelta: null,
        uiRequest: buildBuyCard('leads', wantsSave ? 'save leads to your library' : 'pull the full lead list'),
        response: wantsSave
          ? "Saving leads to your library is part of the **B2B Contact Intelligence Engine** project. Unlock it to save and manage lists — your 10-lead preview stays free."
          : "The preview shows 10 leads for free. To pull the full list, you'll need the **B2B Contact Intelligence Engine** project."
      };
    }
    // allowed → fall through and serve a larger list / save below
  }

  // A refine request with NO new criteria (and not a bulk/save request) →
  // ask what to change instead of re-running the identical query.
  if (hasFilter && !addedThisTurn && !wantsBulk && !wantsSave) {
    return {
      phase: 'leads_request',
      nextAction: 'respond',
      leadsFilter: filter,
      leadsFilterDelta: null,
      uiRequest: null,
      response: `Right now I'm filtering by ${describeFilter(filter)}. What would you like to change or add? You can narrow by location, company size, job title, or seniority — or I can build an email sequence or a 90-day outreach plan for these contacts.`
    };
  }

  // ── Step 1: Resolve all mapping tables + delivered IDs in parallel ──────
  const [regionCountries, empRange, titleKeywords, crmDocs] = await Promise.all([
    resolveRegion(filter.location),
    resolveSegment(filter.segment),
    resolveSeniority(filter.seniority),
    userId
      ? UserCRM.find({ userId }, { leadIds: 1, _id: 0 }).lean()
      : Promise.resolve([])
  ]);

  const deliveredIds = [
    ...new Set(
      crmDocs
        .flatMap((doc) => doc.leadIds || [])
        .map((id) => parseInt(id, 10))
        .filter((n) => Number.isInteger(n) && n > 0)
    )
  ];

  // ── Step 2: Build WHERE clause ─────────────────────────────────────────
  const filterValues  = [];
  const filterClauses = [];

  // Industry — required if provided, otherwise match all
  if (filter.industry) {
    filterClauses.push(`"GTM Industry" ILIKE '%' || $${filterValues.length + 1} || '%'`);
    filterValues.push(filter.industry.trim());
  }

  // Company name — fuzzy
  if (filter.company) {
    filterClauses.push(`"Account Name" ILIKE '%' || $${filterValues.length + 1} || '%'`);
    filterValues.push(filter.company.trim());
  }

  // Location — region expansion OR direct ILIKE
  if (filter.location) {
    if (regionCountries && regionCountries.length > 0) {
      filterClauses.push(`LOWER("Mailing Country") = ANY($${filterValues.length + 1}::text[])`);
      filterValues.push(regionCountries);
    } else {
      filterClauses.push(`"Mailing Country" ILIKE '%' || $${filterValues.length + 1} || '%'`);
      filterValues.push(filter.location.trim());
    }
  }

  // Segment — employee range
  if (empRange) {
    if (empRange.min_employees !== null && empRange.max_employees !== null) {
      filterClauses.push(`employees BETWEEN $${filterValues.length + 1} AND $${filterValues.length + 2}`);
      filterValues.push(empRange.min_employees, empRange.max_employees);
    } else if (empRange.min_employees !== null) {
      filterClauses.push(`employees >= $${filterValues.length + 1}`);
      filterValues.push(empRange.min_employees);
    }
  }

  // Seniority — broad title keyword patterns (from tbl_seniority buckets)
  if (titleKeywords && titleKeywords.length > 0) {
    filterClauses.push(`title ILIKE ANY($${filterValues.length + 1}::text[])`);
    filterValues.push(titleKeywords.map((kw) => `%${kw}%`));
  }

  // Title — specific free-text job title (e.g. "project manager"). Matches the
  // title column directly. Optional: with no title/seniority, all roles show.
  if (filter.title) {
    filterClauses.push(`title ILIKE '%' || $${filterValues.length + 1} || '%'`);
    filterValues.push(filter.title.trim());
  }

  // If no filters at all, we need at least one condition to avoid full-table scan
  if (filterClauses.length === 0) {
    return {
      phase: 'leads_request',
      nextAction: 'respond',
      response: "I need at least one filter to find leads — industry, location, company size, or seniority level. What kind of contacts are you looking for?",
      uiRequest: null
    };
  }

  const filterWhere = filterClauses.join(' AND ');

  // ── Step 3: COUNT total matches ────────────────────────────────────────
  let totalMatched = 0;
  try {
    const countResult = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS count FROM tbl_healthcare WHERE ${filterWhere}`,
      ...filterValues
    );
    totalMatched = Number(countResult[0].count);
  } catch { totalMatched = 0; }

  // ── Step 4: Fetch leads ────────────────────────────────────────────────
  // Preview = 10 (free). Bulk = requested count (capped). Save = up to the cap.
  // We only reach a non-preview limit AFTER the entitlement gate passed above.
  const PREVIEW_LIMIT = 10;
  const MAX_LIMIT = 500;
  const fetchLimit = wantsSave ? MAX_LIMIT
    : wantsBulk ? Math.min(requestedCount || 200, MAX_LIMIT)
    : PREVIEW_LIMIT;

  let leads = [];
  try {
    const selectValues = [...filterValues];
    const excludeIdx  = selectValues.length + 1; selectValues.push(deliveredIds);

    leads = await prisma.$queryRawUnsafe(`
      SELECT
        id, "First Name", "Last Name", title,
        "Account Name", "Mailing Country",
        email, phone, "GTM Industry", employees
      FROM tbl_healthcare
      WHERE ${filterWhere}
        AND id <> ALL($${excludeIdx}::int[])
      ORDER BY id
      LIMIT ${fetchLimit}
    `, ...selectValues);
  } catch { leads = []; }

  // ── Save-to-library branch (entitlement already verified) ───────────────
  if (wantsSave) {
    if (leads.length === 0) {
      return {
        phase: 'leads_request',
        nextAction: 'respond',
        leadsFilter: filter,
        uiRequest: null,
        response: `There are no new contacts matching ${describeFilter(filter)} to save.`
      };
    }
    try {
      const saved = await saveLeadsToLibrary({ userId, filter, leads, name: `Agent — ${describeFilter(filter)}` });
      return {
        phase: 'leads_request',
        nextAction: 'respond',
        leadsFilter: filter,
        uiRequest: { type: 'leads_saved', listName: saved.listName, count: saved.count },
        response: `Saved ${saved.count.toLocaleString()} leads to your library as "${saved.listName}". You can find them under your leads project.`
      };
    } catch (err) {
      return {
        phase: 'leads_request',
        nextAction: 'respond',
        leadsFilter: filter,
        uiRequest: null,
        response: `I couldn't save those to your library: ${err.message}`
      };
    }
  }

  // ── Step 5: Build response ─────────────────────────────────────────────
  const filterSummary = describeFilter(filter);

  const hasLeads = leads.length > 0;

  const response = hasLeads
    ? `I found ${totalMatched.toLocaleString()} contacts matching your criteria (${filterSummary}). Here are the first ${leads.length}.\n\nWould you like me to:\n- Filter further (by location, company size, or title)?\n- Build an email outreach sequence for these contacts?\n- Create a 90-day outreach plan?`
    : `I searched for contacts with ${filterSummary} but found no matches. Try broadening the filters — for example a wider region, different segment, or a different industry.`;

  return {
    phase: 'leads_request',
    nextAction: 'respond',
    leadsFilter: filter,
    uiRequest: hasLeads ? {
      type: 'leads_preview',
      leads,
      totalMatched,
      filterSummary,
      nextActions: [
        { label: 'Get full list', value: 'get_more_leads' },
        { label: 'Save to library', value: 'save_leads' },
        { label: 'Refine filters', value: 'refine_leads' },
        { label: 'Build email sequence', value: 'email_campaign' },
        { label: 'Create outreach plan', value: 'generate_plan' }
      ]
    } : null,
    response
  };
};

module.exports = { leadsAgentNode };
