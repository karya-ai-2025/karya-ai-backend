const EmailTemplate = require('../models/EmailTemplate');

// @desc    Get all email templates for a user
// @route   GET /api/email-templates
// @access  Private
const getEmailTemplates = async (req, res) => {
  try {
    const { category, templateType, search, page = 1, limit = 10 } = req.query;
    const userId = req.user.id;

    let query = { userId, isActive: true };

    // Apply filters
    if (category) query.category = category;
    if (templateType) query.templateType = templateType;

    let templates;

    if (search) {
      // Use search method for text search
      templates = await EmailTemplate.searchTemplates(search, userId);
    } else {
      templates = await EmailTemplate.find(query)
        .sort({ 'usageStats.timesUsed': -1, updatedAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit);
    }

    const total = await EmailTemplate.countDocuments(query);

    res.json({
      success: true,
      data: templates,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalCount: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Error fetching email templates:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch email templates',
      error: error.message
    });
  }
};

// @desc    Get single email template
// @route   GET /api/email-templates/:id
// @access  Private
const getEmailTemplate = async (req, res) => {
  try {
    const template = await EmailTemplate.findOne({
      _id: req.params.id,
      userId: req.user.id,
      isActive: true
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Email template not found'
      });
    }

    res.json({
      success: true,
      data: template
    });
  } catch (error) {
    console.error('Error fetching email template:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch email template',
      error: error.message
    });
  }
};

// @desc    Create new email template
// @route   POST /api/email-templates
// @access  Private
const createEmailTemplate = async (req, res) => {
  try {
    const {
      templateName,
      description,
      subject,
      emailBody,
      templateType,
      category,
      tags,
      availableVariables,
      settings
    } = req.body;

    // Validate required fields
    if (!templateName || !subject || !emailBody) {
      return res.status(400).json({
        success: false,
        message: 'Template name, subject, and email body are required'
      });
    }

    // Create email template
    const template = new EmailTemplate({
      templateName,
      description,
      subject,
      emailBody,
      userId: req.user.id,
      templateType: templateType || 'campaign',
      category: category || 'general',
      tags: tags || [],
      availableVariables: availableVariables || [],
      settings: {
        contentType: 'html',
        trackOpens: true,
        trackClicks: true,
        enableUnsubscribe: true,
        ...settings
      }
    });

    await template.save();

    res.status(201).json({
      success: true,
      data: template,
      message: 'Email template created successfully'
    });
  } catch (error) {
    console.error('Error creating email template:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create email template',
      error: error.message
    });
  }
};

// @desc    Update email template
// @route   PUT /api/email-templates/:id
// @access  Private
const updateEmailTemplate = async (req, res) => {
  try {
    const template = await EmailTemplate.findOne({
      _id: req.params.id,
      userId: req.user.id,
      isActive: true
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Email template not found'
      });
    }

    // Update allowed fields
    const allowedFields = [
      'templateName', 'description', 'subject', 'emailBody',
      'templateType', 'category', 'tags', 'availableVariables', 'settings'
    ];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        template[field] = req.body[field];
      }
    });

    await template.save();

    res.json({
      success: true,
      data: template,
      message: 'Email template updated successfully'
    });
  } catch (error) {
    console.error('Error updating email template:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update email template',
      error: error.message
    });
  }
};

// @desc    Delete email template
// @route   DELETE /api/email-templates/:id
// @access  Private
const deleteEmailTemplate = async (req, res) => {
  try {
    const template = await EmailTemplate.findOne({
      _id: req.params.id,
      userId: req.user.id,
      isActive: true
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Email template not found'
      });
    }

    // Soft delete - mark as inactive
    template.isActive = false;
    await template.save();

    res.json({
      success: true,
      message: 'Email template deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting email template:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete email template',
      error: error.message
    });
  }
};

// @desc    Preview email template with sample data
// @route   POST /api/email-templates/:id/preview
// @access  Private
const previewEmailTemplate = async (req, res) => {
  try {
    const template = await EmailTemplate.findOne({
      _id: req.params.id,
      userId: req.user.id,
      isActive: true
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Email template not found'
      });
    }

    const { leadData } = req.body;

    let previewContent;

    if (leadData) {
      // Use provided lead data
      previewContent = template.personalizeContent(leadData);
    } else {
      // Use template's built-in preview data
      previewContent = {
        subject: template.previewData.sampleSubject || template.subject,
        body: template.previewData.sampleBody || template.emailBody
      };
    }

    res.json({
      success: true,
      data: {
        template: {
          id: template._id,
          templateName: template.templateName,
          category: template.category
        },
        preview: previewContent,
        variables: template.variablesInContent,
        wordCount: template.wordCount
      }
    });
  } catch (error) {
    console.error('Error previewing email template:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to preview email template',
      error: error.message
    });
  }
};

// @desc    Get template categories
// @route   GET /api/email-templates/categories
// @access  Private
const getTemplateCategories = async (req, res) => {
  try {
    const categories = await EmailTemplate.distinct('category', {
      userId: req.user.id,
      isActive: true
    });

    const categoriesWithCounts = await EmailTemplate.aggregate([
      {
        $match: {
          userId: req.user.id,
          isActive: true
        }
      },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          templates: { $push: { id: '$_id', name: '$templateName' } }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    res.json({
      success: true,
      data: {
        categories,
        detailed: categoriesWithCounts
      }
    });
  } catch (error) {
    console.error('Error fetching template categories:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch template categories',
      error: error.message
    });
  }
};

// @desc    Get popular templates
// @route   GET /api/email-templates/popular
// @access  Private
const getPopularTemplates = async (req, res) => {
  try {
    const { limit = 5 } = req.query;

    const popularTemplates = await EmailTemplate.find({
      userId: req.user.id,
      isActive: true,
      'usageStats.timesUsed': { $gt: 0 }
    })
      .sort({ 'usageStats.timesUsed': -1 })
      .limit(parseInt(limit))
      .select('templateName category usageStats.timesUsed usageStats.averageOpenRate');

    res.json({
      success: true,
      data: popularTemplates
    });
  } catch (error) {
    console.error('Error fetching popular templates:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch popular templates',
      error: error.message
    });
  }
};

// @desc    Duplicate email template
// @route   POST /api/email-templates/:id/duplicate
// @access  Private
const duplicateEmailTemplate = async (req, res) => {
  try {
    const originalTemplate = await EmailTemplate.findOne({
      _id: req.params.id,
      userId: req.user.id,
      isActive: true
    });

    if (!originalTemplate) {
      return res.status(404).json({
        success: false,
        message: 'Email template not found'
      });
    }

    // Create duplicate
    const duplicateData = originalTemplate.toObject();
    delete duplicateData._id;
    delete duplicateData.__v;
    delete duplicateData.createdAt;
    delete duplicateData.updatedAt;
    delete duplicateData.usageStats;
    delete duplicateData.previousVersions;

    duplicateData.templateName = `${duplicateData.templateName} (Copy)`;
    duplicateData.version = 1;

    const duplicateTemplate = new EmailTemplate(duplicateData);
    await duplicateTemplate.save();

    res.status(201).json({
      success: true,
      data: duplicateTemplate,
      message: 'Email template duplicated successfully'
    });
  } catch (error) {
    console.error('Error duplicating email template:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to duplicate email template',
      error: error.message
    });
  }
};

module.exports = {
  getEmailTemplates,
  getEmailTemplate,
  createEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
  previewEmailTemplate,
  getTemplateCategories,
  getPopularTemplates,
  duplicateEmailTemplate
};