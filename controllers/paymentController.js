const Plan = require('../models/Plan');
const PlanPackage = require('../models/PlanPackage');
const PlatformPaymentsOrder = require('../models/PlatformPaymentsOrder');
const { getCashfreeClient, getCashfreeMode, getCashfreeErrorMessage } = require('../services/cashfreeService');
const { activateUserPlanAfterPayment } = require('../services/userPlanActivationService');

const normalizePhone = (phone) => {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
};

const normalizeEmail = (email) => {
  return String(email || '').trim().toLowerCase();
};

const isValidEmail = (email) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const getFrontendUrl = () => {
  return (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
};

const applyMissingCustomerDetails = async (user, customerDetails = {}) => {
  const fullName = String(customerDetails.fullName || '').trim();
  const email = normalizeEmail(customerDetails.email);
  const phone = normalizePhone(customerDetails.phone);
  let shouldSaveUser = false;

  if (!user.fullName && fullName) {
    user.fullName = fullName;
    shouldSaveUser = true;
  }

  if (!user.email && email) {
    if (!isValidEmail(email)) {
      throw new Error('Please enter a valid email address');
    }
    user.email = email;
    shouldSaveUser = true;
  }

  if (!user.phone && phone) {
    user.phone = phone;
    shouldSaveUser = true;
  }

  if (!user.phone && customerDetails.phone && !phone) {
    throw new Error('Please enter a valid phone number');
  }

  if (shouldSaveUser) {
    await user.save();
  }

  return user;
};

const mapCashfreeOrderStatus = (orderStatus) => {
  switch (orderStatus) {
    case 'PAID':
      return 'paid';
    case 'EXPIRED':
      return 'expired';
    case 'TERMINATED':
    case 'TERMINATION_REQUESTED':
      return 'failed';
    case 'ACTIVE':
    default:
      return 'pending';
  }
};

const createPlanPackageOrder = async ({ req, payload, customerDetails }) => {
  const { planId, planPackageId } = payload || {};

  if (!planId || !planPackageId) {
    return {
      statusCode: 400,
      body: {
        success: false,
        message: 'Plan ID and Plan Package ID are required'
      }
    };
  }

  const [plan, planPackage] = await Promise.all([
    Plan.findOne({ _id: planId, isActive: true }),
    PlanPackage.findOne({ _id: planPackageId, planId, isActive: true })
  ]);

  if (!plan || !planPackage) {
    return {
      statusCode: 404,
      body: {
        success: false,
        message: 'Invalid or inactive plan package'
      }
    };
  }

  const amount = Number(planPackage.price);
  const currency = String(planPackage.currency || 'USD').trim().toUpperCase();

  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      statusCode: 400,
      body: {
        success: false,
        message: 'Selected package has an invalid payment amount'
      }
    };
  }

  const user = req.user;
  const submittedDetails = customerDetails || {};
  await applyMissingCustomerDetails(user, submittedDetails);

  const customerEmail = normalizeEmail(user.email || submittedDetails.email);
  const customerName = user.fullName || String(submittedDetails.fullName || '').trim() || customerEmail;
  let customerPhone = normalizePhone(user.phone || submittedDetails.phone);

  if (!customerEmail) {
    return {
      statusCode: 400,
      body: {
        success: false,
        message: 'Email is required before payment'
      }
    };
  }

  if (!customerPhone && getCashfreeMode() === 'sandbox') {
    customerPhone = process.env.CASHFREE_DEFAULT_CUSTOMER_PHONE || '9999999999';
  }

  if (!customerPhone) {
    return {
      statusCode: 400,
      body: {
        success: false,
        message: 'Please enter a valid phone number before payment'
      }
    };
  }

  const paymentOrder = await PlatformPaymentsOrder.create({
    userId: user._id,
    paymentType: 'plan_package',
    payload: {
      planId,
      planPackageId
    },
    amount,
    currency,
    gateway: 'cashfree',
    status: 'pending'
  });

  const cashfreeOrderId = `karya_${paymentOrder._id.toString()}`;
  const returnUrl = `${getFrontendUrl()}/settings?section=billing&order_id={order_id}`;

  const request = {
    order_id: cashfreeOrderId,
    order_amount: amount,
    order_currency: currency,
    customer_details: {
      customer_id: user._id.toString(),
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone
    },
    order_meta: {
      return_url: returnUrl
    },
    order_note: `${plan.displayName || 'Karya-AI'} ${planPackage.name} package`,
    order_tags: {
      paymentType: 'plan_package',
      planId: planId.toString(),
      planPackageId: planPackageId.toString()
    }
  };

  try {
    const response = await getCashfreeClient().PGCreateOrder(request);
    const orderData = response.data;

    paymentOrder.cashfreeOrderId = orderData.order_id || cashfreeOrderId;
    paymentOrder.cashfreeCfOrderId = orderData.cf_order_id;
    paymentOrder.paymentSessionId = orderData.payment_session_id;
    paymentOrder.gatewayOrderResponse = orderData;
    await paymentOrder.save();

    return {
      statusCode: 201,
      body: {
        success: true,
        data: {
          paymentOrderId: paymentOrder._id,
          orderId: paymentOrder.cashfreeOrderId,
          paymentSessionId: paymentOrder.paymentSessionId,
          amount: paymentOrder.amount,
          currency: paymentOrder.currency,
          mode: getCashfreeMode()
        }
      }
    };
  } catch (error) {
    paymentOrder.status = 'failed';
    paymentOrder.cashfreeOrderId = cashfreeOrderId;
    paymentOrder.errorMessage = getCashfreeErrorMessage(error);
    paymentOrder.gatewayOrderResponse = error?.response?.data;
    await paymentOrder.save();

    return {
      statusCode: 502,
      body: {
        success: false,
        message: paymentOrder.errorMessage
      }
    };
  }
};

const updatePaymentCustomerDetails = async (req, res) => {
  try {
    await applyMissingCustomerDetails(req.user, req.body || {});

    return res.status(200).json({
      success: true,
      message: 'Customer details updated',
      user: req.user
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || 'Failed to update customer details'
    });
  }
};

const createCashfreeOrder = async (req, res) => {
  try {
    const { paymentType, payload, customerDetails } = req.body;

    if (paymentType !== 'plan_package') {
      return res.status(400).json({
        success: false,
        message: 'Unsupported payment type'
      });
    }

    const result = await createPlanPackageOrder({ req, payload, customerDetails });
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    console.error('Error creating Cashfree order:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create payment order',
      error: error.message
    });
  }
};

const fulfillPaidOrder = async (paymentOrder, cashfreeOrder) => {
  if (paymentOrder.fulfilled && paymentOrder.userPlanId) {
    return paymentOrder.userPlanId;
  }

  if (paymentOrder.paymentType !== 'plan_package') {
    throw new Error('Unsupported payment fulfillment type');
  }

  const planPackage = await PlanPackage.findOne({
    _id: paymentOrder.payload.planPackageId,
    planId: paymentOrder.payload.planId
  });

  if (!planPackage) {
    throw new Error('Plan package not found for paid order');
  }

  const userPlan = await activateUserPlanAfterPayment({
    userId: paymentOrder.userId,
    planId: paymentOrder.payload.planId,
    planPackageId: paymentOrder.payload.planPackageId,
    planPackage,
    paymentDetails: {
      amount: paymentOrder.amount,
      currency: paymentOrder.currency,
      paymentMethod: 'cashfree',
      transactionId: paymentOrder.cashfreeOrderId,
      cashfreeOrderId: paymentOrder.cashfreeOrderId,
      cashfreeCfOrderId: cashfreeOrder.cf_order_id,
      cashfreePaymentStatus: cashfreeOrder.order_status
    }
  });

  paymentOrder.fulfilled = true;
  paymentOrder.fulfilledAt = new Date();
  paymentOrder.userPlanId = userPlan._id;
  await paymentOrder.save();

  return userPlan;
};

const verifyCashfreeOrder = async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'Order ID is required'
      });
    }

    const paymentOrder = await PlatformPaymentsOrder.findOne({
      cashfreeOrderId: orderId,
      userId: req.user._id
    });

    if (!paymentOrder) {
      return res.status(404).json({
        success: false,
        message: 'Payment order not found'
      });
    }

    const response = await getCashfreeClient().PGFetchOrder(orderId);
    const cashfreeOrder = response.data;
    const status = mapCashfreeOrderStatus(cashfreeOrder.order_status);

    paymentOrder.status = status;
    paymentOrder.cashfreeCfOrderId = cashfreeOrder.cf_order_id || paymentOrder.cashfreeCfOrderId;
    paymentOrder.gatewayVerifyResponse = cashfreeOrder;

    const verifiedAmount = Number(cashfreeOrder.order_amount);
    if (
      status === 'paid' &&
      (cashfreeOrder.order_currency !== paymentOrder.currency ||
        !Number.isFinite(verifiedAmount) ||
        Math.abs(verifiedAmount - paymentOrder.amount) > 0.01)
    ) {
      paymentOrder.status = 'failed';
      paymentOrder.errorMessage = 'Cashfree order amount or currency mismatch';
      await paymentOrder.save();

      return res.status(400).json({
        success: false,
        message: paymentOrder.errorMessage
      });
    }

    let userPlan = null;
    if (status === 'paid') {
      userPlan = await fulfillPaidOrder(paymentOrder, cashfreeOrder);
    } else {
      await paymentOrder.save();
    }

    return res.status(200).json({
      success: true,
      data: {
        orderId: paymentOrder.cashfreeOrderId,
        status: paymentOrder.status,
        fulfilled: paymentOrder.fulfilled,
        userPlan,
        cashfreeOrder
      }
    });
  } catch (error) {
    console.error('Error verifying Cashfree order:', error);
    return res.status(500).json({
      success: false,
      message: getCashfreeErrorMessage(error),
      error: error.message
    });
  }
};

module.exports = {
  createCashfreeOrder,
  verifyCashfreeOrder,
  updatePaymentCustomerDetails
};
