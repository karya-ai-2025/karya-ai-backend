// utils/sendEmail.js
// Sends emails via Mailgun HTTP API — no extra packages required.

const https = require('https');
const querystring = require('querystring');
const { config } = require('../config/config');

/**
 * Send email via Mailgun REST API.
 * Requires MAILGUN_API_KEY, MAILGUN_DOMAIN, MAILGUN_FROM_EMAIL in .env
 */
const sendEmail = async (options) => {
  const apiKey  = config.mailgun.apiKey;
  const domain  = config.mailgun.domain;
  const fromEmail = config.mailgun.fromEmail;
  const fromName  = config.mailgun.fromName;

  if (!apiKey || !domain) {
    console.warn('⚠ Mailgun credentials not configured — email skipped');
    return { success: false, skipped: true };
  }

  const payload = querystring.stringify({
    from:    `${fromName} <${fromEmail}>`,
    to:      options.to,
    subject: options.subject,
    html:    options.html,
    text:    options.text || options.html.replace(/<[^>]*>/g, ''),
    // Replies go to the original sender (e.g. a user contacting support)
    ...(options.replyTo ? { 'h:Reply-To': options.replyTo } : {}),
  });

  const auth = Buffer.from(`api:${apiKey}`).toString('base64');

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.mailgun.net',
        path:     `/v3/${domain}/messages`,
        method:   'POST',
        headers:  {
          Authorization:  `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const parsed = JSON.parse(body);
            console.log(`📧 Email sent via Mailgun: ${parsed.id || parsed.message}`);
            resolve({ success: true, id: parsed.id });
          } else {
            console.error(`❌ Mailgun error ${res.statusCode}: ${body}`);
            reject(new Error(`Mailgun error ${res.statusCode}: ${body}`));
          }
        });
      }
    );

    req.on('error', (err) => {
      console.error('❌ Mailgun request failed:', err.message);
      reject(err);
    });

    req.write(payload);
    req.end();
  });
};

// ============================================
// EMAIL TEMPLATES
// ============================================

const baseTemplate = (content) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Karya-AI</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 0;
      background-color: #f5f5f5;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 40px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
    .logo {
      text-align: center;
      margin-bottom: 30px;
    }
    .logo-text {
      font-size: 28px;
      font-weight: bold;
      background: linear-gradient(135deg, #8B5CF6, #EC4899);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .button {
      display: inline-block;
      padding: 14px 32px;
      background: linear-gradient(135deg, #8B5CF6, #EC4899);
      color: white !important;
      text-decoration: none;
      border-radius: 12px;
      font-weight: 600;
      margin: 20px 0;
    }
    .footer {
      text-align: center;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #eee;
      color: #888;
      font-size: 14px;
    }
    .code {
      font-size: 32px;
      font-weight: bold;
      letter-spacing: 8px;
      color: #8B5CF6;
      text-align: center;
      padding: 20px;
      background: #f8f5ff;
      border-radius: 12px;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="logo">
        <span class="logo-text">Karya-AI</span>
      </div>
      ${content}
      <div class="footer">
        <p>© ${new Date().getFullYear()} Karya-AI. All rights reserved.</p>
        <p>If you didn't request this email, you can safely ignore it.</p>
      </div>
    </div>
  </div>
</body>
</html>
`;

const welcomeEmailTemplate = (name) => baseTemplate(`
  <h1 style="color: #1a1a1a; margin-bottom: 20px;">Welcome to Karya-AI, ${name}! 🎉</h1>
  <p>We're thrilled to have you on board. You've just joined the smartest way to grow your business with AI-powered marketing.</p>
  <p>Here's what you can do next:</p>
  <ul style="padding-left: 20px;">
    <li>Complete your profile setup</li>
    <li>Explore our expert marketplace</li>
    <li>Create your first AI-powered marketing roadmap</li>
  </ul>
  <div style="text-align: center;">
    <a href="${config.frontendUrl}" class="button">Get Started</a>
  </div>
  <p>Need help? Our support team is always here for you.</p>
`);

const emailVerificationTemplate = (name, verificationUrl) => baseTemplate(`
  <h1 style="color: #1a1a1a; margin-bottom: 20px;">Verify Your Email</h1>
  <p>Hi ${name},</p>
  <p>Thanks for signing up! Please verify your email address by clicking the button below:</p>
  <div style="text-align: center;">
    <a href="${verificationUrl}" class="button">Verify Email</a>
  </div>
  <p>Or copy and paste this link in your browser:</p>
  <p style="word-break: break-all; color: #8B5CF6; font-size: 14px;">${verificationUrl}</p>
  <p><strong>This link will expire in 24 hours.</strong></p>
`);

const passwordResetTemplate = (name, resetUrl) => baseTemplate(`
  <h1 style="color: #1a1a1a; margin-bottom: 20px;">Reset Your Password</h1>
  <p>Hi ${name},</p>
  <p>We received a request to reset your password. Click the button below to create a new password:</p>
  <div style="text-align: center;">
    <a href="${resetUrl}" class="button">Reset Password</a>
  </div>
  <p>Or copy and paste this link in your browser:</p>
  <p style="word-break: break-all; color: #8B5CF6; font-size: 14px;">${resetUrl}</p>
  <p><strong>This link will expire in 10 minutes.</strong></p>
  <p>If you didn't request a password reset, please ignore this email or contact support if you have concerns.</p>
`);

const passwordChangedTemplate = (name) => baseTemplate(`
  <h1 style="color: #1a1a1a; margin-bottom: 20px;">Password Changed Successfully</h1>
  <p>Hi ${name},</p>
  <p>Your password has been successfully changed.</p>
  <p>If you did not make this change, please contact our support team immediately.</p>
  <div style="text-align: center;">
    <a href="${config.frontendUrl}/login" class="button">Login Now</a>
  </div>
`);

const otpTemplate = (name, otp) => baseTemplate(`
  <h1 style="color: #1a1a1a; margin-bottom: 20px;">Your Verification Code</h1>
  <p>Hi ${name},</p>
  <p>Use this code to verify your account:</p>
  <div class="code">${otp}</div>
  <p><strong>This code will expire in 10 minutes.</strong></p>
  <p>Don't share this code with anyone.</p>
`);

const scheduleCallConfirmationTemplate = (name, dateTime, timezone, meetLink) => {
  const formattedDate = new Date(dateTime).toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: timezone,
  });
  const formattedTime = new Date(dateTime).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short', timeZone: timezone,
  });

  const meetSection = meetLink
    ? `<div style="text-align:center;">
        <a href="${meetLink}" class="button">Join Google Meet</a>
       </div>
       <p style="word-break:break-all;color:#8B5CF6;font-size:14px;text-align:center;">${meetLink}</p>`
    : `<p style="background:#f8f5ff;border-radius:12px;padding:16px;text-align:center;color:#555;">
        The Google Meet link will be sent to you shortly once confirmed by our team.
       </p>`;

  return baseTemplate(`
    <h1 style="color:#1a1a1a;margin-bottom:20px;">Your Meeting is Booked! 🎉</h1>
    <p>Hi ${name},</p>
    <p>Your meeting with <strong>Karya-AI</strong> is confirmed for the time below:</p>
    <div style="background:#f8f5ff;border-radius:12px;padding:20px;margin:20px 0;">
      <p style="margin:0 0 8px 0;"><strong>📅 Date:</strong> ${formattedDate}</p>
      <p style="margin:0;"><strong>🕐 Time:</strong> ${formattedTime}</p>
    </div>
    <p style="margin-bottom:6px;"><strong>What happens on this call?</strong></p>
    <p style="margin-top:0;">One of our experts will connect with you to get to know you and your business, understand your goals, and set up your profile <em>on your behalf</em> — so you're ready to go without any manual setup.</p>
    ${meetSection}
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin:24px 0;color:#166534;">
      🔔 We'll also send you a reminder with your meeting link <strong>2–3 hours before</strong> the call, so you have everything ready.
    </div>
    <p>Looking forward to speaking with you!</p>
  `);
};

const meetingReminderTemplate = (name, dateTime, timezone, meetLink) => {
  const formattedDate = new Date(dateTime).toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: timezone,
  });
  const formattedTime = new Date(dateTime).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short', timeZone: timezone,
  });

  return baseTemplate(`
    <h1 style="color:#1a1a1a;margin-bottom:20px;">⏰ Your Meeting Starts in 5 Minutes!</h1>
    <p>Hi ${name},</p>
    <p>Just a reminder — your Karya-AI onboarding call is starting very soon.</p>
    <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:12px;padding:20px;margin:20px 0;">
      <p style="margin:0 0 8px 0;"><strong>📅 Date:</strong> ${formattedDate}</p>
      <p style="margin:0;"><strong>🕐 Time:</strong> ${formattedTime}</p>
    </div>
    <p>Click below to join the call now:</p>
    <div style="text-align:center;">
      <a href="${meetLink}" class="button">Join Google Meet Now</a>
    </div>
    <p style="word-break:break-all;color:#8B5CF6;font-size:14px;text-align:center;">${meetLink}</p>
    <p>See you in a few minutes!</p>
  `);
};

module.exports = {
  sendEmail,
  templates: {
    welcome: welcomeEmailTemplate,
    emailVerification: emailVerificationTemplate,
    passwordReset: passwordResetTemplate,
    passwordChanged: passwordChangedTemplate,
    otp: otpTemplate,
    scheduleCallConfirmation: scheduleCallConfirmationTemplate,
    meetingReminder: meetingReminderTemplate,
  },
};
