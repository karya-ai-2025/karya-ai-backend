const Anthropic = require('@anthropic-ai/sdk');
const { config } = require('../config/config');

const SUPPORT_SYSTEM_PROMPT = `
You are Karya AI's in-app support assistant.

Your job:
- Help authenticated Karya AI users understand the platform and decide where to go next.
- Answer support questions clearly and concisely.
- Ask one focused follow-up question when the user's request is ambiguous.
- If the user asks you to create projects, generate PPTs, run campaigns, change billing, or modify account data, explain that you can guide them for now but cannot execute that action yet.
- Do not claim that background work has been completed unless a tool or backend response confirms it.
- Keep responses practical, friendly, and under 180 words unless the user asks for detail.

Safety:
- Do not ask for passwords, API keys, payment card numbers, or private credentials.
- Do not invent product capabilities. If unsure, say what you can help with next.
`.trim();

let anthropicClient;

const requireAnthropicConfig = (key, value) => {
  if (value === undefined || value === null || value === '') {
    throw createAnthropicError(
      `${key} is not configured. Add it to the backend .env file and restart the server.`,
      503,
      'ANTHROPIC_NOT_CONFIGURED'
    );
  }

  return value;
};

const getAnthropicClient = () => {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: requireAnthropicConfig('ANTHROPIC_API_KEY', config.anthropic.apiKey),
      timeout: requireAnthropicConfig('ANTHROPIC_TIMEOUT_MS', config.anthropic.timeoutMs),
      maxRetries: requireAnthropicConfig('ANTHROPIC_MAX_RETRIES', config.anthropic.maxRetries),
      defaultHeaders: {
        'anthropic-version': requireAnthropicConfig('ANTHROPIC_API_VERSION', config.anthropic.apiVersion)
      }
    });
  }

  return anthropicClient;
};

const mapStoredMessagesToClaude = (messages = []) => {
  return messages
    .filter((message) => ['user', 'agent'].includes(message.role))
    .slice(-30)
    .map((message) => ({
      role: message.role === 'agent' ? 'assistant' : 'user',
      content: message.content
    }));
};

const extractText = (message) => {
  if (!Array.isArray(message?.content)) return '';

  return message.content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
};

function createAnthropicError(message, statusCode = 500, code = 'ANTHROPIC_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

const normalizeModel = (model) => {
  const trimmedModel = requireAnthropicConfig('ANTHROPIC_MODEL', model).trim();

  if (/^gpt-/i.test(trimmedModel)) {
    throw createAnthropicError(
      `ANTHROPIC_MODEL is set to "${trimmedModel}", but this endpoint calls Anthropic. Use a valid Claude model ID.`,
      500,
      'ANTHROPIC_MODEL_INVALID'
    );
  }

  if (/^(us|eu|apac|global)\.anthropic\./i.test(trimmedModel) || /^anthropic\./i.test(trimmedModel) || /-v\d+:\d+$/i.test(trimmedModel)) {
    throw createAnthropicError(
      `ANTHROPIC_MODEL is set to "${trimmedModel}", which looks like an AWS Bedrock model ID. This service uses the direct Anthropic SDK, so set ANTHROPIC_MODEL to a direct Claude model ID.`,
      500,
      'ANTHROPIC_MODEL_INVALID'
    );
  }

  return trimmedModel;
};

const normalizeSdkError = (error) => {
  if (error.code && error.statusCode) return error;

  const statusCode = error.status || error.statusCode || 500;
  const code = error.code || error.error?.type || 'ANTHROPIC_ERROR';
  const message = error.message || 'Anthropic SDK request failed.';

  return createAnthropicError(message, statusCode, code);
};

const generateSupportReply = async ({ messages }) => {
  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: normalizeModel(config.anthropic.model),
      max_tokens: requireAnthropicConfig('ANTHROPIC_MAX_TOKENS', config.anthropic.maxTokens),
      system: SUPPORT_SYSTEM_PROMPT,
      messages: mapStoredMessagesToClaude(messages)
    });

    const reply = extractText(response);
    if (!reply) {
      throw createAnthropicError('Anthropic returned an empty response.');
    }

    return reply;
  } catch (error) {
    throw normalizeSdkError(error);
  }
};

module.exports = {
  generateSupportReply
};
