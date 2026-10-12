// utils/extractExpertKnowledge.js
// Turns an expert interview transcript into structured knowledge-base fields
// via Claude. Mock mode when ANTHROPIC_API_KEY is not set.

const { config } = require('../config/config');

const isMockMode = () => !config.anthropic.apiKey;

const SYSTEM_PROMPT = `You are analysing the transcript of a voice interview between Acerstone (a network that connects industry experts with businesses) and an EXPERT. The interviewer is "Agent"; the expert is "Expert".

Extract what the expert said about their own knowledge and return ONLY a valid JSON object — no explanation, no markdown. Record only what the expert actually stated; never infer or embellish. Use null or [] for anything not covered.

{
  "deepExpertiseAreas": ["sub-areas they know in real depth"],
  "caseExamples": [{ "situation": "", "role": "what they personally did", "scale": "budget / team / volume if given", "outcome": "" }],
  "industryViews": ["their views on how the industry is changing"],
  "operationalKnowledge": ["how things work in practice: decision-making, costs, timelines, vendor/buyer dynamics"],
  "companiesAndPlayers": ["companies, vendors, regulators or technologies they showed knowledge of"],
  "questionsTheyCanAnswer": ["kinds of client questions they are a strong fit for"],
  "questionsTheyCannotAnswer": ["adjacent areas they said they would decline"],
  "knowledgeRecency": "how current their knowledge is, in their words",
  "confidentialityLimits": ["employers, clients or topics they cannot discuss"],
  "engagementPreferences": ["formats and time commitment they prefer"],
  "notableQuotes": ["up to three short verbatim lines that capture their expertise"],
  "summary": "three or four sentences a client-matching team could read to understand this expert",
  "confidence": "high if the transcript is detailed and specific, medium if partial, low if there is very little"
}`;

/**
 * @param {{ rawTranscript: string, profileSnapshot?: object }} params
 * @returns {{ isMock: boolean, extractedData: object }}
 */
async function extractExpertKnowledge({ rawTranscript, profileSnapshot = {} }) {
  if (isMockMode()) {
    console.log('[ExtractExpertKnowledge] Mock mode — add ANTHROPIC_API_KEY to .env');
    return { isMock: true, extractedData: { summary: 'Mock extraction — ANTHROPIC_API_KEY not set', confidence: 'low' } };
  }

  if (!rawTranscript || rawTranscript.trim().length < 50) {
    throw new Error('Transcript is too short or empty to extract meaningful data');
  }

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: config.anthropic.apiKey });

  const message = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `PROFILE ON FILE (context only):\n${JSON.stringify(profileSnapshot)}\n\nTRANSCRIPT:\n${rawTranscript}`
    }]
  });

  const responseText = message.content.find((block) => block.type === 'text')?.text || '';

  // Claude may wrap the JSON in markdown sometimes
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude did not return a valid JSON object in its response');

  return { isMock: false, extractedData: JSON.parse(jsonMatch[0]) };
}

module.exports = { extractExpertKnowledge };
