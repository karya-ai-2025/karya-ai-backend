const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getConversations,
  getConversation,
  createConversation,
  addMessage,
  updateConversation,
  deleteConversation
} = require('../controllers/conversationController');

router.use(protect);

router.route('/')
  .get(getConversations)
  .post(createConversation);

router.route('/:id')
  .get(getConversation)
  .put(updateConversation)
  .delete(deleteConversation);

router.post('/:id/messages', addMessage);

module.exports = router;
