const mongoose = require('mongoose');

/**
 * AnalyticsEvent — ONE flexible collection for all product analytics.
 *
 * `category` separates the three kinds of records:
 *   'page'    → a page visit          (eventType 'PAGE_VIEW')
 *   'event'   → a product event       (eventType e.g. 'LOGIN_SUCCESS')
 *   'api'     → an API call            (eventType 'API_CALL')
 *   'session' → session start/end      (eventType 'SESSION_START' | 'SESSION_END')
 *
 * `env` stamps where it came from so the dashboard can show production only.
 * This is separate from Azure Application Insights (infra) — it's product data.
 */
const analyticsEventSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      enum: ['page', 'event', 'api', 'session'],
      required: true,
      index: true
    },
    eventType: { type: String, required: true, trim: true, index: true },

    // Who
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    role: { type: String, enum: ['Business', 'Expert', 'Admin', 'Guest'], default: 'Guest', index: true },
    sessionId: { type: String, default: '', index: true },

    // Page context
    page: { type: String, default: '' },
    pageTitle: { type: String, default: '' },
    referrer: { type: String, default: '' },

    // API context
    api: { type: String, default: '' },
    method: { type: String, default: '' },
    statusCode: { type: Number, default: null },
    duration: { type: Number, default: null }, // ms

    // Outcome + free-form payload
    status: { type: String, enum: ['success', 'failure'], default: 'success', index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Device / geo
    ip: { type: String, default: '' },
    browser: { type: String, default: '' },
    os: { type: String, default: '' },
    device: { type: String, default: '' },
    country: { type: String, default: '' },
    city: { type: String, default: '' },

    // Environment stamp (production data only shows on the dashboard)
    env: { type: String, default: 'development', index: true },

    timestamp: { type: Date, default: Date.now, index: true }
  },
  { timestamps: false, versionKey: false }
);

// Common dashboard access patterns
analyticsEventSchema.index({ env: 1, timestamp: -1 });
analyticsEventSchema.index({ env: 1, category: 1, timestamp: -1 });
analyticsEventSchema.index({ env: 1, eventType: 1, timestamp: -1 });
analyticsEventSchema.index({ env: 1, sessionId: 1, timestamp: -1 });
analyticsEventSchema.index({ env: 1, user: 1, timestamp: -1 });

module.exports = mongoose.model('AnalyticsEvent', analyticsEventSchema, 'analytics_events');
