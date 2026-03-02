// utils/sendEmail.js
// Email sending utility with Nodemailer

const nodemailer = require('nodemailer');
const { config } = require('../config/config');

/**
 * Create email transporter
 */
const createTransporter = () => {
  // Development: Use Ethereal (fake SMTP)
  if (config.env === 'development' && !config.email.host) {
    return nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      auth: {
        user: 'ethereal.user@ethereal.email',
        pass: 'ethereal_password'
      }
    });
  }
  
  // Production: Use configured SMTP
  return nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.port === 465,
    auth: {
      user: config.email.user,
      pass: config.email.pass
    }
  });
};

/**
 * Send email
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML content
 * @param {string} options.text - Plain text content (optional)
 */
const sendEmail = async (options) => {
  try {
    const transporter = createTransporter();
    
    const mailOptions = {
      from: `${config.email.fromName} <${config.email.from}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text || options.html.replace(/<[^>]*>/g, '')
    };
    
    const info = await transporter.sendMail(mailOptions);
    
    console.log(`📧 Email sent: ${info.messageId}`);
    
    // In development, log preview URL
    if (config.env === 'development') {
      console.log(`Preview URL: ${nodemailer.getTestMessageUrl(info)}`);
    }
    
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Email sending failed:', error);
    throw new Error('Failed to send email');
  }
};

// ============================================
// EMAIL TEMPLATES
// ============================================

/**
 * Base email template
 */
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

/**
 * Welcome email template
 */
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
    <a href="${config.frontendUrl}/dashboard" class="button">Get Started</a>
  </div>
  <p>Need help? Our support team is always here for you.</p>
`);

/**
 * Email verification template
 */
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

/**
 * Password reset template
 */
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

/**
 * Password changed confirmation template
 */
const passwordChangedTemplate = (name) => baseTemplate(`
  <h1 style="color: #1a1a1a; margin-bottom: 20px;">Password Changed Successfully</h1>
  <p>Hi ${name},</p>
  <p>Your password has been successfully changed.</p>
  <p>If you did not make this change, please contact our support team immediately.</p>
  <div style="text-align: center;">
    <a href="${config.frontendUrl}/login" class="button">Login Now</a>
  </div>
`);

/**
 * OTP verification template
 */
const otpTemplate = (name, otp) => baseTemplate(`
  <h1 style="color: #1a1a1a; margin-bottom: 20px;">Your Verification Code</h1>
  <p>Hi ${name},</p>
  <p>Use this code to verify your account:</p>
  <div class="code">${otp}</div>
  <p><strong>This code will expire in 10 minutes.</strong></p>
  <p>Don't share this code with anyone.</p>
`);

// Export all
module.exports = {
  sendEmail,
  templates: {
    welcome: welcomeEmailTemplate,
    emailVerification: emailVerificationTemplate,
    passwordReset: passwordResetTemplate,
    passwordChanged: passwordChangedTemplate,
    otp: otpTemplate
  }
};