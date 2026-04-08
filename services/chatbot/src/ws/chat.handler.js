/**
 * WebSocket Chat Handler — Socket.IO event handlers
 * Reuses ChatService for business logic, adds real-time layer.
 */

const jwt = require('jsonwebtoken');
const logger = require('../../../../shared/common/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

/**
 * Initialize Socket.IO with auth middleware and chat events.
 * @param {import('socket.io').Server} io
 * @param {object} chatService
 */
function initChatSocket(io, chatService) {

    // ── Auth Middleware: verify JWT from handshake ──
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
        if (!token) {
            return next(new Error('UNAUTHORIZED: Token required'));
        }

        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            socket.user = decoded;
            next();
        } catch (err) {
            return next(new Error('UNAUTHORIZED: Invalid token'));
        }
    });

    io.on('connection', (socket) => {
        const { id: userId, role, storeId } = socket.user;
        const userType = role === 'Customer' ? 'customer' : 'employee';

        logger.info({ userId, socketId: socket.id }, 'WS client connected');

        // Join user-specific room for targeted events
        socket.join(`user:${userId}`);

        // ── Event: Start new session ──
        socket.on('chat:start_session', async (data, callback) => {
            try {
                const session = await chatService.startSession(userId, userType, storeId || null);
                socket.join(`session:${session.id}`);
                logger.info({ userId, sessionId: session.id }, 'WS session started');

                const response = { success: true, data: session };
                if (typeof callback === 'function') callback(response);
                socket.emit('chat:session_started', response);
            } catch (err) {
                _emitError(socket, callback, 'chat:error', err);
            }
        });

        // ── Event: Send message (main real-time flow) ──
        socket.on('chat:send_message', async (data, callback) => {
            try {
                const { session_id, message } = data || {};
                if (!session_id || !message) {
                    throw new Error('session_id and message are required');
                }

                // Join session room if not already
                socket.join(`session:${session_id}`);

                // Emit typing indicator
                socket.to(`session:${session_id}`).emit('chat:typing', {
                    session_id,
                    is_typing: true
                });

                // Process message via ChatService (same as REST)
                const result = await chatService.sendMessage(session_id, message);

                // Stop typing
                socket.to(`session:${session_id}`).emit('chat:typing', {
                    session_id,
                    is_typing: false
                });

                const response = {
                    success: true,
                    data: {
                        session_id,
                        intent: result.intent,
                        reply: result.reply,
                        products: result.products || null,
                        metadata: result.metadata,
                        timestamp: new Date().toISOString()
                    }
                };

                if (typeof callback === 'function') callback(response);
                socket.emit('chat:message_received', response);

                logger.info({ userId, sessionId: session_id, intent: result.intent }, 'WS message processed');
            } catch (err) {
                // Stop typing on error
                if (data?.session_id) {
                    socket.to(`session:${data.session_id}`).emit('chat:typing', {
                        session_id: data.session_id,
                        is_typing: false
                    });
                }
                _emitError(socket, callback, 'chat:error', err);
            }
        });

        // ── Event: End session ──
        socket.on('chat:end_session', async (data, callback) => {
            try {
                const { session_id } = data || {};
                if (!session_id) throw new Error('session_id is required');

                const session = await chatService.endSession(session_id);
                socket.leave(`session:${session_id}`);

                const response = { success: true, data: session };
                if (typeof callback === 'function') callback(response);
                socket.emit('chat:session_ended', response);

                logger.info({ userId, sessionId: session_id }, 'WS session ended');
            } catch (err) {
                _emitError(socket, callback, 'chat:error', err);
            }
        });

        // ── Event: Get session history ──
        socket.on('chat:get_history', async (data, callback) => {
            try {
                const { session_id } = data || {};
                if (!session_id) throw new Error('session_id is required');

                const session = await chatService.getSession(session_id);
                const messages = await chatService.getSessionMessages(session_id);

                const response = { success: true, data: { ...session, messages } };
                if (typeof callback === 'function') callback(response);
            } catch (err) {
                _emitError(socket, callback, 'chat:error', err);
            }
        });

        // ── Disconnect ──
        socket.on('disconnect', (reason) => {
            logger.info({ userId, socketId: socket.id, reason }, 'WS client disconnected');
        });
    });

    return io;
}

function _emitError(socket, callback, event, err) {
    const error = {
        success: false,
        error: {
            message: err.isOperational ? err.message : 'Internal server error',
            code: err.code || 'WS_ERROR'
        }
    };
    logger.error({ err: err.message, socketId: socket.id }, 'WS error');
    if (typeof callback === 'function') callback(error);
    socket.emit(event, error);
}

module.exports = initChatSocket;
