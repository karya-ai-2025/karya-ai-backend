// Global Prisma Client Singleton
// ONE instance for the entire application - Production Safe
// Usage: const { prisma } = require('../utils/prismaClient');

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const generatedClientEntry = path.join(
  __dirname,
  '..',
  'node_modules',
  '.prisma',
  'client',
  'default.js'
);

function ensureGeneratedPrismaClient() {
  if (fs.existsSync(generatedClientEntry)) {
    return;
  }

  console.warn('Prisma generated client not found. Running prisma generate...');

  try {
    execSync('npx prisma generate', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
    });
  } catch (error) {
    console.error('Prisma client generation failed before initialization.');
    throw error;
  }

  if (!fs.existsSync(generatedClientEntry)) {
    throw new Error(`Prisma client is still missing after generation: ${generatedClientEntry}`);
  }
}

ensureGeneratedPrismaClient();

const { PrismaClient } = require('@prisma/client');

// Singleton pattern - Only ONE instance across the entire app
let prisma;

const createPrismaClient = () => {
  if (prisma) {
    return prisma;
  }

  prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development'
      ? ['error', 'warn']
      : ['error'],

    // Connection pool settings for production
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

  // Graceful shutdown handlers
  process.on('beforeExit', async () => {
    await prisma?.$disconnect();
  });

  process.on('SIGINT', async () => {
    await prisma?.$disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await prisma?.$disconnect();
    process.exit(0);
  });

  console.log('✅ Global Prisma Client created (Singleton)');
  return prisma;
};

// Initialize the singleton
if (!prisma) {
  prisma = createPrismaClient();
}

// Export the singleton client and helper functions
module.exports = {
  // Main singleton client
  prisma,

  // Connection test function
  testConnection: async () => {
    try {
      await prisma.$connect();
      const healthcareCount = await prisma.tbl_healthcare.count();
      const industriesCount = await prisma.tbl_gtm_industry.count();

      console.log('🔗 PostgreSQL Connection (Global Client):');
      console.log(`   • Healthcare records: ${healthcareCount}`);
      console.log(`   • Industries: ${industriesCount}`);

      return {
        connected: true,
        tables: { healthcare: healthcareCount, industries: industriesCount }
      };
    } catch (error) {
      console.error('❌ PostgreSQL connection failed:', error.message);
      return { connected: false, error: error.message };
    }
  },

  // Helper functions for common operations on your actual tables

  // Healthcare table operations
  healthcare: {
    // Get all records with pagination
    findMany: (options = {}) => prisma.tbl_healthcare.findMany(options),

    // Count records
    count: (where = {}) => prisma.tbl_healthcare.count({ where }),

    // Find by email
    findByEmail: (email) => prisma.tbl_healthcare.findFirst({
      where: { email }
    }),

    // Search by various fields
    search: ({ name, company, industry, location, limit = 20, skip = 0 }) => {
      const where = {};

      if (name) {
        where.OR = [
          { First_Name: { contains: name, mode: 'insensitive' } },
          { Last_Name: { contains: name, mode: 'insensitive' } }
        ];
      }

      if (company) {
        where.Account_Name = { contains: company, mode: 'insensitive' };
      }

      if (industry) {
        where.GTM_Industry = { contains: industry, mode: 'insensitive' };
      }

      if (location) {
        where.OR = [
          ...(where.OR || []),
          { Mailing_City: { contains: location, mode: 'insensitive' } },
          { Mailing_State_Province: { contains: location, mode: 'insensitive' } },
          { Mailing_Country: { contains: location, mode: 'insensitive' } }
        ];
      }

      return prisma.tbl_healthcare.findMany({
        where,
        take: limit,
        skip,
        orderBy: { id: 'desc' }
      });
    }
  },

  // Industry table operations
  industry: {
    // Get all industries
    findAll: () => prisma.tbl_gtm_industry.findMany({
      orderBy: { industry_name: 'asc' }
    }),

    // Find by name
    findByName: (name) => prisma.tbl_gtm_industry.findFirst({
      where: { industry_name: { contains: name, mode: 'insensitive' } }
    }),

    // Count records
    count: () => prisma.tbl_gtm_industry.count()
  },

  // Generic raw queries for complex operations
  raw: {
    // Execute raw SQL queries when needed
    query: (sql, params = []) => prisma.$queryRaw`${sql}`,

    // Get table statistics
    getTableStats: async () => {
      const stats = {};

      try {
        stats.healthcare = await prisma.tbl_healthcare.count();
        stats.industries = await prisma.tbl_gtm_industry.count();
      } catch (error) {
        console.error('Error getting table stats:', error);
        stats.error = error.message;
      }

      return stats;
    }
  }
};
