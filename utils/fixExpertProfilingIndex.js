/**
 * One-time migration: drops the stale compound index on
 * profiling.segments + profiling.subSegments. MongoDB cannot index two array
 * fields together ("cannot index parallel arrays"), so while it exists every
 * ExpertProfile insert fails — expert registration and expert social sign-in.
 * The model now declares one index per field instead.
 *
 * Run once per database: node utils/fixExpertProfilingIndex.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const STALE_INDEX = 'profiling.segments_1_profiling.subSegments_1';

async function fix() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const col = mongoose.connection.collection('expertprofiles');

  const before = await col.indexes();
  if (before.some(i => i.name === STALE_INDEX)) {
    await col.dropIndex(STALE_INDEX);
    console.log(`Dropped stale index ${STALE_INDEX}`);
  } else {
    console.log(`${STALE_INDEX} not found (ok)`);
  }

  const after = await col.indexes();
  console.log('Indexes after:', after.map(i => i.name));

  await mongoose.disconnect();
  console.log('Done — expert signup should work now.');
}

fix().catch(err => {
  console.error(err);
  process.exit(1);
});
