const UserCreditConsumption = require('../models/UserCreditConsumption');
const UserPlan = require('../models/UserPlan');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

/**
 * @desc Get user's credit consumption statistics
 * @route GET /api/credits/stats
 * @access Private
 */
const getCreditStats = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;

  // Get user's active plan for total credits used
  const userPlan = await UserPlan.findOne({
    userId,
    status: 'active',
    endDate: { $gt: new Date() }
  });

  // Convert userId to ObjectId for aggregation (MongoDB needs proper type matching)
  const mongoose = require('mongoose');
  const userObjectId = new mongoose.Types.ObjectId(userId);

  // Get consumption stats with proper ObjectId
  const stats = await UserCreditConsumption.aggregate([
    { $match: { userId: userObjectId } },
    {
      $group: {
        _id: '$actionType',
        totalCredits: { $sum: '$creditsConsumed' },
        count: { $sum: 1 }
      }
    },
    { $sort: { totalCredits: -1 } }
  ]);


  // Initialize credit breakdown
  const creditBreakdown = {
    VIEW_EMAIL: { totalCredits: 0, count: 0 },
    VIEW_PHONE: { totalCredits: 0, count: 0 },
    DOWNLOAD_LEADS: { totalCredits: 0, count: 0 }
  };

  // Populate breakdown from stats
  stats.forEach(stat => {
    if (creditBreakdown[stat._id]) {
      creditBreakdown[stat._id] = {
        totalCredits: stat.totalCredits,
        count: stat.count
      };
    }
  });

  // Calculate totals from consumption records
  const totalCreditsFromConsumption = stats.reduce((sum, stat) => sum + stat.totalCredits, 0);
  const totalActions = stats.reduce((sum, stat) => sum + stat.count, 0);

  // Get total count of consumption records
  const totalRecords = await UserCreditConsumption.countDocuments({ userId });

  res.json({
    success: true,
    totalCreditsUsed: userPlan?.creditsUsed || totalCreditsFromConsumption,
    totalCreditsAvailable: userPlan?.totalCredits || 0,
    remainingCredits: userPlan ? Math.max(0, userPlan.totalCredits - userPlan.creditsUsed) : 0,
    breakdown: creditBreakdown,
    summary: {
      totalCredits: totalCreditsFromConsumption,
      totalActions,
      userPlan: userPlan ? {
        status: userPlan.status,
        endDate: userPlan.endDate
      } : null
    }
  });
});

/**
 * @desc Get user's credit consumption history
 * @route GET /api/credits/history
 * @access Private
 */
const getCreditHistory = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;

  // Validate pagination parameters
  if (page < 1) {
    return next(new AppError('Page number must be greater than 0', 400));
  }

  if (limit < 1 || limit > 100) {
    return next(new AppError('Limit must be between 1 and 100', 400));
  }

  const history = await UserCreditConsumption.getUserHistory(userId, page, limit);

  // Get total count for pagination info
  const totalRecords = await UserCreditConsumption.countDocuments({ userId });
  const totalPages = Math.ceil(totalRecords / limit);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;

  res.json({
    success: true,
    history,
    pagination: {
      currentPage: page,
      totalPages,
      totalRecords,
      hasNextPage,
      hasPrevPage,
      limit
    }
  });
});

/**
 * @desc Get detailed information about a specific credit consumption record
 * @route GET /api/credits/:id
 * @access Private
 */
const getCreditRecord = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;
  const recordId = req.params.id;

  const record = await UserCreditConsumption.findOne({
    _id: recordId,
    userId
  })
  .populate('userPlanId', 'planId planPackageId')
  .populate('projectId', 'name');

  if (!record) {
    return next(new AppError('Credit record not found', 404));
  }

  res.json({
    success: true,
    record
  });
});

/**
 * @desc Get credit consumption summary by action type
 * @route GET /api/credits/summary
 * @access Private
 */
const getCreditSummary = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;
  const { period = '30' } = req.query; // days

  const days = parseInt(period);
  if (isNaN(days) || days < 1) {
    return next(new AppError('Period must be a valid number of days', 400));
  }

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - (days * 24 * 60 * 60 * 1000));

  // Get stats for the period
  const stats = await UserCreditConsumption.getConsumptionStats(
    userId,
    startDate.toISOString(),
    endDate.toISOString()
  );

  // Get total lifetime stats
  const lifetimeStats = await UserCreditConsumption.getConsumptionStats(userId);

  // Calculate recent activity (last 7 days)
  const recentStartDate = new Date(endDate.getTime() - (7 * 24 * 60 * 60 * 1000));
  const recentStats = await UserCreditConsumption.getConsumptionStats(
    userId,
    recentStartDate.toISOString(),
    endDate.toISOString()
  );

  res.json({
    success: true,
    summary: {
      period: {
        days,
        stats,
        totalCredits: stats.reduce((sum, stat) => sum + stat.totalCredits, 0),
        totalActions: stats.reduce((sum, stat) => sum + stat.count, 0)
      },
      lifetime: {
        stats: lifetimeStats,
        totalCredits: lifetimeStats.reduce((sum, stat) => sum + stat.totalCredits, 0),
        totalActions: lifetimeStats.reduce((sum, stat) => sum + stat.count, 0)
      },
      recent: {
        days: 7,
        stats: recentStats,
        totalCredits: recentStats.reduce((sum, stat) => sum + stat.totalCredits, 0),
        totalActions: recentStats.reduce((sum, stat) => sum + stat.count, 0)
      }
    }
  });
});

/**
 * @desc Purchase additional credits for user's active plan
 * @route POST /api/credits/purchase
 * @access Private
 */
const purchaseCredits = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;
  const { credits, amount } = req.body;

  // Validate input
  if (!credits || !amount) {
    return res.status(400).json({
      success: false,
      message: 'Credits and amount are required'
    });
  }

  const creditsNum = parseInt(credits);
  const amountNum = parseFloat(amount);

  if (creditsNum < 1 || creditsNum > 10000) {
    return res.status(400).json({
      success: false,
      message: 'Credits must be between 1 and 10,000'
    });
  }

  // Validate price calculation (50 credits = $1)
  const expectedAmount = creditsNum * 0.02;
  if (Math.abs(amountNum - expectedAmount) > 0.01) {
    return res.status(400).json({
      success: false,
      message: `Invalid amount. Expected $${expectedAmount.toFixed(2)} for ${creditsNum} credits`
    });
  }

  try {
    // Find user's active plan
    const userPlan = await UserPlan.findOne({
      userId: userId,
      status: 'active',
      endDate: { $gt: new Date() }
    });

    if (!userPlan) {
      return res.status(404).json({
        success: false,
        message: 'No active plan found. Please upgrade to a plan first.'
      });
    }

    // Simply add credits to existing totalCredits
    userPlan.totalCredits += creditsNum;

    // Generate consistent transaction data
    const purchaseDate = new Date();
    const transactionId = `CREDIT_${Date.now()}_${userId.toString().slice(-6)}`;

    // Preserve original plan payment details and add credit purchase info
    if (!userPlan.paymentDetails.creditPurchases) {
      userPlan.paymentDetails.creditPurchases = [];
    }

    // Add new credit purchase to the array
    userPlan.paymentDetails.creditPurchases.push({
      amount: amountNum,
      credits: creditsNum,
      purchaseDate: purchaseDate,
      transactionId: transactionId,
      paymentMethod: 'manual',
      currency: 'USD'
    });

    // Also update lastCreditPurchase for quick reference
    userPlan.paymentDetails.lastCreditPurchase = {
      amount: amountNum,
      credits: creditsNum,
      purchaseDate: purchaseDate,
      transactionId: transactionId
    };

    await userPlan.save();

    res.status(200).json({
      success: true,
      message: `Successfully purchased ${creditsNum} credits!`,
      data: {
        creditsPurchased: creditsNum,
        totalCredits: userPlan.totalCredits,
        creditsUsed: userPlan.creditsUsed,
        remainingCredits: userPlan.totalCredits - userPlan.creditsUsed
      }
    });

  } catch (error) {
    console.error('Error purchasing credits:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to purchase credits. Please try again.'
    });
  }
});

module.exports = {
  getCreditStats,
  getCreditHistory,
  getCreditRecord,
  getCreditSummary,
  purchaseCredits
};