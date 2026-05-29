const UserPlan = require('../models/UserPlan');

const calculatePlanDates = (billingCycle) => {
  const now = new Date();
  const startDate = new Date(now);
  const endDate = new Date(now);
  let nextBillingDate = new Date(now);

  switch (billingCycle) {
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
      endDate.setFullYear(endDate.getFullYear() + 10);
      nextBillingDate = null;
      break;
    default:
      endDate.setMonth(endDate.getMonth() + 1);
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
  }

  return { now, startDate, endDate, nextBillingDate };
};

const activateUserPlanAfterPayment = async ({
  userId,
  planId,
  planPackageId,
  planPackage,
  paymentDetails
}) => {
  const existingActivePlan = await UserPlan.findOne({
    userId,
    status: 'active',
    endDate: { $gt: new Date() }
  });

  let existingProjectsCreated = 0;
  let existingCreditsUsed = 0;
  let existingTotalCredits = 0;

  if (existingActivePlan) {
    existingProjectsCreated = existingActivePlan.projectsCreated || 0;
    existingCreditsUsed = existingActivePlan.creditsUsed || 0;
    existingTotalCredits = existingActivePlan.totalCredits || 0;
  }

  await UserPlan.updateMany(
    {
      userId,
      status: 'active',
      endDate: { $gt: new Date() }
    },
    {
      status: 'cancelled',
      cancellationDate: new Date(),
      cancellationReason: 'Upgraded to new plan'
    }
  );

  const { now, startDate, endDate, nextBillingDate } = calculatePlanDates(
    planPackage.billingCycle
  );

  const userPlan = new UserPlan({
    userId,
    planId,
    planPackageId,
    status: 'active',
    purchaseDate: now,
    startDate,
    endDate,
    nextBillingDate,
    creditsUsed: existingCreditsUsed,
    totalCredits: (planPackage.credits || 0) + existingTotalCredits,
    projectsCreated: existingProjectsCreated,
    paymentDetails
  });

  await userPlan.save();
  await userPlan.populate(['planId', 'planPackageId']);

  return userPlan;
};

module.exports = {
  activateUserPlanAfterPayment,
  calculatePlanDates
};
