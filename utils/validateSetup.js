// Production Setup Validation Script
// Validates that the global Prisma client is working correctly
// Run with: node utils/validateSetup.js

const { prisma, testConnection } = require('./prismaClient');

async function validateProduction() {
  console.log('🔍 Validating Production Setup...\n');

  try {
    // 1. Test singleton pattern
    const client1 = require('./prismaClient').prisma;
    const client2 = require('./prismaClient').prisma;

    const isSingleton = client1 === client2;
    console.log(`✅ Singleton Pattern: ${isSingleton ? 'PASS' : 'FAIL'}`);

    if (!isSingleton) {
      throw new Error('Multiple Prisma client instances detected!');
    }

    // 2. Test database connection
    console.log('🔗 Testing Database Connection...');
    const connectionTest = await testConnection();

    if (connectionTest.connected) {
      console.log('✅ PostgreSQL Connection: PASS');
      console.log(`   Healthcare records: ${connectionTest.tables.healthcare}`);
      console.log(`   Industries: ${connectionTest.tables.industries}`);
    } else {
      throw new Error(`Database connection failed: ${connectionTest.error}`);
    }

    // 3. Test basic queries
    console.log('📊 Testing Basic Queries...');

    const industriesCount = await prisma.tbl_gtm_industry.count();
    const healthcareCount = await prisma.tbl_healthcare.count();

    console.log(`✅ Industries Query: ${industriesCount} records`);
    console.log(`✅ Healthcare Query: ${healthcareCount} records`);

    // 4. Test API endpoint format
    console.log('🎯 Testing API Response Format...');

    const industries = await prisma.tbl_gtm_industry.findMany({
      select: { id: true, industry_name: true },
      take: 3
    });

    const formattedIndustries = industries.map(industry => ({
      value: industry.industry_name.toLowerCase().replace(/\s+/g, '-'),
      label: industry.industry_name,
      id: industry.id
    }));

    console.log(`✅ Sample Industries Format:`, formattedIndustries.slice(0, 2));

    console.log('\n🎉 All validations passed! Production setup is ready.');
    console.log('\n📋 Summary:');
    console.log(`   • Global Prisma Client: Singleton ✅`);
    console.log(`   • Database Connection: Active ✅`);
    console.log(`   • Query Performance: Working ✅`);
    console.log(`   • API Format: Ready ✅`);

    return true;

  } catch (error) {
    console.error('\n❌ Validation failed:', error.message);
    console.error('\n🔧 Check your:');
    console.error('   • DATABASE_URL in .env file');
    console.error('   • PostgreSQL server is running');
    console.error('   • Tables exist in database');
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

// Run validation if called directly
if (require.main === module) {
  validateProduction()
    .then(success => process.exit(success ? 0 : 1))
    .catch(error => {
      console.error('Validation script error:', error);
      process.exit(1);
    });
}

module.exports = { validateProduction };