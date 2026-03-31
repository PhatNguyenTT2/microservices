/**
 * User Repository — Data access for user_account table.
 */

class UserRepository {
  constructor(pool) {
    this.pool = pool;
  }

  /** @private — shared query builder */
  _baseQuery(whereClause, params) {
    return this.pool.query(
      `SELECT u.*, r.name as role_name, r.id as role_id
       FROM user_account u
       JOIN role r ON u.role_id = r.id
       WHERE ${whereClause}`,
      params
    );
  }

  async findByUsername(username) {
    const { rows } = await this._baseQuery('LOWER(u.username) = LOWER($1)', [username]);
    return rows[0] || null;
  }

  async findByEmail(email) {
    const { rows } = await this._baseQuery('LOWER(u.email) = LOWER($1)', [email]);
    return rows[0] || null;
  }

  async findByUsernameOrEmail(identifier) {
    const { rows } = await this._baseQuery(
      'LOWER(u.username) = LOWER($1) OR LOWER(u.email) = LOWER($1)', [identifier]
    );
    return rows[0] || null;
  }

  async findById(id) {
    const { rows } = await this._baseQuery('u.id = $1', [id]);
    return rows[0] || null;
  }

  async create({ username, email, passwordHash, roleId }) {
    const { rows } = await this.pool.query(
      `INSERT INTO user_account (username, email, password_hash, role_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [username, email, passwordHash, roleId]
    );
    return rows[0];
  }

  /** Transaction-aware create — accepts client instead of pool */
  async createWithClient(client, { username, email, passwordHash, roleId }) {
    const { rows } = await client.query(
      `INSERT INTO user_account (username, email, password_hash, role_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [username, email, passwordHash, roleId]
    );
    return rows[0];
  }

  async updateLastLogin(id) {
    await this.pool.query(
      `UPDATE user_account SET last_login = NOW() WHERE id = $1`, [id]
    );
  }

  async setActive(id, isActive) {
    await this.pool.query(
      `UPDATE user_account SET is_active = $2 WHERE id = $1`, [id, isActive]
    );
  }

  async updateRole(id, roleId) {
    await this.pool.query(
      `UPDATE user_account SET role_id = $2 WHERE id = $1`, [id, roleId]
    );
  }

  async getPermissions(userId) {
    const { rows } = await this.pool.query(
      `SELECT p.code FROM permission p
       JOIN role_permission rp ON p.id = rp.permission_id
       JOIN user_account u ON u.role_id = rp.role_id
       WHERE u.id = $1`,
      [userId]
    );
    return rows.map(r => r.code);
  }

  async setActiveWithClient(client, id, isActive) {
    await client.query(
      `UPDATE user_account SET is_active = $2 WHERE id = $1`, [id, isActive]
    );
  }

  async updateRoleWithClient(client, id, roleId) {
    await client.query(
      `UPDATE user_account SET role_id = $2 WHERE id = $1`, [id, roleId]
    );
  }
}

module.exports = UserRepository;
