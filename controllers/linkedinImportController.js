// controllers/linkedinImportController.js
// "Import from LinkedIn" — pulls the profile data a member agrees to share
// through LinkedIn's Member Data Portability API into their expert profile.
//
// Flow:
//   1. POST /api/profiles/expert/linkedin-import/start (logged in) → LinkedIn consent URL
//   2. Member approves on LinkedIn → GET /api/auth/linkedin/import/callback,
//      which only forwards ?code&state to the frontend at /auth/linkedin/import
//   3. Frontend POSTs them to /api/profiles/expert/linkedin-import/complete
//      (logged in). The state is a signed token naming the user who started the
//      flow, so a consent can't be completed into someone else's account.
// The LinkedIn access token is used once for the import and never stored.

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ExpertProfile = require('../models/ExpertProfile');
const LinkedInImport = require('../models/LinkedInImport');
const portability = require('../services/linkedinPortabilityService');
const { config } = require('../config/config');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

const STATE_PURPOSE = 'linkedin-import';
const FRONTEND_PATH = '/auth/linkedin/import';
const CANCEL_ERRORS = ['user_cancelled_login', 'user_cancelled_authorize', 'access_denied'];

const allowedOrigin = (value) => {
  try {
    const origin = new URL(value).origin;
    return config.frontendOrigins.includes(origin) ? origin : null;
  } catch {
    return null;
  }
};

const signState = (userId, returnTo) =>
  jwt.sign(
    { uid: String(userId), rt: returnTo, purpose: STATE_PURPOSE, nonce: crypto.randomBytes(8).toString('hex') },
    config.jwt.secret,
    { expiresIn: '10m' }
  );

const verifyState = (state) => {
  try {
    const payload = jwt.verify(String(state || ''), config.jwt.secret);
    return payload.purpose === STATE_PURPOSE ? payload : null;
  } catch {
    return null;
  }
};

const summarize = (record) => ({
  importedAt: record.importedAt,
  counts: record.counts,
  failedDomains: record.failedDomains,
  applied: record.applied
});

/**
 * @desc    Get the LinkedIn consent URL for importing profile data
 * @route   POST /api/profiles/expert/linkedin-import/start
 * @access  Private
 */
const startLinkedInImport = asyncHandler(async (req, res, next) => {
  if (!portability.isConfigured()) {
    return next(new AppError('LinkedIn import is not available right now', 503));
  }
  if (!req.user.hasExpertProfile) {
    return next(new AppError('You don\'t have an Expert profile yet', 404));
  }

  const returnTo = allowedOrigin(req.headers.origin) || config.frontendUrl;
  const state = signState(req.user._id, returnTo);

  res.status(200).json({
    success: true,
    url: portability.buildAuthorizeUrl(state)
  });
});

/**
 * @desc    LinkedIn redirects here after consent — hand the code to the frontend
 * @route   GET /api/auth/linkedin/import/callback
 * @access  Public
 */
const linkedInImportCallback = (req, res) => {
  const { code, state, error } = req.query;
  const payload = verifyState(state);
  const target = `${allowedOrigin(payload?.rt) || config.frontendUrl}${FRONTEND_PATH}`;

  const params = new URLSearchParams();
  if (error) {
    // LinkedIn refuses this permission for members outside the EEA
    params.set('error', CANCEL_ERRORS.includes(error) ? 'cancelled' : error === 'unauthorized_scope_error' ? 'not_available' : 'denied');
  } else if (!payload || typeof code !== 'string' || !code) {
    params.set('error', 'invalid_state');
  } else {
    params.set('code', code);
    params.set('state', String(state));
  }

  res.redirect(`${target}?${params.toString()}`);
};

/**
 * @desc    Exchange the consent code, fetch the member's data and merge it in
 * @route   POST /api/profiles/expert/linkedin-import/complete
 * @access  Private
 */
const completeLinkedInImport = asyncHandler(async (req, res, next) => {
  const { code, state } = req.body || {};

  if (!portability.isConfigured()) {
    return next(new AppError('LinkedIn import is not available right now', 503));
  }

  const payload = verifyState(state);
  if (!payload || typeof code !== 'string' || !code) {
    return next(new AppError('Your LinkedIn authorization expired. Please try again.', 400));
  }
  if (payload.uid !== String(req.user._id)) {
    return next(new AppError('This LinkedIn authorization was started from a different account.', 403));
  }

  const user = await User.findById(req.user._id);
  const profile = user.hasExpertProfile ? await ExpertProfile.findById(user.profiles.expert) : null;
  if (!profile) {
    return next(new AppError('You don\'t have an Expert profile yet', 404));
  }

  let snapshot;
  try {
    const accessToken = await portability.exchangeCodeForAccessToken(code);
    snapshot = await portability.fetchSnapshot(accessToken);
  } catch (err) {
    console.error('LinkedIn import failed:', err.message);
    return next(new AppError('We could not fetch your data from LinkedIn. Please try again.', 502));
  }

  const applied = portability.applySnapshotToProfile(profile, snapshot.domains);
  await profile.save();

  const record = await LinkedInImport.findOneAndUpdate(
    { user: user._id },
    { ...snapshot, applied, importedAt: new Date() },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );

  res.status(200).json({
    success: true,
    message: 'LinkedIn data imported',
    import: summarize(record),
    profile
  });
});

/**
 * @desc    Summary of the last LinkedIn import (no raw data)
 * @route   GET /api/profiles/expert/linkedin-import
 * @access  Private
 */
const getLinkedInImport = asyncHandler(async (req, res) => {
  const record = await LinkedInImport.findOne({ user: req.user._id }).select('-domains');

  res.status(200).json({
    success: true,
    available: portability.isConfigured(),
    import: record ? summarize(record) : null
  });
});

/**
 * @desc    Delete the stored raw LinkedIn data (profile entries already added stay)
 * @route   DELETE /api/profiles/expert/linkedin-import
 * @access  Private
 */
const deleteLinkedInImport = asyncHandler(async (req, res) => {
  await LinkedInImport.deleteOne({ user: req.user._id });

  res.status(200).json({
    success: true,
    message: 'Stored LinkedIn data deleted'
  });
});

module.exports = {
  startLinkedInImport,
  linkedInImportCallback,
  completeLinkedInImport,
  getLinkedInImport,
  deleteLinkedInImport
};
