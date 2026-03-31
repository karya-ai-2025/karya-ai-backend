const Plan = require('../models/Plan');
const PlanPackage = require('../models/PlanPackage');
const UserPlan = require('../models/UserPlan');

// Get all active plans
const getPlans = async (req, res) => {
  try {
    const plans = await Plan.find({ isActive: true });
    res.status(200).json({
      success: true,
      data: plans
    });
  } catch (error) {
    console.error('Error fetching plans:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch plans',
      error: error.message
    });
  }
};

// Get packages by plan type
const getPackagesByPlan = async (req, res) => {
  try {
    const { planId } = req.params;

    const packages = await PlanPackage.find({
      planId: planId,
      isActive: true
    }).populate('planId');

    res.status(200).json({
      success: true,
      data: packages
    });
  } catch (error) {
    console.error('Error fetching plan packages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch plan packages',
      error: error.message
    });
  }
};

// Get plans with their packages
const getPlansWithPackages = async (req, res) => {
  try {
    const plans = await Plan.find({ isActive: true });

    const plansWithPackages = await Promise.all(
      plans.map(async (plan) => {
        const packages = await PlanPackage.find({
          planId: plan._id,
          isActive: true
        });

        return {
          ...plan.toJSON(),
          packages: packages
        };
      })
    );

    res.status(200).json({
      success: true,
      data: plansWithPackages
    });
  } catch (error) {
    console.error('Error fetching plans with packages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch plans with packages',
      error: error.message
    });
  }
};

// Get user's current plan
const getCurrentUserPlan = async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();


    const userPlan = await UserPlan.findOne({
      userId: userId,
      status: 'active',
      endDate: { $gt: now }
    }).populate(['planId', 'planPackageId']);


    if (!userPlan) {
      return res.status(200).json({
        success: true,
        data: null,
        message: 'No active plan found'
      });
    }

    res.status(200).json({
      success: true,
      data: userPlan
    });
  } catch (error) {
    console.error('Error fetching user plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user plan',
      error: error.message
    });
  }
};

// Check if user has active plan (for project access control)
const checkUserPlanAccess = async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();


    // First, check if user has any plans at all
    const allUserPlans = await UserPlan.find({ userId }).populate(['planId', 'planPackageId']);

    // Check for active plan with detailed logging
    const userPlan = await UserPlan.findOne({
      userId: userId,
      status: 'active',
      endDate: { $gt: now }
    }).populate(['planId', 'planPackageId']);

    if (!userPlan) {
      // Check if user has any plans at all
      const anyPlan = await UserPlan.findOne({ userId }).populate(['planId', 'planPackageId']);

      return res.status(200).json({
        success: true,
        hasActivePlan: false,
        message: 'No active plan found. Upgrade to access projects.',
        redirectTo: '/pricing'
      });
    }

    // Check remaining credits and projects
    const remainingCredits = userPlan.planPackageId.credits - userPlan.creditsUsed;
    const remainingProjects = userPlan.planPackageId.projectsAvailable - userPlan.projectsCreated;

    // Calculate remaining resources

    res.status(200).json({
      success: true,
      hasActivePlan: true,
      data: {
        userPlan,
        limits: {
          remainingCredits,
          remainingProjects,
          canCreateProject: remainingProjects > 0,
          canUseCredits: remainingCredits > 0
        }
      }
    });
  } catch (error) {
    console.error('Error checking user plan access:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check plan access',
      error: error.message
    });
  }
};

// Create user plan (upgrade)
const createUserPlan = async (req, res) => {
  try {
    const userId = req.user.id;
    const { planId, planPackageId } = req.body;

    // Validate required fields
    if (!planId || !planPackageId) {
      return res.status(400).json({
        success: false,
        message: 'Plan ID and Plan Package ID are required'
      });
    }

    // Verify the plan and package exist
    const plan = await Plan.findById(planId);
    const planPackage = await PlanPackage.findById(planPackageId);

    if (!plan || !planPackage) {
      return res.status(404).json({
        success: false,
        message: 'Invalid plan or package'
      });
    }

    // Check if user already has an active plan and get usage data
    const existingPlan = await UserPlan.findOne({
      userId: userId,
      status: 'active',
      endDate: { $gt: new Date() }
    });

    // Preserve existing usage data
    let existingProjectsCreated = 0;
    let existingCreditsUsed = 0;

    if (existingPlan) {
      // Capture existing usage before cancelling
      existingProjectsCreated = existingPlan.projectsCreated || 0;
      existingCreditsUsed = existingPlan.creditsUsed || 0;

      // Cancel existing plan
      existingPlan.status = 'cancelled';
      existingPlan.cancellationDate = new Date();
      existingPlan.cancellationReason = 'Upgraded to new plan';
      await existingPlan.save();

      console.log(`Carrying over usage data: Projects: ${existingProjectsCreated}, Credits: ${existingCreditsUsed}`);
    }

    // Calculate dates based on billing cycle
    const now = new Date();
    const startDate = new Date(now);
    let endDate = new Date(now);
    let nextBillingDate = new Date(now);

    // Calculate end date and next billing date based on billing cycle
    switch (planPackage.billingCycle) {
      case 'monthly':
        endDate.setMonth(endDate.getMonth() + 1);
        nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
        break;
      case 'quarterly':
        endDate.setMonth(endDate.getMonth() + 3);
        nextBillingDate.setMonth(nextBillingDate.getMonth() + 3);
        break;
      case 'yearly':
        endDate.setFullYear(endDate.getFullYear() + 1);
        nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1);
        break;
      case 'one-time':
        // For one-time purchases, set end date to 10 years from now
        endDate.setFullYear(endDate.getFullYear() + 10);
        nextBillingDate = null; // No next billing for one-time purchases
        break;
      default:
        // Default to monthly
        endDate.setMonth(endDate.getMonth() + 1);
        nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    }

    // Create new user plan with carried over usage data
    const userPlan = new UserPlan({
      userId,
      planId,
      planPackageId,
      status: 'active',
      purchaseDate: startDate,
      startDate,
      endDate,
      nextBillingDate,
      creditsUsed: existingCreditsUsed, // Carry over existing credits used
      projectsCreated: existingProjectsCreated, // Carry over existing project count
      paymentDetails: {
        amount: planPackage.price,
        currency: 'USD',
        paymentMethod: 'stripe',
        transactionId: `tx_${Date.now()}`, // Mock transaction ID
      },
      autoRenew: true
    });

    await userPlan.save();

    // Populate the response
    await userPlan.populate(['planId', 'planPackageId']);

    res.status(201).json({
      success: true,
      data: userPlan,
      message: 'Plan upgraded successfully'
    });
  } catch (error) {
    console.error('Error creating user plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upgrade plan',
      error: error.message
    });
  }
};

// Simple upgrade without payment integration
const simpleUpgrade = async (req, res) => {
  try {
    const { planId, planPackageId } = req.body;
    const userId = req.user._id;

    // Validate required fields
    if (!planId || !planPackageId) {
      return res.status(400).json({
        success: false,
        message: 'Plan ID and Plan Package ID are required'
      });
    }

    // Check if plan and package exist
    const plan = await Plan.findById(planId);
    const planPackage = await PlanPackage.findById(planPackageId);

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    if (!planPackage) {
      return res.status(404).json({
        success: false,
        message: 'Plan package not found'
      });
    }

    // Check if package belongs to the plan
    if (planPackage.planId.toString() !== planId) {
      return res.status(400).json({
        success: false,
        message: 'Plan package does not belong to the selected plan'
      });
    }

    // Get existing usage data before cancelling plans
    const existingActivePlan = await UserPlan.findOne({
      userId: userId,
      status: 'active',
      endDate: { $gt: new Date() }
    });

    // Preserve existing usage data
    let existingProjectsCreated = 0;
    let existingCreditsUsed = 0;

    if (existingActivePlan) {
      existingProjectsCreated = existingActivePlan.projectsCreated || 0;
      existingCreditsUsed = existingActivePlan.creditsUsed || 0;
      console.log(`Carrying over usage data: Projects: ${existingProjectsCreated}, Credits: ${existingCreditsUsed}`);
    }

    // Cancel any existing active plans for the user
    await UserPlan.updateMany(
      {
        userId: userId,
        status: 'active',
        endDate: { $gt: new Date() }
      },
      {
        status: 'cancelled',
        cancellationDate: new Date(),
        cancellationReason: 'Upgraded to new plan'
      }
    );

    // Calculate dates based on billing cycle
    const now = new Date();
    const startDate = new Date(now);
    let endDate = new Date(now);
    let nextBillingDate = new Date(now);

    // Calculate end date and next billing date based on billing cycle
    switch (planPackage.billingCycle) {
      case 'monthly':
        endDate.setMonth(endDate.getMonth() + 1);
        nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
        break;
      case 'quarterly':
        endDate.setMonth(endDate.getMonth() + 3);
        nextBillingDate.setMonth(nextBillingDate.getMonth() + 3);
        break;
      case 'yearly':
        endDate.setFullYear(endDate.getFullYear() + 1);
        nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1);
        break;
      case 'one-time':
        // For one-time purchases, set end date to 10 years from now
        endDate.setFullYear(endDate.getFullYear() + 10);
        nextBillingDate = null; // No next billing for one-time purchases
        break;
      default:
        // Default to monthly
        endDate.setMonth(endDate.getMonth() + 1);
        nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    }

    // Create new user plan with carried over usage data
    const userPlan = new UserPlan({
      userId: userId,
      planId: planId,
      planPackageId: planPackageId,
      status: 'active',
      purchaseDate: now,
      startDate: startDate,
      endDate: endDate,
      nextBillingDate: nextBillingDate,
      creditsUsed: existingCreditsUsed, // Carry over existing credits used
      projectsCreated: existingProjectsCreated, // Carry over existing project count
      paymentDetails: {
        amount: planPackage.price,
        currency: 'USD',
        paymentMethod: 'manual',
        transactionId: `SIMPLE_${Date.now()}_${userId.toString().slice(-6)}`,
        stripeSubscriptionId: null
      }
    });

    await userPlan.save();

    // Populate the userPlan with plan and package details
    await userPlan.populate(['planId', 'planPackageId']);

    res.status(201).json({
      success: true,
      message: 'Plan upgraded successfully',
      data: {
        userPlan,
        message: 'You have been successfully upgraded! Your new plan is now active.',
        nextBillingDate: nextBillingDate
      }
    });

  } catch (error) {
    console.error('Error in simple upgrade:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upgrade plan',
      error: error.message
    });
  }
};

// Utility function to increment project count
const incrementProjectCount = async (userId) => {
  try {
    const activeUserPlan = await UserPlan.findOne({
      userId: userId,
      status: 'active',
      endDate: { $gt: new Date() }
    });

    if (activeUserPlan) {
      activeUserPlan.projectsCreated += 1;
      await activeUserPlan.save();
      return { success: true, newCount: activeUserPlan.projectsCreated };
    } else {
      console.warn(`No active plan found for user ${userId}`);
      return { success: false, message: 'No active plan found' };
    }
  } catch (error) {
    console.error('Error incrementing project count:', error);
    return { success: false, error: error.message };
  }
};

// Utility function to decrement project count (for future use)
const decrementProjectCount = async (userId) => {
  try {
    const activeUserPlan = await UserPlan.findOne({
      userId: userId,
      status: 'active',
      endDate: { $gt: new Date() }
    });

    if (activeUserPlan && activeUserPlan.projectsCreated > 0) {
      activeUserPlan.projectsCreated -= 1;
      await activeUserPlan.save();
      console.log(`Decremented projectsCreated for user ${userId} to ${activeUserPlan.projectsCreated}`);
      return { success: true, newCount: activeUserPlan.projectsCreated };
    } else {
      console.warn(`No active plan found or projectsCreated already at 0 for user ${userId}`);
      return { success: false, message: 'No active plan found or projectsCreated already at 0' };
    }
  } catch (error) {
    console.error('Error decrementing project count:', error);
    return { success: false, error: error.message };
  }
};

// Get user's billing history
const getUserBillingHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10 } = req.query;

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get all user plans (billing history) sorted by purchase date (newest first)
    const userPlans = await UserPlan.find({ userId })
      .populate(['planId', 'planPackageId'])
      .sort({ purchaseDate: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const totalCount = await UserPlan.countDocuments({ userId });
    const totalPages = Math.ceil(totalCount / parseInt(limit));

    // Transform the data for better frontend consumption
    const billingHistory = userPlans.map(userPlan => ({
      id: userPlan._id,
      planName: `${userPlan.planId?.displayName || 'Unknown Plan'} ${userPlan.planPackageId?.name || ''}`,
      amount: userPlan.paymentDetails?.amount || 0,
      currency: userPlan.paymentDetails?.currency || 'USD',
      paymentMethod: userPlan.paymentDetails?.paymentMethod || 'Unknown',
      transactionId: userPlan.paymentDetails?.transactionId || null,
      purchaseDate: userPlan.purchaseDate,
      startDate: userPlan.startDate,
      endDate: userPlan.endDate,
      status: userPlan.status,
      billingCycle: userPlan.planPackageId?.billingCycle || 'monthly',
      cancellationDate: userPlan.cancellationDate,
      cancellationReason: userPlan.cancellationReason
    }));

    res.status(200).json({
      success: true,
      data: {
        billingHistory,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalCount,
          hasNextPage: parseInt(page) < totalPages,
          hasPrevPage: parseInt(page) > 1
        }
      }
    });
  } catch (error) {
    console.error('Error fetching billing history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch billing history',
      error: error.message
    });
  }
};

module.exports = {
  getPlans,
  getPackagesByPlan,
  getPlansWithPackages,
  getCurrentUserPlan,
  checkUserPlanAccess,
  createUserPlan,
  simpleUpgrade,
  incrementProjectCount,
  decrementProjectCount,
  getUserBillingHistory
};