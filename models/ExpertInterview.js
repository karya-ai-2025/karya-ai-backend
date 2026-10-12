const mongoose = require('mongoose');
const { Schema } = mongoose;

// A voice interview between an expert and the ElevenLabs agent, taken after
// onboarding. The transcript feeds the expert knowledge base.
const expertInterviewSchema = new Schema({
  userId:          { type: Schema.Types.ObjectId, ref: 'User', required: true },
  expertProfileId: { type: Schema.Types.ObjectId, ref: 'ExpertProfile', required: true },

  // ElevenLabs
  agentId:        { type: String, required: true },
  conversationId: { type: String, default: undefined }, // set once the browser connects

  // What the agent was told for this expert — kept so a transcript can always
  // be read against the brief that produced it.
  prompt:       { type: String, required: true },
  firstMessage: { type: String, default: '' },
  // Snapshot of the profile fields the brief was built from
  profileSnapshot: { type: Schema.Types.Mixed, default: {} },

  // created     — session issued, browser not connected yet
  // in_progress — call is live
  // processing  — call ended, waiting for ElevenLabs to finish the transcript
  // completed   — transcript saved
  // failed      — ElevenLabs reported a failure, or the transcript never arrived
  // abandoned   — ended with nothing said
  status: {
    type: String,
    enum: ['created', 'in_progress', 'processing', 'completed', 'failed', 'abandoned'],
    default: 'created'
  },

  entries: [{
    _id:            false,
    role:           { type: String, enum: ['agent', 'user'] },
    message:        { type: String },
    timeInCallSecs: { type: Number }
  }],
  rawTranscript:   { type: String, default: null }, // full stitched text
  summary:         { type: String, default: null }, // ElevenLabs' own call summary
  durationSecs:    { type: Number, default: null },

  // Structured knowledge Claude pulled out of the transcript
  extractedData: { type: Schema.Types.Mixed, default: null },
  extractError:  { type: String, default: null },

  fetchAttempts: { type: Number, default: 0 },
  fetchError:    { type: String, default: null },

  startedAt:   { type: Date, default: null },
  endedAt:     { type: Date, default: null },
  completedAt: { type: Date, default: null }
}, { timestamps: true });

expertInterviewSchema.index({ userId: 1, createdAt: -1 });
expertInterviewSchema.index({ status: 1 });
// One row per ElevenLabs conversation; rows that never connected have no id
expertInterviewSchema.index(
  { conversationId: 1 },
  { unique: true, partialFilterExpression: { conversationId: { $type: 'string' } } }
);

module.exports = mongoose.model('ExpertInterview', expertInterviewSchema);
