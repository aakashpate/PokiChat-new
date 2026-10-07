const toClientMessage = (message) => ({
  _id: message._id,
  conversation: message.conversation || null,
  username: message.username,
  sender: message.sender || null,
  recipient: message.recipient || null,
  text: message.text || '',
  type: message.type || 'text',
  imageUrl: message.imageUrl || null,
  reactions: message.reactions || {},
  readBy: (message.readBy || []).map(String),
  deliveredAt: message.deliveredAt || null,
  createdAt: message.createdAt,
});

module.exports = { toClientMessage };
