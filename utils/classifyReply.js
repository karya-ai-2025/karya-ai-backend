// utils/classifyReply.js
// Reads a reply to an outbound email and decides what it means.
//
// This is what turns "34 people replied" into "5 want a meeting" — the number a
// customer actually cares about. Mock mode when ANTHROPIC_API_KEY is not set,
// and the result is flagged so mock output is never mistaken for real.

const isMockMode = () => !process.env.ANTHROPIC_API_KEY;

const INTENTS = [
  'meeting_request',
  'interested',
  'question',
  'not_interested',
  'unsubscribe',
  'out_of_office',
  'other',
];

const SYSTEM_PROMPT = `You classify replies to cold outbound sales emails.

Return ONLY valid JSON — no explanation, no markdown:

{
  "intent": one of ${INTENTS.map((i) => `"${i}"`).join(' | ')},
  "confidence": "high" | "medium" | "low",
  "reason": "one short sentence quoting or paraphrasing what decided it"
}

Guidance:
- "meeting_request" — they propose or agree to a call, demo, or specific time.
  This is the highest-value outcome; only use it when a conversation is actually
  being scheduled, not merely welcomed.
- "interested" — positive or curious, but no meeting proposed yet.
- "question" — they want information before deciding.
- "not_interested" — a decline, "not right now", or "we already have this".
- "unsubscribe" — asks to be removed or to stop being contacted.
- "out_of_office" — an automated away/vacation/bounce-style auto-reply. These are
  not real replies; classifying them correctly keeps the numbers honest.
- "other" — anything that fits none of the above.`;

/**
 * Strip the quoted thread so the model reads only what this person wrote.
 * Conservative on purpose — a wrong cut loses meaning, so it stops at the first
 * clear quote marker and keeps everything before it.
 */
function stripQuotedText(raw = '') {
  if (!raw) return '';
  const markers = [
    /^On .+ wrote:$/m,                       // Gmail / Apple Mail
    /^-{2,}\s*Original Message\s*-{2,}$/im,  // Outlook
    /^_{5,}$/m,                              // Outlook divider
    /^From:\s.+$/m,                          // forwarded header block
    /^Sent from my \w+/m,
  ];
  let cut = raw.length;
  for (const m of markers) {
    const found = raw.match(m);
    if (found && found.index != null && found.index < cut) cut = found.index;
  }
  // Drop leading "> " quote lines too.
  return raw
    .slice(0, cut)
    .split('\n')
    .filter((l) => !/^\s*>/.test(l))
    .join('\n')
    .trim();
}

/**
 * @param {{ text: string, subject?: string }} params
 * @returns {{ isMock: boolean, intent, confidence, reason }}
 */
async function classifyReply({ text, subject = '' }) {
  const body = stripQuotedText(text).slice(0, 4000);

  // An empty reply body tells us nothing — don't spend a call guessing.
  if (!body) {
    return { isMock: false, intent: 'other', confidence: 'low', reason: 'Empty reply body' };
  }

  if (isMockMode()) {
    console.log('[ClassifyReply] Mock mode — add ANTHROPIC_API_KEY to .env');
    return { isMock: true, intent: 'other', confidence: 'low', reason: 'Mock — no API key' };
  }

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001', // fast + cheap; this runs per reply
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Subject: ${subject || '(none)'}\n\nReply:\n${body}`,
    }],
  });

  const raw = res.content?.[0]?.text?.trim() || '';
  let parsed;
  try {
    // Be tolerant of a stray code fence.
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return {
      isMock: false, intent: 'other', confidence: 'low',
      reason: 'Could not parse the classifier response',
    };
  }

  return {
    isMock: false,
    intent: INTENTS.includes(parsed.intent) ? parsed.intent : 'other',
    confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low',
    reason: String(parsed.reason || '').slice(0, 500),
  };
}

module.exports = { classifyReply, stripQuotedText, INTENTS };
