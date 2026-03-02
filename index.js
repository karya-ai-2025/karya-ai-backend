// server.js
// Main entry point for Karya-AI Backend

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
require('dotenv').config();

// Config
const { config, validateConfig } = require('./config/config');
const connectDB = require('./config/db');

// Middleware
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');

// Routes
const authRoutes = require('./routes/authRoutes');
const profileRoutes = require('./routes/profileRoutes');
const onboardingRoutes = require('./routes/onboardingRoutes');
const expertOnboardingRoutes=require('./routes/Expertonboardingroutes')
const marketplaceRoutes=require('./routes/Marketplaceroutes')

// Validate environment variables
validateConfig();

// Initialize Express
const app = express();

// ============================================
// SECURITY MIDDLEWARE
// ============================================

// Set security HTTP headers
app.use(helmet());

// Enable CORS
app.use(cors({
  origin: config.frontendUrl,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
app.use('/api', apiLimiter);

// Sanitize data (prevent NoSQL injection)
app.use(mongoSanitize());

// ============================================
// BODY PARSING MIDDLEWARE
// ============================================

// Parse JSON bodies
app.use(express.json({ limit: '50mb' }));

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Parse cookies
app.use(cookieParser());

// ============================================
// ROUTES
// ============================================

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Karya-AI API is running',
    environment: config.env,
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/expert-onboarding',expertOnboardingRoutes)
app.use('/api/marketplace',marketplaceRoutes)

// Future routes (placeholders)
// app.use('/api/projects', projectRoutes);
// app.use('/api/leads', leadRoutes);
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
    
    // Start Express server
    const server = app.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🚀 Karya-AI Backend Server                               ║
║                                                            ║
║   Environment: ${config.env.padEnd(42)}║
║   Port: ${PORT.toString().padEnd(49)}║
║   API URL: http://localhost:${PORT}/api                     ║
║                                                            ║
║   Available Endpoints:                                     ║
║   • Health Check: GET /api/health                          ║
║   • Auth: /api/auth/*                                      ║
║   • Profiles: /api/profiles/*                              ║
║   • Onboarding: /api/onboarding/*                          ║
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