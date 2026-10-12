/**
 * One-time setup: creates the ElevenLabs agent that interviews experts after
 * onboarding. The agent is private (a conversation token is required) and
 * allows its prompt and first message to be overridden per conversation —
 * the backend supplies a brief tailored to each expert.
 *
 * Needs ELEVENLABS_API_KEY in .env. Prints the agent id to put in
 * ELEVENLABS_INTERVIEW_AGENT_ID.
 *
 * Usage:
 *   node scripts/createElevenLabsInterviewAgent.js                # dry run
 *   node scripts/createElevenLabsInterviewAgent.js --yes          # create
 *   node scripts/createElevenLabsInterviewAgent.js --yes --voice <voice_id> --llm <model>
 */

require('dotenv').config();
const { createAgent } = require('../services/elevenLabsService');

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const CONFIRM = args.includes('--yes');

const body = {
  name: 'Acerstone expert interview',
  conversation_config: {
    agent: {
      // Fallbacks only — every conversation overrides both
      first_message: 'Hi, this is Maya from Acerstone. Is now a good time for a short conversation about your work?',
      language: 'en',
      prompt: {
        prompt: 'You are Maya, an interviewer at Acerstone. Have a short, friendly conversation with an industry expert about their areas of expertise, asking one question at a time.',
        ...(option('--llm') ? { llm: option('--llm') } : {})
      }
    },
    ...(option('--voice') ? { tts: { voice_id: option('--voice') } } : {}),
    conversation: { max_duration_seconds: 1200 }
  },
  platform_settings: {
    auth: { enable_auth: true },
    overrides: {
      conversation_config_override: {
        agent: { first_message: true, prompt: { prompt: true } }
      }
    }
  }
};

(async () => {
  if (!process.env.ELEVENLABS_API_KEY) {
    console.error('\n  ELEVENLABS_API_KEY is not set in .env\n');
    process.exit(1);
  }

  if (!CONFIRM) {
    console.log('\nDry run — would create this agent:\n');
    console.log(JSON.stringify(body, null, 2));
    console.log('\nRe-run with --yes to create it.\n');
    return;
  }

  const { agent_id: agentId } = await createAgent(body);
  console.log(`\n  Agent created. Add this to .env and restart the server:\n\n  ELEVENLABS_INTERVIEW_AGENT_ID=${agentId}\n`);
})().catch((err) => {
  console.error(`\n  ${err.message}\n`);
  process.exit(1);
});
