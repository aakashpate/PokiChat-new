const router = require('express').Router();
const { listConversations, createConversation, getConversation, getMessages, sendMessage, markRead } =
  require('../controllers/conversationController');
const { requireAuth, loadUser } = require('../middleware/auth');

router.use(requireAuth, loadUser);

router.get('/conversations', listConversations);
router.post('/conversations', createConversation);
router.get('/conversations/:id', getConversation);
router.get('/conversations/:id/messages', getMessages);
router.post('/conversations/:id/messages', sendMessage);
router.post('/conversations/:id/read', markRead);

module.exports = router;
