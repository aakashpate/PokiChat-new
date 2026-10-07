const Message = require('../models/Message');
const { isDBConnected } = require('../config/database');

const memoryMessages = [];
let sequence = 0;

// The public room keeps website traffic private from direct messages:
// only messages without a conversation are visible to anonymous callers.
const PUBLIC_ROOM_FILTER = {
  $or: [{ conversation: { $exists: false } }, { conversation: null }],
};

const createId = () => {
  sequence += 1;
  return `mem_${Date.now().toString(16)}${sequence.toString(16)}`;
};

const sortByCreatedAt = (list) =>
  [...list].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

const listMessages = async () => {
  if (isDBConnected()) {
    return Message.find(PUBLIC_ROOM_FILTER).sort({ createdAt: 1 });
  }

  return sortByCreatedAt(memoryMessages.filter((item) => !item.conversation));
};

const createMessage = async ({
  username,
  text = '',
  type = 'text',
  imageUrl = null,
  reactions = {},
}) => {
  if (isDBConnected()) {
    return Message.create({ username, text, type, imageUrl, reactions });
  }

  const now = new Date().toISOString();
  const message = {
    _id: createId(),
    username,
    text,
    type,
    imageUrl,
    reactions: { ...reactions },
    createdAt: now,
    updatedAt: now,
  };

  memoryMessages.push(message);
  return message;
};

const applyReaction = (reactions, username, emoji) => {
  const next = { ...(reactions || {}) };
  if (next[username] === emoji) {
    delete next[username];
  } else {
    next[username] = emoji;
  }
  return next;
};

const toggleReaction = async (messageId, username, emoji) => {
  if (isDBConnected()) {
    const message = await Message.findById(messageId);
    if (!message) return null;
    message.reactions = applyReaction(message.reactions, username, emoji);
    await message.save();
    return message;
  }

  const message = memoryMessages.find((item) => String(item._id) === String(messageId));
  if (!message) return null;

  message.reactions = applyReaction(message.reactions, username, emoji);
  message.updatedAt = new Date().toISOString();
  return message;
};

module.exports = { listMessages, createMessage, toggleReaction };
