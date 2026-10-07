const User = require('../models/User');
const Conversation = require('../models/Conversation');
const realtime = require('../sockets/realtime');
const { toClientMessage } = require('../utils/message');
const {
  isObjectId,
  createOrGetDirect,
  getOwnedConversation,
  otherParticipant,
  unreadCountFor,
  unreadCounts,
  createConversationMessage,
  markRead,
  listMessages,
} = require('../store/conversations');

const IMAGE_URL_PATTERN = /^\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_TEXT = 1000;

const imageReady = async (imageUrl) => {
  const { imageAvailable } = require('../store/uploads');
  return imageAvailable(String(imageUrl));
};

const notFound = (res) => res.status(404).json({ success: false, message: 'Conversation not found' });

const forbidden = (res) =>
  res.status(403).json({ success: false, message: 'You are not a participant of this conversation' });

const conversationPayload = (conversation, other, unreadCount) => ({
  _id: conversation._id,
  type: conversation.type,
  otherParticipant: other,
  lastMessage: {
    text: conversation.lastMessage?.text || '',
    type: conversation.lastMessage?.type || 'text',
    sender: conversation.lastMessage?.sender || null,
    at: conversation.lastMessage?.at || conversation.updatedAt,
  },
  unreadCount,
  updatedAt: conversation.updatedAt,
  createdAt: conversation.createdAt,
});

const toPublicUser = (user) =>
  user ? { _id: user._id, username: user.username, lastSeen: user.lastSeen || null } : null;

exports.listConversations = async (req, res, next) => {
  try {
    const userId = req.auth.userId;

    const conversations = await Conversation.find({ participants: userId })
      .populate('participants', 'username lastSeen')
      .sort({ updatedAt: -1 })
      .limit(100);

    const ids = conversations.map((c) => c._id);
    const counts = await unreadCounts(ids, userId);

    res.json({
      success: true,
      data: conversations.map((conversation) =>
        conversationPayload(
          conversation,
          toPublicUser(otherParticipant(conversation, userId)),
          counts.get(String(conversation._id)) || 0
        )
      ),
    });
  } catch (error) {
    next(error);
  }
};

exports.createConversation = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const otherId = req.body?.userId;

    if (!isObjectId(otherId)) {
      return res.status(400).json({ success: false, message: 'A valid userId is required' });
    }

    if (String(otherId) === userId) {
      return res.status(400).json({ success: false, message: 'You cannot start a chat with yourself' });
    }

    const other = await User.findById(otherId);
    if (!other) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const conversation = await createOrGetDirect(userId, otherId);
    const unread = await unreadCountFor(conversation._id, userId);

    res.status(201).json({
      success: true,
      data: conversationPayload(
        conversation,
        toPublicUser(otherParticipant(conversation, userId)),
        unread
      ),
    });
  } catch (error) {
    next(error);
  }
};

exports.getMessages = async (req, res, next) => {
  try {
    const conversation = await getOwnedConversation(req.params.id, req.auth.userId);
    if (!conversation) return notFound(res);

    const messages = await listMessages(conversation._id, {
      before: req.query.before || null,
      limit: req.query.limit,
    });

    res.json({
      success: true,
      data: messages.map(toClientMessage),
      hasMore: messages.length === Math.min(Math.max(Number(req.query.limit) || 50, 1), 100),
    });
  } catch (error) {
    next(error);
  }
};

exports.sendMessage = async (req, res, next) => {
  try {
    const conversation = await getOwnedConversation(req.params.id, req.auth.userId);
    if (!conversation) return notFound(res);

    const { text = '', type = 'text', imageUrl = null } = req.body || {};
    const trimmedText = String(text || '').trim();
    const isImage = type === 'image';

    if (isImage) {
      const validPath = imageUrl && IMAGE_URL_PATTERN.test(String(imageUrl));
      if (!validPath || !(await imageReady(String(imageUrl)))) {
        return res.status(400).json({ success: false, message: 'Upload the image before sending it' });
      }
    } else if (!trimmedText) {
      return res.status(400).json({ success: false, message: 'Message text is required' });
    }

    if (trimmedText.length > MAX_TEXT) {
      return res.status(400).json({ success: false, message: 'Message cannot exceed 1000 characters' });
    }

    const message = await createConversationMessage({
      conversation,
      senderId: req.auth.userId,
      senderUsername: req.user.username,
      text: trimmedText,
      type: isImage ? 'image' : 'text',
      imageUrl: isImage ? String(imageUrl) : null,
    });

    const payload = toClientMessage(message);
    realtime.emitToConversation(conversation._id, 'conversation_message', {
      conversationId: String(conversation._id),
      message: payload,
    });
    emitConversationUpdated(conversation, req.auth.userId);

    res.status(201).json({ success: true, data: payload });
  } catch (error) {
    next(error);
  }
};

const emitConversationUpdated = (conversation, senderId) => {
  conversation.participants.forEach((participant) => {
    realtime.emitToUser(participant._id || participant, 'conversation_updated', {
      conversationId: String(conversation._id),
      otherParticipantId: String(
        otherParticipant(conversation, participant._id || participant)?._id || ''
      ),
      lastMessage: {
        text: conversation.lastMessage?.text || '',
        type: conversation.lastMessage?.type || 'text',
        sender: conversation.lastMessage?.sender || null,
        at: conversation.lastMessage?.at,
      },
      senderId: String(senderId),
      updatedAt: conversation.updatedAt,
    });
  });
};

exports.emitConversationUpdated = emitConversationUpdated;

exports.markRead = async (req, res, next) => {
  try {
    const conversation = await getOwnedConversation(req.params.id, req.auth.userId);
    if (!conversation) return notFound(res);

    const modified = await markRead(conversation._id, req.auth.userId);
    const readerId = req.auth.userId;

    conversation.participants.forEach((participant) => {
      const id = String(participant._id || participant);
      if (id === readerId) return;
      realtime.emitToUser(id, 'messages_read', {
        conversationId: String(conversation._id),
        readerId,
        at: new Date(),
      });
    });

    res.json({ success: true, data: { marked: modified } });
  } catch (error) {
    next(error);
  }
};

exports.getConversation = async (req, res, next) => {
  try {
    const conversation = await getOwnedConversation(req.params.id, req.auth.userId);
    if (!conversation) return notFound(res);

    const unread = await unreadCountFor(conversation._id, req.auth.userId);

    res.json({
      success: true,
      data: conversationPayload(
        conversation,
        toPublicUser(otherParticipant(conversation, req.auth.userId)),
        unread
      ),
    }    );
  } catch (error) {
    next(error);
  }
};

