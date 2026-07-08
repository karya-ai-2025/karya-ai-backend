/**
 * Save a set of leads into the user's library — reuses the existing UserCRM
 * model (the same "CRM objects" the HotLead project exports to). No new store.
 */

const UserCRM = require('../../models/UserCRM');

// tbl_healthcare row → UserCRM.leads sub-doc
const toCrmLead = (row) => ({
  leadId: String(row.id),
  firstName: row['First Name'] || '',
  lastName: row['Last Name'] || '',
  fullName: [row['First Name'], row['Last Name']].filter(Boolean).join(' '),
  title: row.title || '',
  company: row['Account Name'] || '',
  email: row.email || '',
  phone: row.phone || '',
  industry: row['GTM Industry'] || '',
  country: row['Mailing Country'] || '',
  employees: row.employees ?? null,
  rawData: {}
});

const saveLeadsToLibrary = async ({ userId, filter = {}, leads = [], name }) => {
  const crmLeads = (leads || []).map(toCrmLead);
  if (crmLeads.length === 0) throw new Error('No leads to save.');

  const hasPhone = crmLeads.some((l) => l.phone);
  const listName = (name || `Agent leads — ${new Date().toLocaleDateString()}`).slice(0, 100);

  const doc = await UserCRM.create({
    userId,
    crmObjectName: listName,
    source: 'export',
    exportFormat: hasPhone ? 'email_phone' : 'email_only',
    totalLeads: crmLeads.length,
    searchCriteria: {
      industry: filter.industry || '',
      company: filter.company || '',
      companySegment: filter.segment || '',
      location: filter.location || ''
    },
    leadIds: crmLeads.map((l) => l.leadId),
    leads: crmLeads,
    metadata: {
      matchedCount: crmLeads.length,
      exportedAt: new Date(),
      exportedBy: 'karya-agent'
    }
  });

  return { listId: String(doc._id), listName: doc.crmObjectName, count: crmLeads.length };
};

module.exports = { saveLeadsToLibrary };
