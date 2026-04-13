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

  async incrementPosFailedAttempts(userId, maxAttempts = 5, lockMinutes = 30) {
    const { rows } = await this.pool.query(
      `UPDATE pos_auth SET
        failed_attempts = failed_attempts + 1,
        locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN NOW() + ($3 || ' minutes')::INTERVAL ELSE locked_until END
       WHERE user_id = $1
       RETURNING *`,
      [userId, maxAttempts, lockMinutes]
    );
    return rows[0] || null;
  }

  async resetPosFailedAttempts(userId) {
    await this.pool.query(
      `UPDATE pos_auth SET failed_attempts = 0, locked_until = NULL, last_login = NOW() WHERE user_id = $1`,
      [userId]
    );
  }

  async findAllPosAuth() {
    const { rows } = await this.pool.query(
      `SELECT
         pa.user_id, pa.pin_hash, pa.failed_attempts, pa.locked_until, pa.is_enabled, pa.last_login as pos_last_login,
         u.username, u.email, u.is_active, u.role_id,
         r.name as role_name,
         e.full_name, e.phone, e.store_id,
         s.name as store_name
       FROM pos_auth pa
       JOIN user_account u ON pa.user_id = u.id
       JOIN employee e ON u.id = e.user_id
       JOIN role r ON u.role_id = r.id
       LEFT JOIN store s ON e.store_id = s.id
       ORDER BY e.full_name ASC`
    );
    return rows;
  }

  async findPosAuthWithDetails(userId) {
    const { rows } = await this.pool.query(
      `SELECT
         pa.user_id, pa.pin_hash, pa.failed_attempts, pa.locked_until, pa.is_enabled, pa.last_login as pos_last_login,
         u.username, u.email, u.is_active, u.role_id,
         r.name as role_name,
         e.full_name, e.phone, e.store_id,
         s.name as store_name
       FROM pos_auth pa
       JOIN user_account u ON pa.user_id = u.id
       JOIN employee e ON u.id = e.user_id
       JOIN role r ON u.role_id = r.id
       LEFT JOIN store s ON e.store_id = s.id
       WHERE pa.user_id = $1`,
      [userId]
    );
    return rows[0] || null;
  }

  async findAvailableEmployees() {
    const { rows } = await this.pool.query(
      `SELECT
         u.id, u.username, u.email, u.is_active, u.role_id,
         r.name as role_name,
         e.full_name, e.phone, e.store_id,
         s.name as store_name
       FROM user_account u
       JOIN employee e ON u.id = e.user_id
       JOIN role r ON u.role_id = r.id
       LEFT JOIN store s ON e.store_id = s.id
       WHERE u.is_active = true
         AND u.id NOT IN (SELECT user_id FROM pos_auth)
         AND u.role_id IN (
           SELECT rp.role_id FROM role_permission rp
           JOIN permission p ON rp.permission_id = p.id
           WHERE p.code = 'pos_access'
         )
       ORDER BY e.full_name ASC`
    );
    return rows;
  }

  async enablePosAuth(userId) {
    const { rows } = await this.pool.query(
      `UPDATE pos_auth SET is_enabled = true WHERE user_id = $1 RETURNING *`,
      [userId]
    );
    return rows[0] || null;
  }

  async disablePosAuth(userId) {
    const { rows } = await this.pool.query(
      `UPDATE pos_auth SET is_enabled = false WHERE user_id = $1 RETURNING *`,
      [userId]
    );
    return rows[0] || null;
  }

  async deletePosAuth(userId) {
    await this.pool.query(`DELETE FROM pos_auth WHERE user_id = $1`, [userId]);
  }
}

module.exports = AuthRepository;
