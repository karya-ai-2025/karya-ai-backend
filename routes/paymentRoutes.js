const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { requireCapability } = require('../middleware/orgContext');
const {
  createCashfreeOrder,
  verifyCashfreeOrder,
  updatePaymentCustomerDetails
} = require('../controllers/paymentController');

router.use(protect);

router.put('/customer-details', updatePaymentCustomerDetails);
router.post('/cashfree/create-order', requireCapability('billing.manage'), createCashfreeOrder);
router.post('/cashfree/verify-order', requireCapability('billing.manage'), verifyCashfreeOrder);

module.exports = router;
