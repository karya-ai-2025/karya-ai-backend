const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  createCashfreeOrder,
  verifyCashfreeOrder,
  updatePaymentCustomerDetails
} = require('../controllers/paymentController');

router.use(protect);

router.put('/customer-details', updatePaymentCustomerDetails);
router.post('/cashfree/create-order', createCashfreeOrder);
router.post('/cashfree/verify-order', verifyCashfreeOrder);

module.exports = router;
