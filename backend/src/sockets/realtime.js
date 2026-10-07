let io = null;

const attach = (server) => {
  io = server;
};

const isReady = () => Boolean(io);

const emitToConversation = (conversationId, event, payload) => {
  if (!io) return false;
  io.to(`conv:${conversationId}`).emit(event, payload);
  return true;
};

const emitToUser = (userId, event, payload) => {
  if (!io) return false;
  io.to(`user:${userId}`).emit(event, payload);
  return true;
};

const emitToUsers = (userIds, event, payload) => {
  if (!io) return;
  userIds.forEach((id) => io.to(`user:${id}`).emit(event, payload));
};

module.exports = { attach, isReady, emitToConversation, emitToUser, emitToUsers };
