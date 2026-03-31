const { Router } = require('express');
const { success, created } = require('../../../../shared/common/response');
const { verifyToken } = require('../../../../shared/auth-middleware');

function createChatRouter(chatService) {
    const router = Router();

    // All chat routes require authentication
    router.use(verifyToken);

    // POST /api/chat/sessions — Start new chat session
    router.post('/sessions', async (req, res, next) => {
        try {
            const userId = req.user.id;
            const userType = req.user.role === 'Customer' ? 'customer' : 'employee';
            const storeId = req.user.storeId || null;

            const session = await chatService.startSession(userId, userType, storeId);
            return created(res, session);
        } catch (err) {
            next(err);
        }
    });

    // GET /api/chat/sessions — Get user's chat sessions
    router.get('/sessions', async (req, res, next) => {
        try {
            const sessions = await chatService.getUserSessions(req.user.id);
            return success(res, sessions);
        } catch (err) {
            next(err);
        }
    });

    // GET /api/chat/sessions/:id — Get session with messages
    router.get('/sessions/:id', async (req, res, next) => {
        try {
            const session = await chatService.getSession(parseInt(req.params.id));
            const messages = await chatService.getSessionMessages(session.id);
            return success(res, { ...session, messages });
        } catch (err) {
            next(err);
        }
    });

    // POST /api/chat/sessions/:id/end — End a chat session
    router.post('/sessions/:id/end', async (req, res, next) => {
        try {
            const session = await chatService.endSession(parseInt(req.params.id));
            return success(res, session);
        } catch (err) {
            next(err);
        }
    });

    // POST /api/chat/message — Send a message (main endpoint)
    router.post('/message', async (req, res, next) => {
        try {
            const { session_id, message } = req.body;
            const result = await chatService.sendMessage(session_id, message);
            return success(res, result);
        } catch (err) {
            next(err);
        }
    });

    return router;
}

module.exports = createChatRouter;
