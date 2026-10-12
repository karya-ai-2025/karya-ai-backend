// services/elevenLabsService.js
// Thin client for the ElevenLabs Agents API. The API key never leaves the
// server: the browser only ever receives a short-lived conversation token.

const { config } = require('../config/config');

const isConfigured = () => !!(config.elevenlabs.apiKey && config.elevenlabs.agentId);

const request = async (path, { method = 'GET', body } = {}) => {
  const response = await fetch(`${config.elevenlabs.apiBase}${path}`, {
    method,
    headers: {
      'xi-api-key': config.elevenlabs.apiKey,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.detail?.message || (typeof data?.detail === 'string' ? data.detail : JSON.stringify(data?.detail || data));
    const err = new Error(`ElevenLabs ${method} ${path.split('?')[0]} failed (${response.status}): ${detail}`);
    err.status = response.status;
    throw err;
  }
  return data;
};

// Short-lived token the browser uses to join the call over WebRTC
const getConversationToken = async (agentId = config.elevenlabs.agentId) => {
  const data = await request(`/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`);
  if (!data.token) throw new Error('ElevenLabs returned no conversation token');
  return data.token;
};

// Full conversation record: status, transcript, metadata, analysis
const getConversation = (conversationId) =>
  request(`/v1/convai/conversations/${encodeURIComponent(conversationId)}`);

const createAgent = (body) => request('/v1/convai/agents/create', { method: 'POST', body });

module.exports = { isConfigured, getConversationToken, getConversation, createAgent };
