const mongoose = require('mongoose');
require('dotenv').config();

async function checkCollections() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get database name
    const dbName = mongoose.connection.db.databaseName;
    console.log('📂 Database name:', dbName);

    // List all collections
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('\n📋 Collections in database:');

    if (collections.length === 0) {
      console.log('   ❌ No collections found in database');
    } else {
      collections.forEach((col, index) => {
        console.log(`   ${index + 1}. ${col.name}`);
      });
    }

    // Check both plan and plans collections
    const planCollection = mongoose.connection.db.collection('plan');
    const plansCollection = mongoose.connection.db.collection('plans');

    const planCount = await planCollection.countDocuments();
    const plansCount = await plansCollection.countDocuments();

    console.log(`\n📊 Documents in 'plan' collection (singular): ${planCount}`);
    console.log(`📊 Documents in 'plans' collection (plural): ${plansCount}`);

    if (planCount > 0) {
      const samplePlan = await planCollection.findOne();
      console.log('\n📄 Sample from plan collection:');
      console.log(JSON.stringify(samplePlan, null, 2));
    }

    if (plansCount > 0) {
      const samplePlan = await plansCollection.findOne();
      console.log('\n📄 Sample from plans collection:');
      console.log(JSON.stringify(samplePlan, null, 2));
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
  }
}

checkCollections();