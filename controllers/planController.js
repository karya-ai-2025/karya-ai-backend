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

    const userPlan = await UserPlan.findOne({
      userId: userId,
      status: 'active',
      endDate: { $gt: new Date() }
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

    // Check for active plan
    const userPlan = await UserPlan.findOne({
      userId: userId,
      status: 'active',
      endDate: { $gt: new Date() }
    }).populate(['planId', 'planPackageId']);

    if (!userPlan) {
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

    // Check if user already has an active plan
    const existingPlan = await UserPlan.findOne({
      userId: userId,
      status: 'active',
      endDate: { $gt: new Date() }
    });

    if (existingPlan) {
      // Cancel existing plan
      existingPlan.status = 'cancelled';
      existingPlan.cancellationDate = new Date();
      existingPlan.cancellationReason = 'Upgraded to new plan';
      await existingPlan.save();
    }

    // Calculate end date (30 days from now)
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);
    const nextBillingDate = new Date(endDate);

    // Create new user plan
    const userPlan = new UserPlan({
      userId,
      planId,
      planPackageId,
      status: 'active',
      purchaseDate: startDate,
      startDate,
      endDate,
      nextBillingDate,
      creditsUsed: 0,
      projectsCreated: 0,
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

module.exports = {
  getPlans,
  getPackagesByPlan,
  getPlansWithPackages,
  getCurrentUserPlan,
  checkUserPlanAccess,
  createUserPlan
};