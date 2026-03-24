#!/usr/bin/env node

// Startup script to ensure Prisma Client is generated before starting the app
// This runs before the main application starts

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load environment variables first
require('dotenv').config();

console.log('🚀 Starting Karya-AI Backend...');
console.log('🔍 Environment Check...');
console.log(`   NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`   DATABASE_URL: ${process.env.DATABASE_URL ? 'SET' : 'NOT SET'}`);

console.log('🔍 Checking Prisma Client...');

// Check if Prisma client exists
const prismaClientPath = path.join(__dirname, '..', 'node_modules', '.prisma', 'client');
const prismaClientExists = fs.existsSync(prismaClientPath);

console.log(`📁 Prisma client path: ${prismaClientPath}`);
console.log(`✅ Prisma client exists: ${prismaClientExists}`);

if (!prismaClientExists) {
  console.log('⚠️  Prisma client not found, generating...');

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL not found! Cannot generate Prisma client.');
    console.log('💡 Make sure DATABASE_URL is set in your environment variables.');
    process.exit(1);
  }

  // Generate Prisma client
  exec('npx prisma generate', { cwd: path.join(__dirname, '..') }, (error, stdout, stderr) => {
    if (error) {
      console.error('❌ Failed to generate Prisma client:', error);
      console.error('stderr:', stderr);

      // Try to provide more helpful error message
      if (stderr.includes('DATABASE_URL')) {
        console.error('💡 This looks like a DATABASE_URL issue. Check your environment variables.');
      }

      process.exit(1);
    }

    console.log('✅ Prisma client generated successfully');
    console.log('stdout:', stdout);

    // Start the main application
    startApp();
  });
} else {
  console.log('✅ Prisma client found, starting app...');
  startApp();
}

function startApp() {
  console.log('🚀 Starting main application...');
  require('../index.js');
}