const UserCreditConsumption = require('../models/UserCreditConsumption'); // Adjust path as needed

// @desc    Get leads that user has accessed/downloaded
// @route   GET /api/leads/user-leads
// @access  Private
const getUserLeads = async (req, res) => {
  try {
    // Auth middleware ensures req.user exists
    const userId = req.user.id || req.user._id;
    console.log(`Fetching leads for authenticated user ${userId}`);
    console.log('User object:', { id: req.user.id, email: req.user.email, fullName: req.user.fullName });

    // Get leads from credit consumption where user viewed email or phone
    const leadConsumptions = await UserCreditConsumption.find({
      userId,
      $or: [
        { actionType: 'VIEW_EMAIL' },
        { actionType: 'VIEW_PHONE' },
        { actionType: 'DOWNLOAD_LEADS' }
      ]
    }).sort({ createdAt: -1 });
    console.log(`Found ${leadConsumptions.length} leads for user ${userId}`);


    // Group by leadId to avoid duplicates and get latest data
    const leadsMap = new Map();

    leadConsumptions.forEach(consumption => {
      const leadId = consumption.leadId;
      if (!leadsMap.has(leadId) || leadsMap.get(leadId).createdAt < consumption.createdAt) {
        leadsMap.set(leadId, {
          id: leadId,
          email: consumption.leadEmail || '',
          firstName: consumption.leadName ? consumption.leadName.split(' ')[0] : '',
          lastName: consumption.leadName ? consumption.leadName.split(' ').slice(1).join(' ') : '',
          fullName: consumption.leadName || '',
          company: consumption.leadCompany || 'Unknown Company',
          phone: consumption.leadPhone || '',
          industry: 'N/A',
          jobTitle: 'N/A',
          accessedAt: consumption.createdAt,
          hasEmail: consumption.actionType === 'VIEW_EMAIL' || consumption.actionType === 'DOWNLOAD_LEADS',
          hasPhone: consumption.actionType === 'VIEW_PHONE' || consumption.actionType === 'DOWNLOAD_LEADS',
          actionType: consumption.actionType
        });
      }
    });

    const leads = Array.from(leadsMap.values());
    console.log(`Returning ${leads.length} leads for user ${userId}`);


    res.json({
      success: true,
      data: leads,
      count: leads.length,
      message: leads.length === 0 ? 'No leads found. Generate some leads first.' : undefined
    });
  } catch (error) {
    console.error('Error fetching user leads:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leads',
      error: error.message
    });
  }
};

// @desc    Get available leads count
// @route   GET /api/leads/user-leads/count
// @access  Private
const getUserLeadsCount = async (req, res) => {
  try {
    // Auth middleware ensures req.user exists
    const userId = req.user.id || req.user._id;
    console.log(`Fetching leads count for authenticated user ${userId}`);

    const count = await UserCreditConsumption.countDocuments({
      userId,
      $or: [
        { actionType: 'VIEW_EMAIL' },
        { actionType: 'VIEW_PHONE' },
        { actionType: 'DOWNLOAD_LEADS' }
      ]
    });

    res.json({
      success: true,
      count
    });
  } catch (error) {
    console.error('Error fetching leads count:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leads count',
      error: error.message
    });
  }
};

module.exports = {
  getUserLeads,
  getUserLeadsCount
};