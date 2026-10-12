const mongoose = require('mongoose');

/**
 * Global email-validation cache.
 *
 * One row per unique email address — NOT per list or per user. Validity is a
 * property of the email itself, so caching it here means the same address is
 * never re-sent to NeverBounce (and never re-charged) across any list, upload,
 * campaign, or user. Results are treated as fresh for EMAIL_VALIDATION_TTL_DAYS
 * (default 90); older ones are re-validated.
 *
 * Lookups are always done in batches via { email: { $in: [...] } }, and `email`
 * is uniquely indexed, so this stays fast even at millions of rows.
 */
const emailValidationSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,      // also creates the index used for the $in lookups
      lowercase: true,
      trim: true
    },
    // NeverBounce "result": valid | invalid | disposable | catchall | unknown
    status: {
      type: String,
      default: 'unknown'
    },
    providerStatus: {
      type: String,
      default: ''
    },
    provider: {
      type: String,
      default: 'neverbounce'
    },
    // When this address was last checked — drives the 90-day freshness window.
    checkedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

const EmailValidation = mongoose.model('EmailValidation', emailValidationSchema, 'emailValidations');

module.exports = EmailValidation;
