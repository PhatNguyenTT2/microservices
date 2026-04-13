/**
 * WebSocket Chat Handler — Socket.IO event handlers (Streaming Edition)
 * Protocol:
 *   Client → chat:join_session { sessionId }
 *   Server → chat:session_ready { sessionId, messages[], restored }
 *   Client → chat:send_message { session_id, message }
 *   Server → chat:stream_chunk { text }  (×N)
 *   Server → chat:stream_complete { intent, products[], fullText }
 *   Server → chat:error { message, code }
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
        const { id: userId, role, roleName, storeId } = socket.user;
        const userType = (roleName === 'Customer' || role === 'Customer') ? 'customer' : 'employee';

        logger.info({ userId, socketId: socket.id }, 'WS client connected');

        // Join user-specific room
        socket.join(`user:${userId}`);

        // ── Event: Join/Restore session (with expiration fallback) ──
        socket.on('chat:join_session', async (data, callback) => {
            try {
                const sessionId = data?.sessionId || null;

                if (sessionId) {
                    // Try to restore existing session
                    const session = await chatService.getSession(sessionId).catch(() => null);

                    if (session && session.is_active) {
                        const messages = await chatService.getSessionMessages(sessionId);
                        socket.join(`session:${sessionId}`);
                        logger.info({ userId, sessionId }, 'WS session restored');

                        const response = { success: true, data: { sessionId, messages, restored: true } };
                        if (typeof callback === 'function') callback(response);
                        socket.emit('chat:session_ready', response.data);
                        return;
                    }

                    // Session expired or purged — fallback to new
                    logger.warn({ userId, sessionId }, 'Session expired or not found, creating new');
                }

                // Create new session
                const newSession = await chatService.startSession(userId, userType, storeId || null);
                socket.join(`session:${newSession.id}`);
                logger.info({ userId, sessionId: newSession.id }, 'WS new session created');

                const response = {
                    success: true,
                    data: { sessionId: newSession.id, messages: [], restored: false }
                };
                if (typeof callback === 'function') callback(response);
                socket.emit('chat:session_ready', response.data);

            } catch (err) {
                // Catch-all: NEVER let widget hang
                _emitError(socket, callback, 'chat:error', err);
            }
        });

        // ── Event: Send message (streaming response) ──
        socket.on('chat:send_message', async (data, callback) => {
            try {
                const { session_id, message } = data || {};
                if (!session_id || !message) {
                    throw new Error('session_id and message are required');
                }

                // Join session room if not already
                socket.join(`session:${session_id}`);

                // Emit typing indicator
                socket.emit('chat:typing', { session_id, is_typing: true });

                // Stream response chunks
                for await (const chunk of chatService.sendMessageStream(session_id, message)) {
                    if (chunk.type === 'chunk') {
                        socket.emit('chat:stream_chunk', { text: chunk.text });
                    } else if (chunk.type === 'complete') {
                        // Stop typing + send complete
                        socket.emit('chat:typing', { session_id, is_typing: false });

                        const completeData = {
                            session_id,
                            intent: chunk.intent,
                            fullText: chunk.fullText,
                            products: chunk.products || null,
                            suggestedPrompts: chunk.suggestedPrompts || null,
                            metadata: chunk.metadata,
                            timestamp: new Date().toISOString()
                        };

                        if (typeof callback === 'function') callback({ success: true, data: completeData });
                        socket.emit('chat:stream_complete', completeData);

                        logger.info({ userId, sessionId: session_id, intent: chunk.intent }, 'WS stream completed');
                    }
                }
            } catch (err) {
                // Stop typing on error
                if (data?.session_id) {
                    socket.emit('chat:typing', { session_id: data.session_id, is_typing: false });
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
