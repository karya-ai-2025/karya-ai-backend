// Purchase guard — buying projects, upgrading plans, and buying credits are
// DISABLED until a live payment gateway is in place. This exists because those
// flows currently grant everything for free (a testing bypass) and we now have
// real users.
//
// To RE-ENABLE all purchases: set  PURCHASES_ENABLED=true  in the environment
// (Azure App Settings / .env) and restart. No code change needed.

const purchasesEnabled = () => process.env.PURCHASES_ENABLED === 'true';

// Route middleware: block a request outright when purchases are disabled.
const blockPurchases = (req, res, next) => {
  if (purchasesEnabled()) return next();
  return res.status(403).json({
    success: false,
    code: 'PURCHASES_DISABLED',
    message: 'Purchases are temporarily unavailable. Please check back soon.',
  });
};

module.exports = { purchasesEnabled, blockPurchases };
