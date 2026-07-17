// controllers/supportController.js
// Support contact emails (max 3 per expert) + status-update subscriptions.

const User = require('../models/User');
const ExpertProfile = require('../models/ExpertProfile');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { sendEmail } = require('../utils/sendEmail');

const SUPPORT_INBOX = 'ashish@karya-ai.com';
const MAX_SUPPORT_EMAILS = 3;

// Resolve the caller's ExpertProfile (where the counter/subscription live).
async function getProfile(userId) {
  const user = await User.findById(userId);
  if (!user?.hasExpertProfile || !user.profiles?.expert) return { user, profile: null };
  const profile = await ExpertProfile.findById(user.profiles.expert);
  return { user, profile };
}

/**
 * GET /api/support/status
 * Returns how many support emails the user has left + subscription state.
 */
const getSupportStatus = asyncHandler(async (req, res) => {
  const { profile } = await getProfile(req.user._id);
  const sent = profile?.support?.emailsSent || 0;
  res.json({
    success: true,
    data: {
      emailsSent: sent,
      remaining: Math.max(0, MAX_SUPPORT_EMAILS - sent),
      limit: MAX_SUPPORT_EMAILS,
      subscribed: !!profile?.support?.subscribed,
    },
  });
});

/**
 * POST /api/support/contact
 * Sends the user's message to the support inbox. Reply-To is the user's email
 * (Mailgun can't send FROM arbitrary addresses — domain must be verified —
 * so replies still go straight back to the user). Max 3 emails per expert.
 */
const sendSupportEmail = asyncHandler(async (req, res, next) => {
  const { name = '', email = '', subject = '', message = '', priority = 'normal' } = req.body;

  if (!email.trim() || !subject.trim() || !message.trim()) {
    return next(new AppError('Email, subject and message are required', 400));
  }

  const { user, profile } = await getProfile(req.user._id);

  // Enforce the 3-email limit (tracked on the expert profile)
  const sent = profile?.support?.emailsSent || 0;
  if (profile && sent >= MAX_SUPPORT_EMAILS) {
    return next(new AppError(`You have reached the limit of ${MAX_SUPPORT_EMAILS} support emails. Please call us instead.`, 429));
  }

  const html = `
    <h2 style="margin:0 0 12px 0;">New support message${priority === 'urgent' ? ' — 🔴 URGENT' : ''}</h2>
    <p><strong>From:</strong> ${name || user?.fullName || 'Unknown'} &lt;${email}&gt;</p>
    <p><strong>Account:</strong> ${user?.email || '—'} (${user?.activeRole || 'user'})</p>
    <p><strong>Subject:</strong> ${subject}</p>
    <hr style="border:none;border-top:1px solid #eee;margin:16px 0;">
    <p style="white-space:pre-wrap;">${message}</p>
  `;

  try {
    await sendEmail({
      to: SUPPORT_INBOX,
      subject: `[Support${priority === 'urgent' ? ' · URGENT' : ''}] ${subject}`,
      html,
      replyTo: email.trim(),
    });
  } catch (err) {
    console.error('Support email failed:', err.message);
    return next(new AppError('Could not send your message right now. Please try again or call us.', 502));
  }

  // Count it (only after a successful send)
  if (profile) {
    profile.support = profile.support || {};
    profile.support.emailsSent = sent + 1;
    await profile.save({ validateBeforeSave: false });
  }

  res.json({
    success: true,
    message: 'Message sent to our support team',
    remaining: profile ? Math.max(0, MAX_SUPPORT_EMAILS - (sent + 1)) : null,
  });
});

/**
 * POST /api/support/subscribe
 * Stores the status-updates subscription on the expert profile.
 */
const subscribeToUpdates = asyncHandler(async (req, res, next) => {
  const { email = '' } = req.body;
  if (!email.trim()) return next(new AppError('Email is required', 400));

  const { profile } = await getProfile(req.user._id);
  if (!profile) return next(new AppError('Expert profile not found', 404));

  profile.support = profile.support || {};
  profile.support.subscribed = true;
  profile.support.subscribeEmail = email.trim().toLowerCase();
  profile.support.subscribedAt = new Date();
  await profile.save({ validateBeforeSave: false });

  res.json({ success: true, message: 'Subscribed to updates' });
});

module.exports = { getSupportStatus, sendSupportEmail, subscribeToUpdates };
