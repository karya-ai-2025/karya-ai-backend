// jobs/icpAutoApproveJob.js
// Background job — approves ICPs whose customer response window has closed.
//
// A campaign cannot send until its ICP is approved. Without this, an unanswered
// ICP would block the campaign indefinitely. Customers are told the deadline up
// front on their ICP page, so this is never a surprise.
//
// Only 'awaiting_user' ICPs are swept. One the customer answered with
// 'revision_requested' never auto-approves — they engaged and asked for changes,
// so the work is the admin's, not the clock's.

const CampaignICP = require('../models/CampaignICP');

const POLL_INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes
const BATCH_LIMIT = 50;

let jobInterval = null;

async function approveExpiredICPs() {
  try {
    const now = new Date();

    const expired = await CampaignICP.find({
      status: 'awaiting_user',
      autoApproveAt: { $ne: null, $lte: now },
    }).limit(BATCH_LIMIT);

    if (!expired.length) return;

    console.log(`[IcpAutoApprove] Approving ${expired.length} ICP(s) past their deadline`);

    for (const icp of expired) {
      try {
        icp.status = 'approved';
        icp.approvedAt = now;
        icp.approvalSource = 'auto';
        icp.autoApproveAt = undefined;
        await icp.save();
        console.log(`[IcpAutoApprove] ✓ ICP ${icp._id} auto-approved (campaign ${icp.campaignId})`);
      } catch (err) {
        console.error(`[IcpAutoApprove] ✗ ICP ${icp._id} failed:`, err.message);
      }
    }
  } catch (err) {
    console.error('[IcpAutoApprove] Poll error:', err.message);
  }
}

function startIcpAutoApproveJob() {
  if (jobInterval) return; // already running
  console.log(
    `[IcpAutoApprove] Started — polling every 10 minutes ` +
    `(window: ${CampaignICP.autoApproveHours()}h)`
  );
  approveExpiredICPs(); // catch anything that expired while the server was down
  jobInterval = setInterval(approveExpiredICPs, POLL_INTERVAL_MS);
}

function stopIcpAutoApproveJob() {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
    console.log('[IcpAutoApprove] Stopped');
  }
}

module.exports = { startIcpAutoApproveJob, stopIcpAutoApproveJob, approveExpiredICPs };
