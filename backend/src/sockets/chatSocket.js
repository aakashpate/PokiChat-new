const { createMessage, toggleReaction } = require('../store/messages');
const { imageAvailable } = require('../store/uploads');
const { verifySocketToken } = require('../middleware/auth');
const { toClientMessage } = require('../utils/message');
const conversations = require('../store/conversations');
const realtime = require('./realtime');
const presence = require('./presence');
const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');

const VALID_REACTIONS = ['like', 'love', 'laugh', 'sad', 'angry'];
const IMAGE_URL_PATTERN = /^\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_TEXT = 1000;

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

  io.use(async (socket, next) => {
    socket.data.identity = null;
    socket.data.conversations = new Set();

    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next();

    const identity = verifySocketToken(token);
    if (!identity) return next(new Error('Invalid session'));

    try {
      const user = await User.findById(identity.userId).select('+tokenVersion');
      if (!user || Number(user.tokenVersion || 0) !== Number(identity.ver || 0)) {
        return next(new Error('Invalid session'));
      }
      socket.data.identity = { userId: String(user._id), username: user.username };
      next();
    } catch (error) {
      return next(new Error('Invalid session'));
    }
  });

  const notifyConnections = async (userId, online) => {
    try {
      const rows = await Conversation.find({ participants: userId }).select('participants');
      const ids = new Set();
      rows.forEach((row) => {
        row.participants.forEach((participant) => {
          const id = String(participant);
          if (id !== String(userId)) ids.add(id);
        });
      });
      if (!ids.size) return;
      realtime.emitToUsers([...ids], 'presence_update', {
        userId: String(userId),
        online,
        lastSeen: online ? null : new Date(),
        at: new Date(),
      });
    } catch (error) {
      console.error(`presence notify failed: ${error.message}`);
    }
  };

  const conversationUpdated = (conversation, senderId) => {
    conversation.participants.forEach((participant) => {
      const id = String(participant._id || participant);
      realtime.emitToUser(id, 'conversation_updated', {
        conversationId: String(conversation._id),
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

  const handleJoin = async (socket, data) => {
    const identity = socket.data.identity;
    if (!identity) return { ok: false, error: 'Authentication required' };

    const conversationId = String(data?.conversationId || '');
    const conversation = await conversations.getOwnedConversation(conversationId, identity.userId);
    if (!conversation) return { ok: false, error: 'Conversation not found' };

    socket.join(`conv:${conversationId}`);
    socket.data.conversations.add(conversationId);

    const other = conversations.otherParticipant(conversation, identity.userId);

    const delivered = await conversations.markDelivered(conversation._id, identity.userId);
    if (delivered.length) {
      realtime.emitToUser(String(delivered[0].sender), 'message_delivered', {
        conversationId,
        messageIds: delivered.map((m) => String(m._id)),
        at: delivered[0].deliveredAt,
      });
    }

    const marked = await conversations.markRead(conversation._id, identity.userId);
    if (marked && other) {
      realtime.emitToUser(String(other._id), 'messages_read', {
        conversationId,
        readerId: String(identity.userId),
        at: new Date(),
      });
    }

    return {
      ok: true,
      conversationId,
      online: other ? presence.isOnline(other._id) : false,
      lastSeen: other ? other.lastSeen : null,
    };
  };

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    const identity = socket.data.identity;

    if (identity) {
      socket.join(`user:${identity.userId}`);
      if (presence.add(identity.userId, socket.id)) {
        notifyConnections(identity.userId, true);
      }
    }

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

        if (trimmedText.length > MAX_TEXT) return;

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

        const target = await Message.findById(messageId).select('conversation');
        if (target && target.conversation) {
          const allowed =
            socket.data.identity &&
            socket.data.conversations.has(String(target.conversation));
          if (!allowed) {
            socket.emit('message_error', { message: 'Message not found' });
            return;
          }
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

    socket.on('join_conversation', async (data, ack) => {
      try {
        const result = await handleJoin(socket, data);
        if (typeof ack === 'function') ack(result);
      } catch (error) {
        console.error(`join_conversation failed: ${error.message}`);
        if (typeof ack === 'function') ack({ ok: false, error: 'Failed to open conversation' });
      }
    });

    socket.on('leave_conversation', (data) => {
      const conversationId = String(data?.conversationId || '');
      if (!conversationId) return;
      socket.leave(`conv:${conversationId}`);
      socket.data.conversations.delete(conversationId);
    });

    socket.on('send_conversation_message', async (data, ack) => {
      try {
        const respond = (payload) => {
          if (typeof ack === 'function') ack(payload);
        };

        const identity = socket.data.identity;
        if (!identity) return respond({ ok: false, error: 'Authentication required' });

        const conversationId = String(data?.conversationId || '');
        if (!socket.data.conversations.has(conversationId)) {
          return respond({ ok: false, error: 'Join the conversation before sending messages' });
        }

        const conversation = await conversations.getOwnedConversation(conversationId, identity.userId);
        if (!conversation) return respond({ ok: false, error: 'Conversation not found' });

        const type = data?.type === 'image' ? 'image' : 'text';
        const text = String(data?.text || '').trim();
        const imageUrl = type === 'image' ? String(data?.imageUrl || '') : null;

        if (type === 'image') {
          if (!IMAGE_URL_PATTERN.test(imageUrl || '') || !(await imageAvailable(imageUrl))) {
            return respond({ ok: false, error: 'Upload the image before sending it' });
          }
        } else if (!text) {
          return respond({ ok: false, error: 'Message text is required' });
        }

        if (text.length > MAX_TEXT) {
          return respond({ ok: false, error: 'Message cannot exceed 1000 characters' });
        }

        const message = await conversations.createConversationMessage({
          conversation,
          senderId: identity.userId,
          senderUsername: identity.username,
          text,
          type,
          imageUrl,
        });

        const other = conversations.otherParticipant(conversation, identity.userId);
        if (other && presence.isOnline(other._id)) {
          message.deliveredAt = new Date();
          await message.save();
        }

        const payload = toClientMessage(message);

        realtime.emitToConversation(conversationId, 'conversation_message', {
          conversationId,
          message: payload,
        });
        conversationUpdated(conversation, identity.userId);

        if (message.deliveredAt) {
          realtime.emitToUser(String(identity.userId), 'message_delivered', {
            conversationId,
            messageIds: [String(message._id)],
            at: message.deliveredAt,
          });
        }

        respond({ ok: true, message: payload });
      } catch (error) {
        console.error(`send_conversation_message failed: ${error.message}`);
        if (typeof ack === 'function') {
          respond({ ok: false, error: 'Failed to send message' });
        }
      }
    });

    socket.on('mark_read', async (data, ack) => {
      try {
        const respond = (payload) => {
          if (typeof ack === 'function') ack(payload);
        };

        const identity = socket.data.identity;
        if (!identity) return respond({ ok: false, error: 'Authentication required' });

        const conversationId = String(data?.conversationId || '');
        if (!socket.data.conversations.has(conversationId)) {
          return respond({ ok: false, error: 'Join the conversation first' });
        }

        const conversation = await conversations.getOwnedConversation(conversationId, identity.userId);
        if (!conversation) return respond({ ok: false, error: 'Conversation not found' });

        const marked = await conversations.markRead(conversation._id, identity.userId);
        const other = conversations.otherParticipant(conversation, identity.userId);

        if (other) {
          realtime.emitToUser(String(other._id), 'messages_read', {
            conversationId,
            readerId: String(identity.userId),
            at: new Date(),
          });
        }

        respond({ ok: true, marked });
      } catch (error) {
        console.error(`mark_read failed: ${error.message}`);
        if (typeof ack === 'function') respond({ ok: false, error: 'Failed to mark as read' });
      }
    });

    const typingIn = (conversationId, isTyping) => {
      if (!identity) return;
      const id = String(conversationId || '');
      if (!socket.data.conversations.has(id)) return;
      socket.to(`conv:${id}`).emit(isTyping ? 'typing_start' : 'typing_stop', {
        conversationId: id,
        userId: String(identity.userId),
        username: identity.username,
      });
    };

    socket.on('typing_start', (data) => {
      if (data && data.conversationId) {
        typingIn(data.conversationId, true);
        return;
      }
      const username = connectedUsers.get(socket.id);
      if (username) {
        socket.broadcast.emit('typing_start', { username });
      }
    });

    socket.on('typing_stop', (data) => {
      if (data && data.conversationId) {
        typingIn(data.conversationId, false);
        return;
      }
      const username = connectedUsers.get(socket.id);
      if (username) {
        socket.broadcast.emit('typing_stop', { username });
      }
    });

    socket.on('get_presence', async (data, ack) => {
      const respond = (payload) => {
        if (typeof ack === 'function') ack(payload);
      };

      const ids = (Array.isArray(data?.userIds) ? data.userIds : [])
        .map(String)
        .slice(0, 50);

      if (!ids.length) return respond({ ok: false, error: 'userIds are required' });

      const online = {};
      const offlineIds = [];
      ids.forEach((id) => {
        if (presence.isOnline(id)) online[id] = true;
        else {
          online[id] = false;
          offlineIds.push(id);
        }
      });

      let lastSeen = {};
      if (offlineIds.length) {
        const users = await User.find({ _id: { $in: offlineIds } }).select('lastSeen');
        users.forEach((user) => {
          lastSeen[String(user._id)] = user.lastSeen;
        });
      }

      respond({ ok: true, online, lastSeen });
    });

    socket.on('disconnect', () => {
      const username = connectedUsers.get(socket.id);
      connectedUsers.delete(socket.id);

      if (username) {
        socket.broadcast.emit('typing_stop', { username });
      }

      io.emit('online_users', connectedUsers.size);
      console.log(`${username || socket.id} disconnected. Online: ${connectedUsers.size}`);

      if (identity) {
        const becameOffline = presence.remove(identity.userId, socket.id);
        if (becameOffline) {
          User.updateOne({ _id: identity.userId }, { $set: { lastSeen: new Date() } }).catch(() => {});
          notifyConnections(identity.userId, false);
        }
      }
    });
  });
};

module.exports = chatSocket;
