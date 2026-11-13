// server.js
// Main entry point for Karya-AI Backend

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');

// Config
const { config, validateConfig } = require('./config/config');
const connectDB = require('./config/db');

// Silence non-error logs in production; dev keeps everything. Requires NODE_ENV
// to be 'production' on the host (Azure App Setting). console.error / console.warn
// are intentionally kept so real problems still surface in the logs.
if (process.env.NODE_ENV === 'production') {
  console.log = () => {};
  console.debug = () => {};
  console.info = () => {};
}

// Middleware
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');

// Account kinds: each API area belongs to one kind of account (business,
// partner, platform). kindGate turns away a token of any other kind at the
// door, before the area's own routes run. Login, organization/team management,
// public content and webhooks are shared and carry no gate.
const { kindGate } = require('./middleware/authMiddleware');
const businessOnly = kindGate('business');
const partnerOnly = kindGate('partner');
// The project-work areas: a business, or a worker (agency / expert) inside a
// client's project — projectContext then holds the worker to that one project.
const projectWork = kindGate('business', 'partner');

// Routes
const authRoutes = require('./routes/authRoutes');
const profileRoutes = require('./routes/profileRoutes');
const onboardingRoutes = require('./routes/onboardingRoutes'); // Business onboarding
// Expert flow — switched off by EXPERT_FLOW_ENABLED (see config/featureFlags.js)
const { EXPERT_FLOW_ENABLED, requireExpertFlow } = require('./config/featureFlags');
const expertOnboardingRoutes=require('./routes/Expertonboardingroutes')
const marketplaceRoutes=require('./routes/Marketplaceroutes')
// projectRoutes removed — Project collection replaced by ProjectCatalog
const industriesRoutes = require('./routes/industriesRoutes'); // PostgreSQL industries
const leadsRoutes = require('./routes/leadsRoutes'); // Lead generation routes
const planRoutes = require('./routes/planRoutes'); // Plan and pricing routes
const creditRoutes = require('./routes/creditRoutes'); // Credit consumption routes
const catalogRoutes = require('./routes/catalogRoutes'); // Project catalog & pricing
const submissionRoutes = require('./routes/submissionRoutes'); // Project brief submissions
const campaignRoutes = require('./routes/campaigns'); // Email campaigns
const jobRoutes = require('./routes/jobRoutes'); // Job marketplace (acerstone)
const emailTemplateRoutes = require('./routes/emailTemplates'); // Email templates
const userCrmRoutes = require('./routes/userCrmRoutes'); // User CRM objects
const webhookRoutes = require('./routes/webhooks'); // Mailgun webhooks
const conversationRoutes = require('./routes/conversationRoutes'); // Agent conversations
const agentRoutes = require('./routes/agentRoutes'); // LangGraph agent workflow
const paymentRoutes = require('./routes/paymentRoutes'); // Cashfree payment routes
const negotiationRoutes = require('./routes/negotiationRoutes'); // Project deliverable negotiations
const schedulingRoutes  = require('./routes/schedulingRoutes');  // Onboarding call scheduling
const transcriptRoutes  = require('./routes/transcriptRoutes');  // Call transcript pipeline
const adminRoutes       = require('./routes/adminRoutes');        // Admin analytics & management
const infraRoutes       = require('./routes/infraRoutes');     // Admin infrastructure monitoring
const adminCampaignRoutes = require('./routes/adminCampaignRoutes'); // Admin builds campaigns for customers
const organizationRoutes = require('./routes/organizationRoutes'); // Org context & membership
const resourceRoutes    = require('./routes/resourceRoutes');      // Public resource hub + admin CRUD
const contentProjectRoutes = require('./routes/contentProjectRoutes'); // Content Project (LinkedIn + Newsletter)
const hitlRoutes = require('./routes/hitlRoutes'); // Human-in-the-loop approval requests
const icpRoutes = require('./routes/icpRoutes'); // Campaign ICPs + customer approval loop
const supportRoutes = require('./routes/supportRoutes'); // Support contact emails + update subscriptions

// Jobs
const { startTranscriptJob, stopTranscriptJob } = require('./jobs/transcriptJob');
const { startIcpAutoApproveJob, stopIcpAutoApproveJob } = require('./jobs/icpAutoApproveJob');
const { startReminderJob,   stopReminderJob   } = require('./jobs/reminderJob');

// Product analytics module (independent of Azure Application Insights)
const analytics = require('./analytics');



// Validate environment variables
validateConfig();

// Initialize Express
const app = express();

// Trust first proxy (needed for express-rate-limit behind reverse proxy)
app.set('trust proxy', 1);

// ============================================
// SECURITY MIDDLEWARE
// ============================================

// Set security HTTP headers
app.use(helmet());

// Origins allowed to call this API:
//  - the configured frontend URL (FRONTEND_URL), the Karya and Acerstone sites and
//    localhost:3000 (config.frontendOrigins)
//  - any deployed origins listed in CORS_ORIGINS (comma-separated) — set this in
//    production to your deployed frontend URL(s)
//  - VS Code / dev-tunnel preview URLs
const allowedOrigins = [
  ...config.frontendOrigins,
  'https://localhost:3000',
  ...String(process.env.CORS_ORIGINS || '').split(',').map((o) => o.trim())
].filter(Boolean);
const isAllowedOrigin = (origin) => {
  if (!origin) return true; // non-browser / same-origin requests (curl, server-to-server)
  if (allowedOrigins.includes(origin)) return true;
  try {
    // e.g. https://w2qtdfwt-3000.inc1.devtunnels.ms  → allow any *.devtunnels.ms
    const host = new URL(origin).hostname;
    if (host.endsWith('.devtunnels.ms')) return true;
  } catch { /* malformed origin → fall through to deny */ }
  return false;
};

// Private Network Access: a public HTTPS origin (dev tunnel) calling a loopback
// address (localhost:5001) is blocked by Chrome unless we echo this on the preflight.
app.use((req, res, next) => {
  if (isAllowedOrigin(req.headers.origin)) {
    res.header('Access-Control-Allow-Private-Network', 'true');
  }
  next();
});

// Enable CORS
app.use(cors({
  origin: (origin, cb) => (isAllowedOrigin(origin) ? cb(null, true) : cb(new Error('Not allowed by CORS'))),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  // x-karya-project: which purchased project a workspace call is for (middleware/projectContext.js)
  allowedHeaders: ['Content-Type', 'Authorization', 'x-session-id', 'x-karya-project']
}));

// Rate limiting
app.use('/api', apiLimiter);

// Sanitize data (prevent NoSQL injection)
app.use(mongoSanitize());

// ============================================
// BODY PARSING MIDDLEWARE
// ============================================

// Parse JSON bodies
app.use(express.json({
  limit: '50mb',
  // Cal.com signs the exact bytes it sent — keep them for the webhook's HMAC check
  verify: (req, res, buf) => {
    if (req.originalUrl.startsWith('/api/scheduling/calcom/webhook')) req.rawBody = buf;
  }
}));

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Parse cookies
app.use(cookieParser());

// ============================================
// PRODUCT ANALYTICS
// API-call tracking is intentionally DISABLED — Azure Application Insights
// already covers API/infra metrics (requests, durations, status codes), so
// recording them again here is redundant and floods the DB. Product analytics
// tracks page views + meaningful product events only (see /api/analytics/*).
// To re-enable API tracking: app.use(analytics.apiTracker);
// ============================================

// ============================================
// ROUTES
// ============================================

// Import global Prisma client for health check
const { testConnection } = require('./utils/prismaClient');

// Health check with database status
app.get('/api/health', async (req, res) => {
  try {
    // Test PostgreSQL connection using global singleton client
    const postgresStatus = await testConnection();

    res.status(200).json({
      success: true,
      message: 'Karya-AI API is running - Dual Database Architecture',
      environment: config.env,
      timestamp: new Date().toISOString(),
      databases: {
        mongodb: 'connected', // Assume connected if server is running
        postgresql: postgresStatus
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Health check failed',
      environment: config.env,
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Root route — API-only backend has no homepage; this gives health probes and
// anyone hitting the base URL a friendly 200 instead of a 404 (the frontend is
// a separate Next.js app). Deep health check lives at /api/health.
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Karya-AI API is running',
    environment: config.env,
    health: '/api/health'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/profiles', businessOnly, profileRoutes);
app.use('/api/onboarding', businessOnly, onboardingRoutes);
// Expert flow: mounted only while EXPERT_FLOW_ENABLED; otherwise every call gets a clear 403.
if (EXPERT_FLOW_ENABLED) {
  app.use('/api/expert-onboarding',expertOnboardingRoutes)
  app.use('/api/marketplace',marketplaceRoutes)
  app.use('/api/expert-interview', require('./routes/expertInterviewRoutes')); // ElevenLabs voice interview after expert onboarding
} else {
  app.use(['/api/expert-onboarding', '/api/marketplace', '/api/expert-interview'], requireExpertFlow);
}
// /api/projects removed — Project collection replaced by ProjectCatalog
app.use('/api/industries', industriesRoutes); // PostgreSQL industries endpoint
app.use('/api/leads', businessOnly, leadsRoutes); // Lead generation and management
app.use('/api/catalog', businessOnly, catalogRoutes); // Project catalog & pricing tiers
app.use('/api/submissions', businessOnly, submissionRoutes); // Project brief submissions
app.use('/api/webhooks', webhookRoutes); // Mailgun webhook events (no auth)
app.use('/api/payments', businessOnly, paymentRoutes); // Payment gateway order creation and verification
app.use('/api/credits', businessOnly, creditRoutes); // Credit consumption tracking
app.use('/api/campaigns', projectWork, campaignRoutes); // Email campaigns
app.use('/api/email-templates', projectWork, emailTemplateRoutes); // Email templates
app.use('/api/user-crm', projectWork, userCrmRoutes); // Saved CRM lead lists
app.use('/api/conversations', businessOnly, conversationRoutes); // Agent conversation history
app.use('/api/agent', businessOnly, agentRoutes); // Five-phase agent workflow
app.use('/api/hitl', businessOnly, hitlRoutes); // Human-in-the-loop approval requests
app.use('/api/icp', projectWork, icpRoutes); // Campaign ICPs (customer view + admin authoring)
app.use('/api/support', supportRoutes); // Support contact emails + update subscriptions
app.use('/api/analytics', analytics.trackRoutes); // Product analytics ingestion (page views + events)
app.use('/api/negotiations', businessOnly, negotiationRoutes); // Project deliverable negotiations
app.use('/api/resources',        resourceRoutes);        // Resource hub
app.use('/api/content-projects', businessOnly, contentProjectRoutes);  // Content Project (LinkedIn + Newsletter)
app.use('/api/scheduling',  businessOnly, schedulingRoutes);  // Onboarding call scheduling (Cal.com)
app.use('/api/projects/:projectId', projectWork, require('./routes/projectWorkspaceRoutes'));
app.use('/api/approvals/:approvalId', projectWork, require('./routes/approvalRoutes')); // One approval request (decide / comment / withdraw)
app.use('/api/attention', projectWork, require('./routes/attentionRoutes')); // Attention Center (business / partner) // Shared project workspace (business + its workers)
app.use('/api/engagements', businessOnly, require('./routes/engagementRoutes')); // Business brings a worker into a project
app.use('/api/partner', partnerOnly, require('./routes/partnerRoutes')); // Partner (agency) app
app.use('/api/organizations', organizationRoutes); // Organization, members and invitations — every kind (public invite lookup)
app.use('/api/transcripts', businessOnly, transcriptRoutes); // Call transcript pipeline (admin)
app.use('/api/admin/analytics', businessOnly, analytics.adminRoutes); // Product analytics dashboard (before adminRoutes; legacy /analytics/users + /azure fall through to adminRoutes)
app.use('/api/admin/infrastructure', businessOnly, infraRoutes); // Infrastructure dashboard (before /api/admin)
app.use('/api/admin/campaigns', businessOnly, adminCampaignRoutes); // Admin-on-behalf campaigns (before /api/admin)
app.use('/api/admin',       businessOnly, adminRoutes);       // Admin analytics & management (legacy isAdmin staff, until the Karya console)
app.use('/api/jobs', jobRoutes); // Job marketplace (acerstone)
// Keep last: planRoutes is mounted on bare /api and applies `protect` to everything
// after its public routes, so any router mounted below it would require a login.
app.use('/api', businessOnly, planRoutes); // Plan and pricing management


// Future routes (placeholders)
// app.use('/api/messages', messageRoutes);

// ============================================
// ERROR HANDLING
// ============================================

// Handle 404 - Route not found
app.use(notFound);

// Global error handler
app.use(errorHandler);

// ============================================
// START SERVER
// ============================================

const PORT = config.port;

const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Test PostgreSQL connection using global singleton client
    await testConnection();
    
    // Start background jobs
    startTranscriptJob();
    startIcpAutoApproveJob();
    startReminderJob();

    // Start Express server
    const server = app.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🚀 Karya-AI Backend Server - Dual Database Architecture  ║
║                                                            ║
║   Environment: ${config.env.padEnd(42)}║
║   Port: ${PORT.toString().padEnd(49)}║
║   API URL: http://localhost:${PORT}/api                     ║
║                                                            ║
║   📊 Database Architecture:                                ║
║   • MongoDB: User/Project Management (Mongoose)           ║
║   • PostgreSQL: Products/Leads (Prisma Client)            ║
║                                                            ║
║   Available Endpoints:                                     ║
║   • Health Check: GET /api/health                          ║
║   • Auth: /api/auth/* (incl. /linkedin, /google)           ║
║   • Profiles: /api/profiles/*                              ║
║   • Onboarding: /api/onboarding/*                          ║
║   • Expert Onboarding: /api/expert-onboarding/*            ║
║   • Marketplace: /api/marketplace/*                        ║
║   • Catalog: /api/catalog/*                                ║
║   • Industries: GET /api/industries (PostgreSQL)          ║
║   • Leads: /api/leads/* (Lead Generation)                  ║
║   • Plans: /api/plans/* (Pricing & Subscriptions)         ║
║                                                            ║
║   Multi-Profile System:                                    ║
║   • Users can have both Owner & Expert profiles            ║
║   • Switch roles via POST /api/auth/switch-role            ║
║   • Create profiles via POST /api/auth/create-profile      ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
      `);
    });
    
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (err) => {
      console.error('UNHANDLED REJECTION! 💥 Shutting down...');
      console.error(err.name, err.message);
      server.close(() => {
        process.exit(1);
      });
    });
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
      console.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
      console.error(err.name, err.message);
      process.exit(1);
    });
    
    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('👋 SIGTERM received. Shutting down gracefully...');
      stopTranscriptJob();
      stopIcpAutoApproveJob();
      server.close(() => {
        console.log('💤 Process terminated');
      });
    });
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;
