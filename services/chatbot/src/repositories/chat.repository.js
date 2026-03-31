const { NotFoundError } = require('../../../../shared/common/errors');

class ChatRepository {
    constructor(pool) {
        this.pool = pool;
    }

    async createSession(userId, userType, storeId = null) {
        const result = await this.pool.query(
            `INSERT INTO chat_session (user_id, user_type, store_id)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [userId, userType, storeId]
        );
        return result.rows[0];
    }

    async findSessionById(sessionId) {
        const result = await this.pool.query(
            'SELECT * FROM chat_session WHERE id = $1',
            [sessionId]
        );
        return result.rows[0] || null;
    }

    async findSessionsByUser(userId, limit = 20) {
        const result = await this.pool.query(
            `SELECT * FROM chat_session
             WHERE user_id = $1
             ORDER BY started_at DESC
             LIMIT $2`,
            [userId, limit]
        );
        return result.rows;
    }

    async endSession(sessionId) {
        const result = await this.pool.query(
            `UPDATE chat_session
             SET is_active = FALSE, ended_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [sessionId]
        );
        return result.rows[0];
    }

    async addMessage(sessionId, role, content, intent = null, metadata = null) {
        const result = await this.pool.query(
            `INSERT INTO chat_message (session_id, role, content, intent, metadata)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [sessionId, role, content, intent, metadata ? JSON.stringify(metadata) : null]
        );
        return result.rows[0];
    }

    async getMessagesBySession(sessionId, limit = 50) {
        const result = await this.pool.query(
            `SELECT * FROM chat_message
             WHERE session_id = $1
             ORDER BY created_at ASC
             LIMIT $2`,
            [sessionId, limit]
        );
        return result.rows;
    }

    async getRecentContext(sessionId, limit = 10) {
        const result = await this.pool.query(
            `SELECT role, content FROM chat_message
             WHERE session_id = $1
             ORDER BY created_at DESC
             LIMIT $2`,
            [sessionId, limit]
        );
        return result.rows.reverse();
    }
}

module.exports = ChatRepository;
