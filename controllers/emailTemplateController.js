const EmailTemplate = require('../models/EmailTemplate');
const {
  assertUserOwnsAttachmentBlob,
  deleteAttachmentBlob,
  uploadAttachmentBuffer
} = require('../services/blobStorageService');
// const { readFormFields } = require('../services/pdfFillService'); // PDF-per-lead feature disabled for live (uploadDocumentTemplate route is off)

// Lead attributes a PDF field can be mapped to (matches campaign selectedLeads).
const LEAD_ATTRIBUTES = ['firstName', 'lastName', 'fullName', 'company', 'jobTitle', 'industry', 'email', 'phone'];

// Auto-map a PDF field name to a lead attribute when the names line up.
const autoMapField = (fieldName = '') => {
  const norm = String(fieldName).toLowerCase().replace(/[^a-z]/g, '');
  return LEAD_ATTRIBUTES.find((attr) => attr.toLowerCase() === norm) || '';
};

// Validate + normalize a documentTemplate before saving it on a template.
const normalizeDocumentTemplate = (doc, userId) => {
  if (!doc || !doc.blobName) return undefined; // clearing / none
  assertUserOwnsAttachmentBlob(userId, doc.blobName);
  return {
    originalName: String(doc.originalName || 'document.pdf').slice(0, 255),
    fileName: String(doc.fileName || doc.originalName || 'document.pdf').slice(0, 255),
    blobName: doc.blobName,
    contentType: 'application/pdf',
    size: Number(doc.size) || 0,
    uploadedAt: doc.uploadedAt ? new Date(doc.uploadedAt) : new Date(),
    fields: Array.isArray(doc.fields)
      ? doc.fields
          .filter((f) => f && f.name)
          .map((f) => ({
            name: String(f.name).slice(0, 200),
            mapsTo: LEAD_ATTRIBUTES.includes(f.mapsTo) ? f.mapsTo : '',
            defaultValue: String(f.defaultValue || '').slice(0, 500)
          }))
      : []
  };
};

const MAX_ATTACHMENT_FILE_SIZE_MB = parseInt(process.env.EMAIL_ATTACHMENT_MAX_FILE_SIZE_MB, 10) || 10;
const MAX_ATTACHMENT_TOTAL_SIZE_MB = parseInt(process.env.EMAIL_ATTACHMENT_MAX_TOTAL_SIZE_MB, 10) || 20;
const MAX_ATTACHMENT_FILE_SIZE = MAX_ATTACHMENT_FILE_SIZE_MB * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_SIZE = MAX_ATTACHMENT_TOTAL_SIZE_MB * 1024 * 1024;
const MAX_ATTACHMENTS_PER_TEMPLATE = 5;

const allowedAttachmentMimeTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg',
  'image/png',
  'image/gif',
  'text/plain',
  'text/csv'
]);

const allowedAttachmentExtensions = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.txt',
  '.csv'
]);

const getFileExtension = (fileName = '') => {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
};

const isAllowedAttachmentType = (file) => {
  return allowedAttachmentMimeTypes.has(file.mimetype) ||
    allowedAttachmentExtensions.has(getFileExtension(file.originalname));
};

const normalizeTemplateAttachments = (attachments = [], userId) => {
  if (!Array.isArray(attachments)) return [];

  if (attachments.length > MAX_ATTACHMENTS_PER_TEMPLATE) {
    const error = new Error(`A template can include up to ${MAX_ATTACHMENTS_PER_TEMPLATE} attachments`);
    error.statusCode = 400;
    throw error;
  }

  const totalSize = attachments.reduce((sum, attachment) => sum + (Number(attachment?.size) || 0), 0);
  if (totalSize > MAX_ATTACHMENT_TOTAL_SIZE) {
    const error = new Error(`Total attachment size cannot exceed ${MAX_ATTACHMENT_TOTAL_SIZE_MB}MB`);
    error.statusCode = 400;
    throw error;
  }

  return attachments
    .filter((attachment) => attachment && attachment.blobName)
    .map((attachment) => {
      assertUserOwnsAttachmentBlob(userId, attachment.blobName);

      return {
        originalName: String(attachment.originalName || attachment.fileName || 'attachment').slice(0, 255),
        fileName: String(attachment.fileName || attachment.originalName || 'attachment').slice(0, 255),
        blobName: attachment.blobName,
        contentType: String(attachment.contentType || 'application/octet-stream').slice(0, 150),
        size: Number(attachment.size) || 0,
        uploadedAt: attachment.uploadedAt ? new Date(attachment.uploadedAt) : new Date()
      };
    });
};

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
    const userId = req.user.id || req.user._id;
    const {
      templateName,
      description,
      subject,
      emailBody,
      templateType,
      category,
      tags,
      availableVariables,
      settings,
      attachments
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
      userId,
      templateType: templateType || 'campaign',
      category: category || 'general',
      tags: tags || [],
      availableVariables: availableVariables || [],
      attachments: normalizeTemplateAttachments(attachments, userId),
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
    res.status(error.statusCode || 500).json({
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
    const userId = req.user.id || req.user._id;
    const template = await EmailTemplate.findOne({
      _id: req.params.id,
      userId,
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
      'templateType', 'category', 'tags', 'availableVariables', 'settings', 'attachments', 'documentTemplate'
    ];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        if (field === 'attachments') {
          template.attachments = normalizeTemplateAttachments(req.body[field], userId);
        } else if (field === 'documentTemplate') {
          template.documentTemplate = normalizeDocumentTemplate(req.body[field], userId);
        } else {
          template[field] = req.body[field];
        }
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
    res.status(error.statusCode || 500).json({
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
        attachments: template.attachments || [],
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

// @desc    Upload an email template attachment
// @route   POST /api/email-templates/attachments/upload
// @access  Private
const uploadEmailTemplateAttachment = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Attachment file is required'
      });
    }

    if (req.file.size > MAX_ATTACHMENT_FILE_SIZE) {
      return res.status(400).json({
        success: false,
        message: `Attachment size cannot exceed ${MAX_ATTACHMENT_FILE_SIZE_MB}MB`
      });
    }

    if (!isAllowedAttachmentType(req.file)) {
      return res.status(400).json({
        success: false,
        message: 'Unsupported attachment file type'
      });
    }

    const attachment = await uploadAttachmentBuffer({
      userId,
      file: req.file
    });

    res.status(201).json({
      success: true,
      data: attachment,
      message: 'Attachment uploaded successfully'
    });
  } catch (error) {
    console.error('Error uploading email template attachment:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: 'Failed to upload attachment',
      error: error.message
    });
  }
};

// @desc    Delete an uploaded email template attachment
// @route   DELETE /api/email-templates/attachments
// @access  Private
const deleteEmailTemplateAttachment = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { blobName } = req.body;

    if (!blobName) {
      return res.status(400).json({
        success: false,
        message: 'blobName is required'
      });
    }

    await deleteAttachmentBlob({
      userId,
      blobName
    });

    res.json({
      success: true,
      message: 'Attachment deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting email template attachment:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: 'Failed to delete attachment',
      error: error.message
    });
  }
};

// @desc    Upload a fillable PDF, detect its form fields, and return the blob
//          metadata + fields so the frontend can map each field → a lead value.
// @route   POST /api/email-templates/document/upload
// @access  Private
const uploadDocumentTemplate = async (req, res) => {
  // PDF-per-lead feature disabled for live. The route is commented out, so this
  // never runs — this guard just returns cleanly if it's ever reached.
  return res.status(503).json({ success: false, message: 'The personalized PDF feature is temporarily unavailable.' });
  // eslint-disable-next-line no-unreachable
  try {
    const userId = req.user.id || req.user._id;
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'A PDF document is required' });
    }
    const isPdf = req.file.mimetype === 'application/pdf' || getFileExtension(req.file.originalname) === '.pdf';
    if (!isPdf) {
      return res.status(400).json({ success: false, message: 'Only PDF documents are supported' });
    }

    // Detect the fillable form fields BEFORE storing, so we can reject flat PDFs.
    let detected;
    try {
      detected = await readFormFields(req.file.buffer);
    } catch {
      return res.status(400).json({ success: false, message: 'Could not read this PDF. Make sure it is a valid PDF file.' });
    }
    if (detected.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'This PDF has no fillable form fields. Add named text fields (e.g. firstName, company) in a PDF editor, then upload it.'
      });
    }

    const meta = await uploadAttachmentBuffer({ userId, file: req.file });
    const fields = detected.map((f) => ({ name: f.name, type: f.type, mapsTo: autoMapField(f.name), defaultValue: '' }));

    res.status(201).json({
      success: true,
      data: { ...meta, fields },
      message: `Uploaded. Detected ${fields.length} field${fields.length === 1 ? '' : 's'}.`
    });
  } catch (error) {
    console.error('Error uploading document template:', error);
    res.status(error.statusCode || 500).json({ success: false, message: 'Failed to upload document', error: error.message });
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
  duplicateEmailTemplate,
  uploadEmailTemplateAttachment,
  deleteEmailTemplateAttachment,
  uploadDocumentTemplate
};
