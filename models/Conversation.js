const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: {
      values: ['user', 'agent', 'system'],
      message: 'Role must be user, agent, or system'
    },
    required: [true, 'Message role is required']
  },
  content: {
    type: String,
    required: [true, 'Message content is required'],
    trim: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

const conversationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true
    },
    title: {
      type: String,
      trim: true,
      default: 'New conversation',
      maxlength: [200, 'Title cannot exceed 200 characters']
    },
    messages: [messageSchema],
    elevenlabsConversationId: {
      type: String,
      default: null
    },
    status: {
      type: String,
      enum: {
        values: ['active', 'archived'],
        message: 'Status must be active or archived'
      },
      default: 'active',
      index: true
    },
    lastActivityAt: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

conversationSchema.index({ userId: 1, lastActivityAt: -1 });
conversationSchema.index({ userId: 1, status: 1 });

conversationSchema.statics.findByUser = function (userId, filters = {}) {
  return this.find({ userId, ...filters })
    .select('title status lastActivityAt createdAt')
    .sort({ lastActivityAt: -1 });
};

conversationSchema.methods.toJSON = function () {
  const conv = this.toObject();
  delete conv.__v;
  return conv;
};

const Conversation = mongoose.model('Conversation', conversationSchema, 'conversations');

module.exports = Conversation;
