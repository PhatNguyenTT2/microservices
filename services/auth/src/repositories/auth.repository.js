/**
 * Auth Repository — Data access for auth_tokens and pos_auth tables.
 */

class AuthRepository {
  constructor(pool) {
    this.pool = pool;
  }

  // --- Auth Tokens ---
  async saveToken({ userId, tokenHash, type, expiresAt }) {
    const { rows } = await this.pool.query(
      `INSERT INTO auth_tokens (user_id, token_hash, type, expires_at)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [userId, tokenHash, type, expiresAt]
    );
    return rows[0];
  }

  async findToken(tokenHash) {
    const { rows } = await this.pool.query(
      `SELECT * FROM auth_tokens WHERE token_hash = $1 AND expires_at > NOW()`,
      [tokenHash]
    );
    return rows[0] || null;
  }

  async deleteToken(tokenHash) {
    await this.pool.query(`DELETE FROM auth_tokens WHERE token_hash = $1`, [tokenHash]);
  }

  async deleteUserTokens(userId, type) {
    if (type) {
      await this.pool.query(`DELETE FROM auth_tokens WHERE user_id = $1 AND type = $2`, [userId, type]);
    } else {
      await this.pool.query(`DELETE FROM auth_tokens WHERE user_id = $1`, [userId]);
    }
  }

  async cleanExpiredTokens() {
    await this.pool.query(`DELETE FROM auth_tokens WHERE expires_at < NOW()`);
  }

  // --- POS Auth ---
  async findPosAuth(userId) {
    const { rows } = await this.pool.query(
      `SELECT * FROM pos_auth WHERE user_id = $1`, [userId]
    );
    return rows[0] || null;
  }

  async upsertPosAuth({ userId, pinHash }) {
    const { rows } = await this.pool.query(
      `INSERT INTO pos_auth (user_id, pin_hash)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET pin_hash = $2, failed_attempts = 0, locked_until = NULL
       RETURNING *`,
      [userId, pinHash]
    );
    return rows[0];
  }

  /** Transaction-aware POS auth create */
  async createPosAuthWithClient(client, { userId, pinHash }) {
    const { rows } = await client.query(
      `INSERT INTO pos_auth (user_id, pin_hash) VALUES ($1, $2) RETURNING *`,
      [userId, pinHash]
    );
    return rows[0];
  }

  async incrementPosFailedAttempts(userId) {
    const { rows } = await this.pool.query(
      `UPDATE pos_auth SET
        failed_attempts = failed_attempts + 1,
        locked_until = CASE WHEN failed_attempts >= 4 THEN NOW() + INTERVAL '15 minutes' ELSE locked_until END
       WHERE user_id = $1
       RETURNING *`,
      [userId]
    );
    return rows[0] || null;
  }

  async resetPosFailedAttempts(userId) {
    await this.pool.query(
      `UPDATE pos_auth SET failed_attempts = 0, locked_until = NULL, last_login = NOW() WHERE user_id = $1`,
      [userId]
    );
  }
}

module.exports = AuthRepository;
