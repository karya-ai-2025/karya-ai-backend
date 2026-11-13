// controllers/socialAuthController.js
// Sign in with LinkedIn / Google (OpenID Connect) for business owners and experts.
//
// Flow (same for every provider):
//   1. Browser navigates to GET /api/auth/<provider>[?role=owner|expert] → redirected
//      to the provider's consent screen.
//   2. The provider redirects to GET /api/auth/<provider>/callback?code=…&state=…
//   3. We exchange the code, read the member's OIDC profile, find or create the
//      user (with a profile for the role they signed in as), then redirect to the
//      frontend (whichever allowed origin started the flow) at
//      /auth/<provider>/callback#token=<jwt>&role=<role>[&new=1][&onboard=1].
//      new = account just created; onboard = expert profile just created, so the
//      member still has onboarding ahead. Failures redirect to the same page with
//      ?error=<code>.

const crypto = require('crypto');
const User = require('../models/User');
const BusinessProfile = require('../models/BusinessProfile');
const ExpertProfile = require('../models/ExpertProfile');
const { EXPERT_FLOW_ENABLED, isBlockedExpert, moveOffExpertRole } = require('../config/featureFlags');
const { foundOrganization } = require('../services/organizationSetup');
const { config } = require('../config/config');
const { sendEmail, templates } = require('../utils/sendEmail');

const PROVIDERS = {
  linkedin: {
    authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    userinfoUrl: 'https://api.linkedin.com/v2/userinfo',
    authorizeParams: {}
  },
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    // Always show the account chooser — people often have several Google accounts
    authorizeParams: { prompt: 'select_account' }
  }
};
const SCOPE = 'openid profile email';
const STATE_COOKIE = 'oauth_state';
const RETURN_COOKIE = 'oauth_return';
const ROLE_COOKIE = 'oauth_role';
// Which page the sign-in started from, so the account kinds never mix:
//   login    → existing accounts only; signs each into its own app, creates nothing
//   business → the business signup page: may create a business account
//   partner  → the agency / expert signup page: may create a partner account
const INTENT_COOKIE = 'oauth_intent';
const INTENTS = ['login', 'business', 'partner'];
// Expert flow switched off (config/featureFlags.js): only the business side can be asked for
const ROLES = EXPERT_FLOW_ENABLED ? ['owner', 'expert'] : ['owner'];
const DEFAULT_ROLE = EXPERT_FLOW_ENABLED ? config.socialLoginDefaultRole : 'owner';
const CANCEL_ERRORS = ['user_cancelled_login', 'user_cancelled_authorize', 'access_denied'];

// Lax (not strict) so the cookies are sent on the top-level redirect back from the provider.
// Scoped per provider so two flows in different tabs can't clobber each other.
const flowCookieOptions = (provider) => ({
  httpOnly: true,
  secure: config.env === 'production',
  sameSite: 'lax',
  path: `/api/auth/${provider}`
});

// The frontend that started the flow gets the
// redirect back; anything not on the allowlist falls back to config.frontendUrl.
const allowedOrigin = (value) => {
  try {
    const origin = new URL(value).origin;
    return config.frontendOrigins.includes(origin) ? origin : null;
  } catch {
    return null;
  }
};

const safeEqual = (a, b) => {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
};

// fullName must be 2–50 chars on the User schema
const buildFullName = (profile, email) => {
  const name = (profile.name || [profile.given_name, profile.family_name].filter(Boolean).join(' ')).trim();
  const fallback = email.split('@')[0];
  return (name.length >= 2 ? name : fallback.padEnd(2, '_')).slice(0, 50);
};

// Returns true when a profile had to be created for the role
const ensureProfile = async (user, role) => {
  if (role === 'expert') {
    if (user.hasExpertProfile && user.profiles?.expert) return false;

    const expertProfile = await ExpertProfile.create({
      user: user._id,
      profileStatus: { joinedAsExpert: new Date() }
    });

    user.profiles.expert = expertProfile._id;
    user.hasExpertProfile = true;
    return true;
  }

  if (user.hasOwnerProfile && user.profiles?.owner) return false;

  const businessProfile = await BusinessProfile.create({
    user: user._id,
    company: { name: `${user.fullName}'s Company` }
  });

  user.profiles.owner = businessProfile._id;
  user.hasOwnerProfile = true;
  return true;
};

/**
 * Build the { start, callback } route handlers for one provider.
 * @route   GET /api/auth/<provider>            (start)
 * @route   GET /api/auth/<provider>/callback   (callback)
 * @access  Public
 */
const createHandlers = (provider) => {
  const endpoints = PROVIDERS[provider];
  const credentials = config[provider];
  const cookieOptions = flowCookieOptions(provider);

  const isConfigured = () => !!(credentials.clientId && credentials.clientSecret);

  const frontendCallback = (returnTo) =>
    `${allowedOrigin(returnTo) || config.frontendUrl}/auth/${provider}/callback`;

  const clearFlowCookies = (res) => {
    res.clearCookie(STATE_COOKIE, cookieOptions);
    res.clearCookie(RETURN_COOKIE, cookieOptions);
    res.clearCookie(ROLE_COOKIE, cookieOptions);
    res.clearCookie(INTENT_COOKIE, cookieOptions);
  };

  const redirectWithError = (res, returnTo, code) => {
    clearFlowCookies(res);
    res.redirect(`${frontendCallback(returnTo)}?error=${encodeURIComponent(code)}`);
  };

  const exchangeCodeForAccessToken = async (code) => {
    const response = await fetch(endpoints.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        redirect_uri: credentials.redirectUri
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      throw new Error(`${provider} token exchange failed (${response.status}): ${data.error_description || data.error || 'unknown error'}`);
    }
    return data.access_token;
  };

  const fetchProfile = async (accessToken) => {
    const response = await fetch(endpoints.userinfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.sub) {
      throw new Error(`${provider} userinfo failed (${response.status})`);
    }
    return data;
  };

  // Redirect to the provider's consent screen
  const start = (req, res) => {
    const returnTo = allowedOrigin(req.headers.referer);

    if (!isConfigured()) return redirectWithError(res, returnTo, 'not_configured');

    const state = crypto.randomBytes(24).toString('hex');
    const maxAge = 10 * 60 * 1000;
    res.cookie(STATE_COOKIE, state, { ...cookieOptions, maxAge });
    if (returnTo) res.cookie(RETURN_COOKIE, returnTo, { ...cookieOptions, maxAge });
    else res.clearCookie(RETURN_COOKIE, cookieOptions);

    // Which side of the platform the member is signing in to (owner / expert tab)
    if (ROLES.includes(req.query.role)) res.cookie(ROLE_COOKIE, req.query.role, { ...cookieOptions, maxAge });
    else res.clearCookie(ROLE_COOKIE, cookieOptions);

    // Login, business signup or partner signup — defaults to login, which
    // never creates an account
    const intent = INTENTS.includes(req.query.intent) ? req.query.intent : 'login';
    res.cookie(INTENT_COOKIE, intent, { ...cookieOptions, maxAge });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: credentials.clientId,
      redirect_uri: credentials.redirectUri,
      state,
      scope: SCOPE,
      ...endpoints.authorizeParams
    });

    res.redirect(`${endpoints.authorizeUrl}?${params.toString()}`);
  };

  // The provider redirects here after consent — sign the member in
  const callback = async (req, res) => {
    const returnTo = req.cookies?.[RETURN_COOKIE];
    const requestedRole = ROLES.includes(req.cookies?.[ROLE_COOKIE]) ? req.cookies[ROLE_COOKIE] : null;
    const intent = INTENTS.includes(req.cookies?.[INTENT_COOKIE]) ? req.cookies[INTENT_COOKIE] : 'login';
    const fail = (code) => redirectWithError(res, returnTo, code);

    try {
      if (!isConfigured()) return fail('not_configured');

      const { code, state, error } = req.query;

      // Member cancelled or the provider rejected the request
      if (error) return fail(CANCEL_ERRORS.includes(error) ? 'cancelled' : 'denied');

      // CSRF check — state must match the cookie set when the flow started
      const expectedState = req.cookies?.[STATE_COOKIE];
      if (!code || typeof code !== 'string' || !state || !expectedState || !safeEqual(state, expectedState)) {
        return fail('invalid_state');
      }
      clearFlowCookies(res);

      const accessToken = await exchangeCodeForAccessToken(code);
      const profile = await fetchProfile(accessToken);

      const providerId = String(profile.sub);
      const email = typeof profile.email === 'string' ? profile.email.toLowerCase().trim() : '';
      const emailVerified = profile.email_verified === true || profile.email_verified === 'true';

      let user = await User.findOne({ [`socialLogins.${provider}.id`]: providerId });
      let isNewUser = false;

      if (!user) {
        if (!email) return fail('email_required');

        const existing = await User.findOne({ email });

        if (existing) {
          // Only attach this provider to an existing account when the provider
          // vouches for the email — otherwise anyone could claim the account.
          if (!emailVerified) return fail('email_not_verified');
          user = existing;
          user.set(`socialLogins.${provider}`, { id: providerId, email });
        } else {
          // Signing in creates nothing: an unknown email has to sign up first,
          // as a business or as an agency / expert — never one by default.
          if (intent === 'login') return fail('no_account');
          isNewUser = true;
          user = new User({
            fullName: buildFullName(profile, email),
            email,
            kind: intent,
            activeRole: requestedRole || DEFAULT_ROLE,
            avatar: profile.picture || null,
            isEmailVerified: emailVerified,
            socialLogins: { [provider]: { id: providerId, email } }
          });
        }
      }

      if (!user.isActive) return fail('account_deactivated');

      // Signing up from the wrong page with an account that already exists:
      // accounts are one kind for life, so say so rather than mix them.
      if (!isNewUser && intent !== 'login' && user.kind !== intent) {
        return fail(user.kind === 'partner' ? 'account_is_partner' : 'account_is_business');
      }
      if (isBlockedExpert(user)) return fail('expert_paused');
      moveOffExpertRole(user);

      // No role asked for: new accounts get the default one, returning members stay where they were
      const role = requestedRole || user.activeRole || DEFAULT_ROLE;
      // Owner / expert profiles belong to business accounts only
      const profileCreated = user.kind === 'business' ? await ensureProfile(user, role) : false;
      if (user.kind === 'business') user.activeRole = role;
      if (emailVerified && user.email === email) user.isEmailVerified = true;
      if (!user.avatar && profile.picture) user.avatar = profile.picture;
      user.lastLogin = new Date();
      await user.save();

      // A new account founds its organization, like an email signup. The
      // provider doesn't tell us the company / agency name, so it starts from
      // the person's name and is renamed during onboarding.
      if (isNewUser && (user.kind === 'partner' || role === 'owner') && !user.organizationId) {
        try {
          // A partner starts named after themselves (an expert of one, or the
          // agency founder renames it on the welcome profile step)
          await foundOrganization(user, user.kind === 'partner' ? user.fullName : `${user.fullName}'s Company`, req);
          await user.save();
        } catch (err) {
          console.error(`${provider} signup could not create the organization, rolling back:`, err.message);
          await BusinessProfile.deleteOne({ user: user._id }).catch(() => {});
          await User.deleteOne({ _id: user._id }).catch(() => {});
          return fail('failed');
        }
      }

      if (isNewUser) {
        try {
          await sendEmail({
            to: user.email,
            subject: 'Welcome to Karya-AI! Your account has been created 🎉',
            html: templates.welcome(user.fullName)
          });
        } catch (err) {
          console.error('Failed to send welcome email:', err);
        }
      }

      const token = user.generateAuthToken();

      res.cookie('token', token, {
        expires: new Date(Date.now() + config.jwt.cookieExpire * 24 * 60 * 60 * 1000),
        httpOnly: true,
        secure: config.env === 'production',
        sameSite: config.env === 'production' ? 'strict' : 'lax',
        path: '/'
      });

      // Token goes in the URL fragment so it never reaches server logs or Referer headers
      const fragment = new URLSearchParams({
        token,
        role,
        kind: user.kind,
        ...(isNewUser ? { new: '1' } : {}),
        ...(role === 'expert' && profileCreated ? { onboard: '1' } : {})
      });
      res.redirect(`${frontendCallback(returnTo)}#${fragment.toString()}`);
    } catch (err) {
      console.error(`${provider} sign-in failed:`, err.message);
      fail('failed');
    }
  };

  return { start, callback };
};

module.exports = {
  linkedin: createHandlers('linkedin'),
  google: createHandlers('google')
};
