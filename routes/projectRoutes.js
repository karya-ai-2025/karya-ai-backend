const express = require('express');
const { body, query, param, validationResult } = require('express-validator');
const Project = require('../models/Project');
const ProjectUser = require('../models/ProjectUser');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Helper function to handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: errors.array()
    });
  }
  next();
};

// ============================================
// PUBLIC ROUTES
// ============================================

// GET /api/projects - Get all active projects (public)
router.get('/', [
  query('featured').optional().isBoolean(),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('page').optional().isInt({ min: 1 }),
  query('sort').optional().isIn(['newest', 'oldest', 'popular']),
  handleValidationErrors
], async (req, res) => {
  try {
    const {
      featured,
      limit = 12,
      page = 1,
      sort = 'newest'
    } = req.query;

    // Build query filters
    const filters = {
      status: 'active',
      isPublished: true
    };

    if (featured === 'true') filters.isFeatured = true;

    // Build sort options
    let sortOptions = {};
    switch (sort) {
      case 'oldest':
        sortOptions = { createdAt: 1 };
        break;
      case 'popular':
        sortOptions = { usageCount: -1, createdAt: -1 };
        break;
      case 'newest':
      default:
        sortOptions = { isFeatured: -1, createdAt: -1 };
        break;
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Execute query
    const [projects, totalCount] = await Promise.all([
      Project.find(filters)
        .select('-__v') // Exclude version field
        .populate('createdBy', 'name email')
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Project.countDocuments(filters)
    ]);

    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / parseInt(limit));
    const hasNextPage = parseInt(page) < totalPages;
    const hasPrevPage = parseInt(page) > 1;

    res.status(200).json({
      success: true,
      data: {
        projects,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalCount,
          hasNextPage,
          hasPrevPage,
          limit: parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching projects',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// GET /api/projects/featured - Get featured projects
router.get('/featured', [
  query('limit').optional().isInt({ min: 1, max: 20 }),
  handleValidationErrors
], async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;

    const projects = await Project.getFeaturedProjects(limit)
      .select('-__v')
      .populate('createdBy', 'name email')
      .lean();

    res.status(200).json({
      success: true,
      data: {
        projects,
        count: projects.length
      }
    });
  } catch (error) {
    console.error('Error fetching featured projects:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching featured projects',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// GET /api/projects/by-id/:id - Get project by ID
router.get('/by-id/:id', [
  param('id').isMongoId().withMessage('Invalid project ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      status: 'active',
      isPublished: true
    })
      .populate('createdBy', 'name email')
      .lean();

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    res.status(200).json({
      success: true,
      data: { project }
    });
  } catch (error) {
    console.error('Error fetching project:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching project',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// GET /api/projects/:slug - Get project by slug (kept for backward compatibility)
router.get('/:slug', [
  param('slug').isSlug().withMessage('Invalid project slug'),
  handleValidationErrors
], async (req, res) => {
  try {
    const project = await Project.findOne({
      slug: req.params.slug,
      status: 'active',
      isPublished: true
    })
      .populate('createdBy', 'name email')
      .lean();

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    res.status(200).json({
      success: true,
      data: { project }
    });
  } catch (error) {
    console.error('Error fetching project:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching project',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// ============================================
// PROTECTED ROUTES (Admin/User actions)
// ============================================

// POST /api/projects/:id/select - User selects a project to work with
router.post('/:id/select', [
  protect,
  param('id').isMongoId().withMessage('Invalid project ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      status: 'active',
      isPublished: true
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Check if user already has access to this project
    let projectUser = await ProjectUser.findOne({
      userId: req.user._id,
      projectId: project._id
    });

    if (!projectUser) {
      // Create new ProjectUser entry
      projectUser = new ProjectUser({
        userId: req.user._id,
        projectId: project._id,
        projectSlug: project.slug,
        status: 'started'
      });

      await projectUser.save();

      // Increment usage count only for new selections
      await project.incrementUsage();
    } else {
      // Update last accessed time for existing project
      await projectUser.updateLastAccessed();
    }

    res.status(200).json({
      success: true,
      message: projectUser.isNew ? 'Project selected successfully' : 'Project accessed successfully',
      data: {
        project: {
          id: project._id,
          name: project.name,
          slug: project.slug
        },
        projectUser: {
          id: projectUser._id,
          status: projectUser.status,
          progress: projectUser.progress,
          startedAt: projectUser.startedAt,
          lastAccessedAt: projectUser.lastAccessedAt
        }
      }
    });
  } catch (error) {
    console.error('Error selecting project:', error);
    res.status(500).json({
      success: false,
      message: 'Error selecting project',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// GET /api/projects/user/my-projects - Get user's selected projects
router.get('/user/my-projects', [
  protect
], async (req, res) => {
  try {
    const userProjects = await ProjectUser.getUserProjects(req.user._id);

    // Transform for frontend
    const projects = userProjects.map(userProject => ({
      _id: userProject.projectId._id,
      name: userProject.projectId.name,
      slug: userProject.projectId.slug,
      description: userProject.projectId.description,
      status: userProject.projectId.status,
      thumbnailImage: userProject.projectId.thumbnailImage,
      isFeatured: userProject.projectId.isFeatured,
      userStatus: userProject.status,
      progress: userProject.progress,
      startedAt: userProject.startedAt,
      lastAccessedAt: userProject.lastAccessedAt
    }));

    res.status(200).json({
      success: true,
      data: {
        projects,
        count: projects.length
      }
    });
  } catch (error) {
    console.error('Error fetching user projects:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user projects',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// ============================================
// ADMIN ROUTES (Create/Update/Delete projects)
// ============================================

// POST /api/projects - Create new project (Admin only)
router.post('/', [
  protect,
  body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Project name is required and must be between 1-100 characters'),
  body('description').trim().isLength({ min: 1, max: 1000 }).withMessage('Description is required and must be between 1-1000 characters'),
  body('features').isArray({ min: 1 }).withMessage('At least one feature is required'),
  body('benefits').isArray({ min: 1 }).withMessage('At least one benefit is required'),
  body('thumbnailImage').optional().isURL().withMessage('Thumbnail image must be a valid URL'),
  body('tags').optional().isArray().withMessage('Tags must be an array'),
  handleValidationErrors
], async (req, res) => {
  try {
    // TODO: Add admin role check here
    // if (req.user.role !== 'admin') {
    //   return res.status(403).json({
    //     success: false,
    //     message: 'Access denied. Admin role required.'
    //   });
    // }

    const projectData = {
      ...req.body,
      createdBy: req.user._id
    };

    const project = new Project(projectData);
    await project.save();

    res.status(201).json({
      success: true,
      message: 'Project created successfully',
      data: { project }
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Project with this slug already exists'
      });
    }

    console.error('Error creating project:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating project',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;
