const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { config } = require('../config/config');

const userSchema = new mongoose.Schema(
  {
    // Basic Info
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [50, 'Name cannot exceed 50 characters']
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        'Please provide a valid email address'
      ]
    },
    phone: {
      type: String,
      trim: true,
      match: [
        /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/,
        'Please provide a valid phone number'
      ]
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false
    },

    // Multi-profile system
    activeRole: {
      type: String,
      enum: {
        values: ['owner', 'expert', 'admin'],
        message: 'Role must be owner, expert, or admin'
      },
      default: 'owner'
    },
    profiles: {
      owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'BusinessProfile',
        default: null
      },
      expert: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ExpertProfile',
        default: null
      }
    },
    hasOwnerProfile: {
      type: Boolean,
      default: false
    },
    hasExpertProfile: {
      type: Boolean,
      default: false
    },

    // Onboarding tracking
    onboarding: {
      owner: {
        currentStep: { type: Number, default: 0 },
        completed: { type: Boolean, default: false }
      },
      expert: {
        currentStep: { type: Number, default: 0 },
        completed: { type: Boolean, default: false }
      }
    },

    // Profile
    avatar: {
      type: String,
      default: null
    },

    // Account Status
    isEmailVerified: {
      type: Boolean,
      default: false
    },
    isPhoneVerified: {
      type: Boolean,
      default: false
    },
    isActive: {
      type: Boolean,
      default: true
    },
    isOnboardingComplete: {
      type: Boolean,
      default: false
    },

    // Social Login
    socialLogins: {
      google: {
        id: String,
        email: String
      },
      linkedin: {
        id: String,
        email: String
      }
    },

    // Security
    passwordChangedAt: Date,
    passwordResetToken: String,
    passwordResetExpires: Date,
    emailVerificationToken: String,
    emailVerificationExpires: Date,

    // ── Email OTP ────────────────────────────────────────────────────────
    // A 6-digit code emailed at registration. Stored hashed, never in plain
    // text — a leaked database row must not let someone verify an account.
    emailOtpHash: { type: String, select: false },
    emailOtpExpires: { type: Date, select: false },
    // Six digits is only a million combinations, so wrong guesses are counted
    // and the code is burned after a handful.
    emailOtpAttempts: { type: Number, default: 0, select: false },
    // Enforces the resend cooldown, so the endpoint can't be used to spam
    // someone's inbox.
    emailOtpLastSentAt: { type: Date, select: false },

    // Login tracking
    lastLogin: Date,
    loginAttempts: {
      type: Number,
      default: 0
    },
    lockUntil: Date,

    // Preferences
    preferences: {
      emailNotifications: { type: Boolean, default: true },
      smsNotifications: { type: Boolean, default: false },
      marketingEmails: { type: Boolean, default: true }
    },

    // Admin access — independent of activeRole so normal platform usage is unaffected
    isAdmin: { type: Boolean, default: false },

    // ── Organization context ──────────────────────────────────────────────
    // Which org this user was last acting in, so a returning session lands
    // where they left off.
    //
    // Deliberately NOT "the user's organization": a person can belong to
    // several (an expert hired by three clients is one account with three
    // memberships). The real link lives in the Membership collection, and
    // this is only a convenience — it is always re-checked against an active
    // membership before it is trusted.
    lastActiveOrgId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes for better query performance (email index already created by unique: true)
userSchema.index({ activeRole: 1 });
userSchema.index({ createdAt: -1 });

// Virtual for checking if account is locked
userSchema.virtual('isLocked').get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Virtual for available roles
userSchema.virtual('availableRoles').get(function () {
  const roles = [];
  if (this.hasOwnerProfile) roles.push('owner');
  if (this.hasExpertProfile) roles.push('expert');
  return roles;
});

// Pre-save middleware: Hash password
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);

  if (!this.isNew) {
    this.passwordChangedAt = Date.now() - 1000;
  }
});

// Method: Compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method: Generate JWT token
userSchema.methods.generateAuthToken = function () {
  return jwt.sign(
    {
      id: this._id,
      email: this.email,
      role: this.activeRole
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expire }
  );
};

// Method: Check if password changed after token was issued
userSchema.methods.changedPasswordAfter = function (jwtTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return jwtTimestamp < changedTimestamp;
  }
  return false;
};

// Method: Generate password reset token
userSchema.methods.generatePasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');

  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  this.passwordResetExpires = Date.now() + 10 * 60 * 1000;

  return resetToken;
};

// ── Email OTP ─────────────────────────────────────────────────────────────

const OTP_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1000;   // matches the wording in the OTP email
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * Create a fresh 6-digit code, store its hash, and return the plain code for
 * emailing. Uses crypto.randomInt rather than Math.random — a predictable code
 * is a guessable one.
 */
userSchema.methods.generateEmailOtp = function () {
  const max = 10 ** OTP_LENGTH;
  const otp = String(crypto.randomInt(0, max)).padStart(OTP_LENGTH, '0');

  this.emailOtpHash = crypto.createHash('sha256').update(otp).digest('hex');
  this.emailOtpExpires = Date.now() + OTP_TTL_MS;
  this.emailOtpAttempts = 0;
  this.emailOtpLastSentAt = new Date();

  return otp;
};

/**
 * Check a submitted code.
 * Returns { ok, reason } — the reason is safe to show the user, and never says
 * anything that would help someone guess.
 */
userSchema.methods.verifyEmailOtp = function (submitted) {
  if (!this.emailOtpHash || !this.emailOtpExpires) {
    return { ok: false, reason: 'No verification code has been requested' };
  }
  if (this.emailOtpExpires.getTime() < Date.now()) {
    return { ok: false, reason: 'This code has expired. Request a new one.' };
  }
  if ((this.emailOtpAttempts || 0) >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: 'Too many incorrect attempts. Request a new code.' };
  }

  const hash = crypto.createHash('sha256').update(String(submitted).trim()).digest('hex');
  const a = Buffer.from(hash, 'utf8');
  const b = Buffer.from(this.emailOtpHash, 'utf8');
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!match) {
    this.emailOtpAttempts = (this.emailOtpAttempts || 0) + 1;
    const left = OTP_MAX_ATTEMPTS - this.emailOtpAttempts;
    return {
      ok: false,
      reason: left > 0
        ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} remaining.`
        : 'Too many incorrect attempts. Request a new code.',
    };
  }

  return { ok: true };
};

/** Clear the code once it has been used, so it can never be replayed. */
userSchema.methods.clearEmailOtp = function () {
  this.emailOtpHash = undefined;
  this.emailOtpExpires = undefined;
  this.emailOtpAttempts = 0;
};

/** Seconds left on the resend cooldown; 0 when a resend is allowed. */
userSchema.methods.otpResendWaitSeconds = function () {
  if (!this.emailOtpLastSentAt) return 0;
  const elapsed = Date.now() - this.emailOtpLastSentAt.getTime();
  const left = OTP_RESEND_COOLDOWN_MS - elapsed;
  return left > 0 ? Math.ceil(left / 1000) : 0;
};

userSchema.statics.OTP_TTL_MS = OTP_TTL_MS;
userSchema.statics.OTP_MAX_ATTEMPTS = OTP_MAX_ATTEMPTS;

// Method: Generate email verification token
userSchema.methods.generateEmailVerificationToken = function () {
  const verificationToken = crypto.randomBytes(32).toString('hex');

  this.emailVerificationToken = crypto
    .createHash('sha256')
    .update(verificationToken)
    .digest('hex');

  this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;

  return verificationToken;
};

// Method: Increment login attempts
userSchema.methods.incLoginAttempts = async function () {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 }
    });
  }

  const updates = { $inc: { loginAttempts: 1 } };

  if (this.loginAttempts + 1 >= 5 && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 };
  }

  return this.updateOne(updates);
};

// Method: Reset login attempts on successful login
userSchema.methods.resetLoginAttempts = function () {
  return this.updateOne({
    $set: { loginAttempts: 0, lastLogin: new Date() },
    $unset: { lockUntil: 1 }
  });
};

// Static: Find by credentials
userSchema.statics.findByCredentials = async function (email, password) {
  const user = await this.findOne({ email }).select('+password');

  if (!user) {
    throw new Error('Invalid email or password');
  }

  if (user.isLocked) {
    throw new Error('Account is temporarily locked. Please try again later.');
  }

  if (!user.isActive) {
    throw new Error('Account has been deactivated. Please contact support.');
  }

  const isMatch = await user.comparePassword(password);

  if (!isMatch) {
    await user.incLoginAttempts();
    throw new Error('Invalid email or password');
  }

  await user.resetLoginAttempts();

  return user;
};

// Transform output (remove sensitive fields)
userSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.password;
  delete user.passwordResetToken;
  delete user.passwordResetExpires;
  delete user.emailVerificationToken;
  delete user.emailVerificationExpires;
  delete user.loginAttempts;
  delete user.lockUntil;
  delete user.__v;
  return user;
};

const User = mongoose.model('User', userSchema);

module.exports = User;
