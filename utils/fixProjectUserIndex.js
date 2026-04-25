/**
 * One-time migration: drops the stale userId_1_projectId_1 index (which was
 * created without partialFilterExpression) and recreates it correctly so that
 * the unique constraint only fires when projectId is an actual ObjectId.
 *
 * Run once: node utils/fixProjectUserIndex.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function fix() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const col = mongoose.connection.collection('projectusers');

  // Show current indexes so we can confirm the stale one exists
  const before = await col.indexes();
  console.log('Indexes before:', before.map(i => ({ name: i.name, key: i.key, unique: i.unique, partial: i.partialFilterExpression })));

  // Drop the stale index (name may vary — drop by key pattern to be safe)
  try {
    await col.dropIndex('userId_1_projectId_1');
    console.log('Dropped stale index userId_1_projectId_1');
  } catch (e) {
    console.log('Index may not exist or already correct:', e.message);
  }

  // Also drop the catalogId sparse index so Mongoose rebuilds it cleanly
  try {
    await col.dropIndex('userId_1_catalogId_1');
    console.log('Dropped userId_1_catalogId_1 (will be recreated by Mongoose)');
  } catch (e) {
    console.log('catalogId index not found (ok):', e.message);
  }

  // Require the model — this triggers Mongoose to sync/create indexes
  require('../models/ProjectUser');
  await mongoose.model('ProjectUser').createIndexes();
  console.log('Recreated indexes via Mongoose');

  const after = await col.indexes();
  console.log('Indexes after:', after.map(i => ({ name: i.name, key: i.key, unique: i.unique, partial: i.partialFilterExpression })));

  await mongoose.disconnect();
  console.log('Done — purchase flow should work now.');
}

fix().catch(err => {
  console.error(err);
  process.exit(1);
});
