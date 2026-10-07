const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

const sortedPair = (a, b) =>
  [String(a), String(b)]
    .sort()
    .map((id) => new mongoose.Types.ObjectId(id));

const findDirect = async (a, b) =>
  Conversation.findOne({ participants: { $all: [String(a), String(b)], $size: 2 } }).populate(
    'participants',
    'username lastSeen'
  );

const createOrGetDirect = async (a, b) => {
  const existing = await findDirect(a, b);
  if (existing) return existing;

  try {
    const created = await Conversation.create({
      type: 'direct',
      participants: sortedPair(a, b),
      lastMessage: { text: '', type: 'text', sender: null, at: new Date() },
    });
    return await created.populate('participants', 'username lastSeen');
  } catch (error) {
    if (error && error.code === 11000) {
      const concurrent = await findDirect(a, b);
      if (concurrent) return concurrent;
    }
    throw error;
  }
};

const getOwnedConversation = async (conversationId, userId) => {
  if (!isObjectId(conversationId)) return null;
  const conversation = await Conversation.findById(conversationId).populate(
    'participants',
    'username lastSeen'
  );
  if (!conversation) return null;
  return conversation.includesUser(userId) ? conversation : null;
};

const otherParticipant = (conversation, userId) =>
  conversation.participants.find((p) => String(p._id) !== String(userId)) || null;

const unreadCountFor = async (conversationId, userId) =>
  Message.countDocuments({
    conversation: conversationId,
    sender: { $ne: userId },
    readBy: { $ne: userId },
  });

const unreadCounts = async (conversationIds, userId) => {
  if (!conversationIds.length) return new Map();

  const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

  const rows = await Message.aggregate([
    {
      $match: {
        conversation: { $in: conversationIds.map(toObjectId) },
        sender: { $ne: toObjectId(userId) },
        readBy: { $ne: toObjectId(userId) },
      },
    },
    { $group: { _id: '$conversation', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
};

const createConversationMessage = async ({
  conversation,
  senderId,
  senderUsername,
  text = '',
  type = 'text',
  imageUrl = null,
}) => {
  const message = await Message.create({
    username: senderUsername,
    text,
    type,
    imageUrl,
    reactions: {},
    conversation: conversation._id,
    sender: senderId,
    recipient: otherParticipant(conversation, senderId)?._id || null,
    readBy: [senderId],
  });

  conversation.lastMessage = {
    text: type === 'image' ? '' : text,
    type,
    sender: senderId,
    at: message.createdAt,
  };
  conversation.updatedAt = new Date();
  await conversation.save();

  return message;
};

const markRead = async (conversationId, userId) => {
  const result = await Message.updateMany(
    {
      conversation: conversationId,
      sender: { $ne: userId },
      readBy: { $ne: userId },
    },
    { $addToSet: { readBy: userId } }
  );

  return result.modifiedCount;
};

const markDelivered = async (conversationId, recipientId) => {
  const result = await Message.updateMany(
    {
      conversation: conversationId,
      sender: { $ne: recipientId },
      deliveredAt: null,
    },
    { $set: { deliveredAt: new Date() } }
  );

  if (!result.modifiedCount) return [];

  return Message.find({
    conversation: conversationId,
    sender: { $ne: recipientId },
  })
    .select('_id sender conversation deliveredAt')
    .sort({ createdAt: 1 });
};

const listMessages = async (conversationId, { before = null, limit = 50 } = {}) => {
  const query = { conversation: conversationId };
  if (before) query.createdAt = { $lt: new Date(before) };

  const rows = await Message.find(query)
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(Number(limit) || 50, 1), 100));

  return rows.reverse();
};

module.exports = {
  isObjectId,
  findDirect,
  createOrGetDirect,
  getOwnedConversation,
  otherParticipant,
  unreadCountFor,
  unreadCounts,
  createConversationMessage,
  markRead,
  markDelivered,
  listMessages,
};
