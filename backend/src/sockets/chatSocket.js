const { createMessage, toggleReaction } = require('../store/messages');
const { imageAvailable } = require('../store/uploads');

const VALID_REACTIONS = ['like', 'love', 'laugh', 'sad', 'angry'];
const IMAGE_URL_PATTERN = /^\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

const chatSocket = (io) => {
  const connectedUsers = new Map();

  const publicMessage = (message) => ({
    _id: message._id,
    username: message.username,
    text: message.text || '',
    type: message.type || 'text',
    imageUrl: message.imageUrl || null,
    reactions: message.reactions || {},
    createdAt: message.createdAt,
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('join_chat', (username) => {
      if (!username || !username.trim()) return;

      const trimmed = username.trim();
      connectedUsers.set(socket.id, trimmed);

      io.emit('online_users', connectedUsers.size);
      console.log(`${trimmed} joined. Online: ${connectedUsers.size}`);
    });

    socket.on('send_message', async (data) => {
      try {
        const { username, text = '', type, imageUrl = null } = data || {};

        if (!username || !username.trim()) return;

        const trimmedUsername = username.trim();
        const trimmedText = String(text || '').trim();
        const isImage = type === 'image';

        if (trimmedUsername.length > 30) return;

        if (isImage) {
          const uploaded =
            imageUrl && IMAGE_URL_PATTERN.test(imageUrl) && (await imageAvailable(imageUrl));

          if (!uploaded) {
            socket.emit('message_error', {
              message: 'Upload the image before sending it',
            });
            return;
          }
        } else if (!trimmedText) {
          return;
        }

        if (trimmedText.length > 1000) return;

        const message = await createMessage({
          username: trimmedUsername,
          text: trimmedText,
          type: isImage ? 'image' : 'text',
          imageUrl: isImage ? imageUrl : null,
        });

        io.emit('receive_message', publicMessage(message));
      } catch (error) {
        console.error('Error saving message:', error.message);
        socket.emit('message_error', { message: 'Failed to send message' });
      }
    });

    socket.on('toggle_reaction', async (data) => {
      try {
        const { messageId, username, emoji } = data || {};

        if (!messageId || !username || !username.trim() || !emoji) {
          socket.emit('message_error', { message: 'Invalid reaction data' });
          return;
        }

        if (!VALID_REACTIONS.includes(emoji)) {
          socket.emit('message_error', { message: 'Invalid emoji type' });
          return;
        }

        const updated = await toggleReaction(messageId, username.trim(), emoji);

        if (!updated) {
          socket.emit('message_error', { message: 'Message not found' });
          return;
        }

        io.emit('reaction_toggled', {
          _id: updated._id,
          reactions: updated.reactions || {},
        });
      } catch (error) {
        console.error('Error toggling reaction:', error.message);
        socket.emit('message_error', { message: 'Failed to update reaction' });
      }
    });

    socket.on('typing_start', () => {
      const username = connectedUsers.get(socket.id);
      if (username) {
        socket.broadcast.emit('typing_start', { username });
      }
    });

    socket.on('typing_stop', () => {
      const username = connectedUsers.get(socket.id);
      if (username) {
        socket.broadcast.emit('typing_stop', { username });
      }
    });

    socket.on('disconnect', () => {
      const username = connectedUsers.get(socket.id);
      connectedUsers.delete(socket.id);

      if (username) {
        socket.broadcast.emit('typing_stop', { username });
      }

      io.emit('online_users', connectedUsers.size);
      console.log(`${username || socket.id} disconnected. Online: ${connectedUsers.size}`);
    });
  });
};

module.exports = chatSocket;
