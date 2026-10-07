const socketsByUser = new Map();

const add = (userId, socketId) => {
  const key = String(userId);
  const existing = socketsByUser.get(key);
  if (existing) {
    existing.add(socketId);
    return false;
  }
  socketsByUser.set(key, new Set([socketId]));
  return true;
};

const remove = (userId, socketId) => {
  const key = String(userId);
  const existing = socketsByUser.get(key);
  if (!existing) return true;

  existing.delete(socketId);
  if (existing.size === 0) {
    socketsByUser.delete(key);
    return true;
  }
  return false;
};

const isOnline = (userId) => socketsByUser.has(String(userId));

const count = () => socketsByUser.size;

module.exports = { add, remove, isOnline, count };
