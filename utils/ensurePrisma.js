// Utility to ensure Prisma client is available
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function ensurePrismaClient() {
  const prismaClientPath = path.join(__dirname, '..', 'node_modules', '.prisma', 'client');

  // Check if Prisma client exists
  if (!fs.existsSync(prismaClientPath)) {
    console.log('🔄 Prisma client not found, generating...');

    try {
      // Try to generate Prisma client
      execSync('npx prisma generate', {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit'
      });

      console.log('✅ Prisma client generated successfully');
    } catch (error) {
      console.error('❌ Failed to generate Prisma client:', error.message);
      throw new Error('Prisma client generation failed');
    }
  } else {
    console.log('✅ Prisma client already exists');
  }
}

module.exports = { ensurePrismaClient };