// services/linkedinPortabilityService.js
// LinkedIn Member Data Portability API (3rd Party) — Member Snapshot API client
// and the mapping from LinkedIn's snapshot rows onto an ExpertProfile.
//
// Docs: https://learn.microsoft.com/en-us/linkedin/dma/member-data-portability/shared/member-snapshot-api
// LinkedIn only lets members located in the European Economic Area grant this
// permission; everyone else is turned away on LinkedIn's consent screen.

const { config } = require('../config/config');

const AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const SNAPSHOT_URL = 'https://api.linkedin.com/rest/memberSnapshotData';
const SCOPE = 'r_dma_portability_3rd_party';
// The snapshot endpoint only accepts this version; any other value returns 426.
const API_VERSION = '202312';
const MAX_PAGES_PER_DOMAIN = 25;

const isConfigured = () =>
  !!(config.linkedinPortability.clientId && config.linkedinPortability.clientSecret);

const buildAuthorizeUrl = (state) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.linkedinPortability.clientId,
    redirect_uri: config.linkedinPortability.redirectUri,
    state,
    scope: SCOPE
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
};

const exchangeCodeForAccessToken = async (code) => {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.linkedinPortability.clientId,
      client_secret: config.linkedinPortability.clientSecret,
      redirect_uri: config.linkedinPortability.redirectUri
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(`LinkedIn token exchange failed (${response.status}): ${data.error_description || data.error || 'unknown error'}`);
  }
  return data.access_token;
};

/**
 * Fetch every page of one snapshot domain.
 * LinkedIn's `paging.total` is unreliable, so we keep requesting pages until it
 * answers 404 ("No data found for this memberId") or returns an empty page.
 * @returns {Promise<Object[]>} snapshotData rows (empty when the member has none)
 */
const fetchDomain = async (accessToken, domain) => {
  const rows = [];

  for (let start = 0; start < MAX_PAGES_PER_DOMAIN; start += 1) {
    const params = new URLSearchParams({ q: 'criteria', domain, start: String(start) });
    const response = await fetch(`${SNAPSHOT_URL}?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'LinkedIn-Version': API_VERSION,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 404) break;

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`${response.status} ${data.message || data.code || 'request failed'}`);
    }

    const page = (data.elements || []).flatMap((el) => el.snapshotData || []);
    if (page.length === 0) break;
    rows.push(...page);

    const hasNext = (data.paging?.links || []).some((link) => link.rel === 'next');
    if (!hasNext) break;
  }

  return rows;
};

/**
 * Fetch the configured domains. One failing domain doesn't sink the import.
 * @returns {Promise<{ domains: Object, counts: Object, failedDomains: Array }>}
 */
const fetchSnapshot = async (accessToken, domainList = config.linkedinPortability.domains) => {
  const domains = {};
  const counts = {};
  const failedDomains = [];

  // Sequential on purpose — LinkedIn throttles per member and app
  for (const domain of domainList) {
    try {
      const rows = await fetchDomain(accessToken, domain);
      domains[domain] = rows;
      counts[domain] = rows.length;
    } catch (err) {
      failedDomains.push({ domain, reason: err.message });
    }
  }

  return { domains, counts, failedDomains };
};

// ============================================
// MAPPING: snapshot rows → ExpertProfile
// ============================================

// Snapshot keys are human labels ("Company Name", "Started On"); match them
// loosely so a casing or spacing change on LinkedIn's side doesn't drop data.
const normalizeKey = (key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '');

const pick = (row, ...labels) => {
  const byKey = {};
  Object.keys(row || {}).forEach((key) => { byKey[normalizeKey(key)] = row[key]; });
  for (const label of labels) {
    const value = byKey[normalizeKey(label)];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
};

// LinkedIn dates arrive as "Jan 2020", "2020", "2020-01-15" or "15 Jan 2020"
const parseDate = (value) => {
  if (!value) return undefined;
  const text = String(value).trim();
  if (/^\d{4}$/.test(text)) return new Date(Date.UTC(Number(text), 0, 1));
  const parsed = new Date(/^[A-Za-z]{3,9} \d{4}$/.test(text) ? `1 ${text} UTC` : text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const parseYear = (value) => {
  const match = String(value || '').match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
};

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

// Bio is capped at 300 words / 2500 characters on the schema
const fitBio = (text) => truncate(text.split(/\s+/).slice(0, 300).join(' '), 2500);

const sameText = (a, b) => normalizeKey(a || '') === normalizeKey(b || '');

const mapPosition = (row) => {
  const endDate = parseDate(pick(row, 'Finished On', 'End Date'));
  return {
    title: pick(row, 'Title'),
    company: pick(row, 'Company Name', 'Company'),
    description: truncate(pick(row, 'Description'), 500),
    startDate: parseDate(pick(row, 'Started On', 'Start Date')),
    endDate,
    isCurrent: !endDate
  };
};

const mapEducation = (row) => {
  const degree = pick(row, 'Degree Name', 'Degree');
  return {
    institution: pick(row, 'School Name', 'School'),
    degree,
    field: pick(row, 'Field Of Study'),
    yearFrom: parseYear(pick(row, 'Start Date', 'Started On')),
    yearTo: parseYear(pick(row, 'End Date', 'Finished On'))
  };
};

const mapCertification = (row) => ({
  name: pick(row, 'Name'),
  issuer: pick(row, 'Authority', 'Issuer'),
  issueDate: parseDate(pick(row, 'Started On', 'Start Date')),
  expiryDate: parseDate(pick(row, 'Finished On', 'End Date')),
  credentialUrl: pick(row, 'Url', 'URL')
});

/**
 * Merge an import into an ExpertProfile document (not saved here).
 * Never overwrites what the expert typed: text fields are filled only when
 * empty, and list entries are added only when not already present.
 * @returns {{ experience: number, education: number, certifications: number, skills: number, fields: string[] }}
 */
const applySnapshotToProfile = (profile, domains) => {
  const applied = { experience: 0, education: 0, certifications: 0, skills: 0, fields: [] };

  const profileRow = (domains.PROFILE || [])[0];
  if (profileRow) {
    const headline = pick(profileRow, 'Headline');
    if (!profile.headline && headline) {
      profile.headline = truncate(headline, 120);
      applied.fields.push('headline');
    }
    const summary = pick(profileRow, 'Summary');
    if (!profile.bio && summary) {
      profile.bio = fitBio(summary);
      applied.fields.push('bio');
    }
    const city = pick(profileRow, 'Geo Location');
    if (!profile.location?.city && city) {
      profile.set('location.city', truncate(city, 120));
      applied.fields.push('location');
    }
  }

  (domains.POSITIONS || []).map(mapPosition).forEach((item) => {
    if (!item.title && !item.company) return;
    const exists = profile.experience.some((e) => sameText(e.title, item.title) && sameText(e.company, item.company));
    if (exists) return;
    profile.experience.push(item);
    applied.experience += 1;
  });

  (domains.EDUCATION || []).map(mapEducation).forEach((item) => {
    if (!item.institution) return;
    const exists = profile.education.some((e) => sameText(e.institution, item.institution) && sameText(e.degree, item.degree));
    if (exists) return;
    profile.education.push(item);
    applied.education += 1;
  });

  (domains.CERTIFICATIONS || []).map(mapCertification).forEach((item) => {
    if (!item.name) return;
    const exists = profile.certifications.some((c) => sameText(c.name, item.name) && sameText(c.issuer, item.issuer));
    if (exists) return;
    profile.certifications.push(item);
    applied.certifications += 1;
  });

  (domains.SKILLS || []).forEach((row) => {
    const name = pick(row, 'Name', 'Skill');
    if (!name || profile.skills.some((s) => sameText(s.name, name))) return;
    profile.skills.push({ name });
    applied.skills += 1;
  });

  // Estimate years of experience from the earliest role when the expert hasn't said
  if (profile.yearsOfExperience == null) {
    const starts = profile.experience.map((e) => e.startDate).filter(Boolean).map((d) => d.getTime());
    if (starts.length > 0) {
      const years = Math.floor((Date.now() - Math.min(...starts)) / (365.25 * 24 * 60 * 60 * 1000));
      profile.yearsOfExperience = Math.max(0, Math.min(50, years));
      applied.fields.push('yearsOfExperience');
    }
  }

  return applied;
};

module.exports = {
  SCOPE,
  isConfigured,
  buildAuthorizeUrl,
  exchangeCodeForAccessToken,
  fetchDomain,
  fetchSnapshot,
  applySnapshotToProfile
};
