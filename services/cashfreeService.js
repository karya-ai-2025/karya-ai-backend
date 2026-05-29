const { Cashfree, CFEnvironment } = require('cashfree-pg');

let cashfreeClient = null;

const getCashfreeEnvironment = () => {
  const env = (process.env.CASHFREE_ENV || 'sandbox').toLowerCase();
  return env === 'production' ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX;
};

const getCashfreeMode = () => {
  const env = (process.env.CASHFREE_ENV || 'sandbox').toLowerCase();
  return env === 'production' ? 'production' : 'sandbox';
};

const getCashfreeClient = () => {
  if (cashfreeClient) return cashfreeClient;

  const clientId = process.env.CASHFREE_CLIENT_ID;
  const clientSecret = process.env.CASHFREE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Cashfree credentials are not configured');
  }

  cashfreeClient = new Cashfree(
    getCashfreeEnvironment(),
    clientId,
    clientSecret
  );

  return cashfreeClient;
};

const getCashfreeErrorMessage = (error) => {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    'Cashfree request failed'
  );
};

module.exports = {
  getCashfreeClient,
  getCashfreeMode,
  getCashfreeErrorMessage
};
