// controllers/inboundReplyController.js
// Receives replies to campaign emails from a Mailgun inbound route.
//
// Why this exists: Mailgun's tracking webhook only reports on mail we SENT —
// delivered, opened, clicked, bounced. It has no "replied" event, because a
// reply is a new inbound message. Until this route existed, Campaign.repliedCount
// was in the schema and rendered on the dashboard but was never incremented, so
// reply rate always read 0%.
//
// Matching: an email client sets In-Reply-To (and References) to the Message-Id
// of the mail being answered. That is the same id stored on CampaignEmail when
// we sent it, so it is the join key.

const crypto = require('crypto');
const CampaignEmail = require('../models/CampaignEmail');
const Campaign = require('../models/Campaign');
const { classifyReply, stripQuotedText } = require('../utils/classifyReply');

/** Message ids travel as "<abc@host>" in some fields and bare in others. */
const normaliseId = (id) => String(id || '').trim().replace(/^<|>$/g, '');

/**
 * Verify the request really came from Mailgun.
 *
 * Mailgun signs every inbound POST with timestamp + token + HMAC of the two,
 * keyed on the signing key. Without this check anyone who found the URL could
 * post fake replies and inflate a customer's numbers.
 */
function verifySignature({ timestamp, token, signature }) {
  const key = process.env.MAILGUN_WEBHOOK_SIGNING_KEY || process.env.MAILGUN_API_KEY;
  if (!key) return { ok: false, reason: 'No signing key configured' };
  if (!timestamp || !token || !signature) return { ok: false, reason: 'Missing signature fields' };

  // Reject anything older than 15 minutes so a captured request can't be replayed.
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 15 * 60) {
    return { ok: false, reason: 'Stale timestamp' };
  }

  const expected = crypto
    .createHmac('sha256', key)
    .update(String(timestamp) + String(token))
    .digest('hex');

  // Constant-time compare; lengths must match first or timingSafeEqual throws.
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { ok, reason: ok ? null : 'Signature mismatch' };
}

/**
 * Find the campaign email this reply is answering.
 * In-Reply-To is the direct answer; References holds the whole thread, so it is
 * the fallback when a client rewrites In-Reply-To.
 */
async function findOriginalEmail(fields) {
  const candidates = [];

  const inReplyTo = normaliseId(fields['In-Reply-To'] || fields['in-reply-to']);
  if (inReplyTo) candidates.push(inReplyTo);

  const references = String(fields.References || fields.references || '');
  // Walk the thread newest-first — the most recent reference is the nearest parent.
  const refIds = (references.match(/<[^>]+>/g) || []).map(normaliseId).reverse();
  candidates.push(...refIds);

  for (const id of candidates) {
    const email = await CampaignEmail.findOne({
      $or: [{ mailgunMessageId: id }, { mailgunMessageId: `<${id}>` }],
    });
    if (email) return email;
  }
  return null;
}

/** Recount a campaign's reply outcomes from its emails — never increment blindly. */
async function recountCampaign(campaignId) {
  const rows = await CampaignEmail.aggregate([
    { $match: { campaignId, status: 'replied' } },
    { $group: { _id: '$reply.intent', n: { $sum: 1 } } },
  ]);

  const by = Object.fromEntries(rows.map((r) => [r._id || 'other', r.n]));
  // An auto-reply is not a human reply; excluding it keeps the rate honest.
  const total = rows.reduce((n, r) => n + (r._id === 'out_of_office' ? 0 : r.n), 0);

  await Campaign.findByIdAndUpdate(campaignId, {
    $set: {
      'stats.repliedCount': total,
      'stats.meetingRequestCount': by.meeting_request || 0,
      'stats.interestedCount': by.interested || 0,
      'stats.notInterestedCount': by.not_interested || 0,
    },
  });
}

/**
 * POST /api/webhooks/mailgun/inbound
 * Mailgun inbound route target. No auth middleware — Mailgun posts directly and
 * authenticates with its signature instead.
 */
const handleInboundReply = async (req, res) => {
  // Always 200 on anything we choose not to process. A non-2xx makes Mailgun
  // retry for hours, and none of these cases get better on a retry.
  try {
    const f = req.body || {};

    const sig = verifySignature({
      timestamp: f.timestamp,
      token: f.token,
      signature: f.signature,
    });
    if (!sig.ok) {
      console.warn('[InboundReply] Rejected:', sig.reason);
      return res.status(406).json({ success: false, message: sig.reason });
    }

    const email = await findOriginalEmail(f);
    if (!email) {
      // Legitimate: someone replying to mail we didn't send through a campaign.
      return res.status(200).json({ success: true, message: 'Not a campaign email' });
    }

    // Mailgun retries on network hiccups; don't double-count the same reply.
    const replyMessageId = normaliseId(f['Message-Id'] || f['message-id']);
    if (email.status === 'replied' && email.reply?.messageId === replyMessageId) {
      return res.status(200).json({ success: true, message: 'Already recorded' });
    }

    const fullText = f['body-plain'] || f['stripped-text'] || '';
    // Mailgun's own stripped-text is usually right; fall back to our own stripper.
    const text = f['stripped-text'] || stripQuotedText(fullText);

    email.status = 'replied';
    email.repliedAt = new Date();
    email.reply = {
      from: f.sender || f.From || '',
      subject: f.subject || f.Subject || '',
      text: String(text).slice(0, 20000),
      fullText: String(fullText).slice(0, 100000),
      messageId: replyMessageId,
      receivedAt: new Date(),
    };

    // Classify before saving so one write records both the reply and its meaning.
    try {
      const c = await classifyReply({ text, subject: email.reply.subject });
      email.reply.intent = c.intent;
      email.reply.intentConfidence = c.confidence;
      email.reply.intentReason = c.reason;
      email.reply.intentIsMock = c.isMock;
      email.reply.classifiedAt = new Date();
    } catch (err) {
      // A classifier failure must not lose the reply itself.
      console.error('[InboundReply] Classification failed:', err.message);
      email.reply.intent = 'other';
      email.reply.intentConfidence = 'low';
      email.reply.intentReason = `Classifier error: ${err.message}`.slice(0, 500);
    }

    await email.save();
    await recountCampaign(email.campaignId);

    console.log(
      `[InboundReply] ✓ ${email.leadEmail || email.reply.from} -> ${email.reply.intent}` +
      ` (campaign ${email.campaignId})`
    );

    res.status(200).json({ success: true, intent: email.reply.intent });
  } catch (err) {
    console.error('[InboundReply] Error:', err.message);
    // 200 so Mailgun doesn't retry a message that will fail the same way again.
    res.status(200).json({ success: false, message: err.message });
  }
};

module.exports = { handleInboundReply, verifySignature, findOriginalEmail, recountCampaign };
