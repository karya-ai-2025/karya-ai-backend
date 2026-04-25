const Conversation = require('../models/Conversation');

const getConversations = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { status, page = 1, limit = 50 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    const filters = {};
    if (status) filters.status = status;

    const conversations = await Conversation.findByUser(userId, filters)
      .limit(limitNum)
      .skip((pageNum - 1) * limitNum);

    const total = await Conversation.countDocuments({ userId, ...filters });

    res.json({
      success: true,
      data: conversations,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalCount: total,
        hasNext: pageNum < Math.ceil(total / limitNum),
        hasPrev: pageNum > 1
      }
    });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch conversations',
      error: error.message
    });
  }
};

const getConversation = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const conversation = await Conversation.findOne({
      _id: req.params.id,
      userId
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    res.json({
      success: true,
      data: conversation
    });
  } catch (error) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch conversation',
      error: error.message
    });
  }
};

const createConversation = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { title } = req.body;

    const conversation = await Conversation.create({
      userId,
      title: title || 'New conversation',
      messages: [],
      lastActivityAt: new Date()
    });

    res.status(201).json({
      success: true,
      data: conversation,
      message: 'Conversation created successfully'
    });
  } catch (error) {
    console.error('Error creating conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create conversation',
      error: error.message
    });
  }
};

const addMessage = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { role, content } = req.body;

    if (!role || !content) {
      return res.status(400).json({
        success: false,
        message: 'Role and content are required'
      });
    }

    const newMessage = { role, content, timestamp: new Date() };

    const conversation = await Conversation.findOne({
      _id: req.params.id,
      userId
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    const updateOps = {
      $push: { messages: newMessage },
      $set: { lastActivityAt: new Date() }
    };

    if (role === 'user' && conversation.title === 'New conversation') {
      updateOps.$set.title = content.substring(0, 100);
    }

    const updated = await Conversation.findOneAndUpdate(
      { _id: req.params.id, userId },
      updateOps,
      { new: true, select: 'title lastActivityAt' }
    );

    res.status(201).json({
      success: true,
      data: {
        message: newMessage,
        title: updated.title
      }
    });
  } catch (error) {
    console.error('Error adding message:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add message',
      error: error.message
    });
  }
};

const updateConversation = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { title, status, elevenlabsConversationId } = req.body;

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (status !== undefined) updates.status = status;
    if (elevenlabsConversationId !== undefined) updates.elevenlabsConversationId = elevenlabsConversationId;

    const conversation = await Conversation.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: updates },
      { new: true }
    );

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    res.json({
      success: true,
      data: conversation,
      message: 'Conversation updated successfully'
    });
  } catch (error) {
    console.error('Error updating conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update conversation',
      error: error.message
    });
  }
};

const deleteConversation = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const conversation = await Conversation.findOneAndDelete({
      _id: req.params.id,
      userId
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    res.json({
      success: true,
      message: 'Conversation deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete conversation',
      error: error.message
    });
  }
};

module.exports = {
  getConversations,
  getConversation,
  createConversation,
  addMessage,
  updateConversation,
  deleteConversation
};
