// utils/extractProfile.js
// Sends a call transcript to Claude and extracts structured profile info.
// Mock mode when ANTHROPIC_API_KEY is not set.

const isMockMode = () => !process.env.ANTHROPIC_API_KEY;

const OWNER_PROMPT = `You are analyzing a transcript from an onboarding call for Karya-AI, a platform that connects businesses with freelance experts.

The caller is a BUSINESS OWNER looking to hire experts. Extract the following and return ONLY valid JSON — no explanation, no markdown, just the JSON object. Use null for any field not found in the transcript.

{
  "name": "full name of the business owner",
  "companyName": "company or business name",
  "businessType": "type of business e.g. B2B SaaS, E-commerce, Agency, Consulting",
  "industry": "specific industry e.g. FinTech, Healthcare, Real Estate",
  "goals": ["list of business goals they mentioned"],
  "painPoints": ["list of problems or challenges they described"],
  "expertiseNeeded": ["types of expert help they are looking for"],
  "budget": "budget range if mentioned e.g. ₹20,000–₹50,000/month",
  "timeline": "desired project timeline if mentioned",
  "teamSize": "current team size if mentioned",
  "currentTools": ["tools or platforms they currently use"],
  "notes": "any other relevant information not captured above",
  "confidence": "high if transcript is detailed and clear, medium if partial, low if very little info"
}`;

const EXPERT_PROMPT = `You are analyzing a transcript from an onboarding call for Karya-AI, a platform that connects freelance experts with businesses.

The caller is a FREELANCE EXPERT or CONSULTANT. Extract the following and return ONLY valid JSON — no explanation, no markdown, just the JSON object. Use null for any field not found in the transcript.

{
  "name": "full name of the expert",
  "industry": "primary industry they work in",
  "skills": ["list of skills and services they offer"],
  "yearsOfExperience": "years of experience if mentioned",
  "previousClients": ["notable clients or companies they mentioned"],
  "tools": ["tools or platforms they are proficient in"],
  "preferredProjectTypes": ["types of projects they prefer"],
  "availability": "availability mentioned e.g. part-time, full-time, weekends",
  "rateExpectation": "rate or income expectation if mentioned",
  "goals": ["goals they have for joining Karya-AI"],
  "notes": "any other relevant information not captured above",
  "confidence": "high if transcript is detailed and clear, medium if partial, low if very little info"
}`;

/**
 * Sends transcript to Claude and returns structured profile data.
 * @param {{ rawTranscript: string, userType: 'owner'|'expert' }} params
 * @returns {{ isMock: boolean, extractedData: object }}
 */
async function extractProfileFromTranscript({ rawTranscript, userType = 'owner' }) {
  if (isMockMode()) {
    console.log('[ExtractProfile] Mock mode — add ANTHROPIC_API_KEY to .env');
    return {
      isMock: true,
      extractedData: {
        notes: 'Mock extraction — ANTHROPIC_API_KEY not set',
        confidence: 'low',
      },
    };
  }

  if (!rawTranscript || rawTranscript.trim().length < 50) {
    throw new Error('Transcript is too short or empty to extract meaningful data');
  }

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemPrompt = userType === 'expert' ? EXPERT_PROMPT : OWNER_PROMPT;
  const fullPrompt   = `${systemPrompt}\n\nTRANSCRIPT:\n${rawTranscript}`;

  const message = await client.messages.create({
    model:      'claude-haiku-4-5-20251001', // fast + cheap for structured extraction
    max_tokens: 1024,
    messages:   [{ role: 'user', content: fullPrompt }],
  });

  const responseText = message.content[0]?.text || '';

  // Extract JSON block from response (Claude may wrap it in markdown sometimes)
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Claude did not return a valid JSON object in its response');
  }

  const extractedData = JSON.parse(jsonMatch[0]);

  return { isMock: false, extractedData };
}

module.exports = { extractProfileFromTranscript };
