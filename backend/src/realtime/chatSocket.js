const { Server } = require('socket.io');
const { getAdminClient, getAnonClient } = require('../config/supabase');
const { loadAuthContext, hasPermission } = require('../middleware/auth');
const {
  setViewing,
  touchViewing,
  getPresenceMode,
} = require('../services/presenceStore');
const chatService = require('../services/chatService');

/**
 * Socket.IO chat hub.
 * Safeguard: JWT alone is not enough — every join/send/receipt/media path
 * re-checks conversation ACL via chatService.assertCanAccessConversation.
 */
function createChatSocketServer(httpServer, { corsOrigins = [] } = {}) {
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      origin: corsOrigins.length ? corsOrigins : true,
      credentials: true,
    },
  });

  /** userId -> Set(socket.id) */
  const userSockets = new Map();

  function trackSocket(userId, socketId) {
    if (!userSockets.has(userId)) userSockets.set(userId, new Set());
    userSockets.get(userId).add(socketId);
  }

  function untrackSocket(userId, socketId) {
    const set = userSockets.get(userId);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) userSockets.delete(userId);
  }

  const hub = {
    io,
    emitToConversation(conversationId, event, payload) {
      io.to(`conversation:${conversationId}`).emit(event, payload);
    },
    emitToUser(userId, event, payload) {
      io.to(`user:${userId}`).emit(event, payload);
    },
    removeUserFromConversation(userId, conversationId) {
      const set = userSockets.get(userId);
      if (!set) return;
      for (const sid of set) {
        const sock = io.sockets.sockets.get(sid);
        if (sock) sock.leave(`conversation:${conversationId}`);
      }
    },
    presenceMode: () => getPresenceMode(),
  };

  chatService.setChatSocketHub(hub);

  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        (socket.handshake.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!token) return next(new Error('UNAUTHORIZED'));

      const client = getAdminClient() || getAnonClient();
      if (!client) return next(new Error('AUTH_NOT_CONFIGURED'));

      const { data, error } = await client.auth.getUser(token);
      if (error || !data?.user) return next(new Error('UNAUTHORIZED'));

      const ctx = await loadAuthContext(data.user.id);
      if (!ctx.profile || ctx.profile.status !== 'approved' || ctx.profile.deleted_at) {
        return next(new Error('FORBIDDEN'));
      }

      socket.user = {
        id: data.user.id,
        email: data.user.email,
        profile: ctx.profile,
        roles: ctx.roles,
        permissions: ctx.permissions,
      };
      socket.deviceId =
        socket.handshake.auth?.deviceId ||
        socket.handshake.headers['x-device-id'] ||
        socket.id;
      return next();
    } catch (err) {
      return next(err);
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    trackSocket(user.id, socket.id);
    socket.join(`user:${user.id}`);

    socket.emit('chat:ready', {
      userId: user.id,
      presenceMode: getPresenceMode(),
    });

    socket.on('chat:join', async (payload, ack) => {
      try {
        const conversationId = payload?.conversationId;
        if (!conversationId) throw new Error('conversationId required');
        // ACL on every join
        await chatService.assertCanAccessConversation(conversationId, user);
        socket.join(`conversation:${conversationId}`);
        await setViewing(conversationId, user.id, socket.deviceId, true);
        if (typeof ack === 'function') ack({ ok: true });
      } catch (err) {
        if (typeof ack === 'function') {
          ack({
            ok: false,
            error: {
              code: err.code || 'FORBIDDEN',
              message: err.message || 'Join failed',
            },
          });
        }
      }
    });

    socket.on('chat:leave', async (payload, ack) => {
      try {
        const conversationId = payload?.conversationId;
        if (conversationId) {
          socket.leave(`conversation:${conversationId}`);
          await setViewing(conversationId, user.id, socket.deviceId, false);
        }
        if (typeof ack === 'function') ack({ ok: true });
      } catch (err) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: { message: err.message } });
        }
      }
    });

    socket.on('chat:presence.viewing', async (payload, ack) => {
      try {
        const conversationId = payload?.conversationId;
        if (!conversationId) throw new Error('conversationId required');
        await chatService.assertCanAccessConversation(conversationId, user);
        const viewing = payload?.viewing !== false;
        await setViewing(conversationId, user.id, socket.deviceId, viewing);
        if (viewing) await touchViewing(conversationId, user.id, socket.deviceId);
        if (typeof ack === 'function') ack({ ok: true });
      } catch (err) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: { message: err.message } });
        }
      }
    });

    socket.on('chat:typing', async (payload) => {
      try {
        const conversationId = payload?.conversationId;
        if (!conversationId) return;
        await chatService.assertCanAccessConversation(conversationId, user);
        socket.to(`conversation:${conversationId}`).emit('chat:typing', {
          conversationId,
          userId: user.id,
          isTyping: Boolean(payload?.isTyping),
        });
      } catch {
        // ignore unauthorized typing
      }
    });

    socket.on('chat:message.send', async (payload, ack) => {
      try {
        const conversationId = payload?.conversationId;
        if (!conversationId) throw new Error('conversationId required');
        // ACL inside sendMessage
        const message = await chatService.sendMessage(conversationId, user, payload);
        if (typeof ack === 'function') ack({ ok: true, message });
      } catch (err) {
        if (typeof ack === 'function') {
          ack({
            ok: false,
            error: {
              code: err.code || 'SEND_FAILED',
              message: err.message || 'Send failed',
            },
          });
        }
      }
    });

    socket.on('chat:receipt.delivered', async (payload, ack) => {
      try {
        const conversationId = payload?.conversationId;
        const messageIds = payload?.messageIds || [];
        if (!conversationId) throw new Error('conversationId required');
        // ACL + only updates this user's receipt rows (device ACK)
        const result = await chatService.ackDelivered(
          conversationId,
          user,
          messageIds,
        );
        if (typeof ack === 'function') ack({ ok: true, ...result });
      } catch (err) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: { message: err.message } });
        }
      }
    });

    socket.on('chat:receipt.read', async (payload, ack) => {
      try {
        const conversationId = payload?.conversationId;
        if (!conversationId) throw new Error('conversationId required');
        const result = await chatService.ackRead(conversationId, user, {
          upToMessageId: payload?.upToMessageId || null,
        });
        if (typeof ack === 'function') ack({ ok: true, ...result });
      } catch (err) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: { message: err.message } });
        }
      }
    });

    socket.on('disconnect', async () => {
      untrackSocket(user.id, socket.id);
      // Best-effort: clear viewing for rooms this socket was in
      for (const room of socket.rooms) {
        if (room.startsWith('conversation:')) {
          const conversationId = room.slice('conversation:'.length);
          await setViewing(conversationId, user.id, socket.deviceId, false);
        }
      }
    });
  });

  return hub;
}

module.exports = { createChatSocketServer };
