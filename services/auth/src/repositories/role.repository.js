/**
 * Role Repository — Data access for role, permission, role_permission tables.
 */

class RoleRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findAll() {
    const { rows } = await this.pool.query(
      `SELECT r.*,
        COALESCE(
          json_agg(json_build_object('id', p.id, 'code', p.code, 'description', p.description))
          FILTER (WHERE p.id IS NOT NULL), '[]'
        ) as permissions,
        (SELECT COUNT(*) FROM user_account ua WHERE ua.role_id = r.id)::int as employee_count
       FROM role r
       LEFT JOIN role_permission rp ON r.id = rp.role_id
       LEFT JOIN permission p ON rp.permission_id = p.id
       GROUP BY r.id
       ORDER BY r.id`
    );
    return rows;
  }

  async findById(id) {
    const { rows } = await this.pool.query(
      `SELECT r.*,
        COALESCE(
          json_agg(json_build_object('id', p.id, 'code', p.code, 'description', p.description))
          FILTER (WHERE p.id IS NOT NULL), '[]'
        ) as permissions,
        (SELECT COUNT(*) FROM user_account ua WHERE ua.role_id = r.id)::int as employee_count
       FROM role r
       LEFT JOIN role_permission rp ON r.id = rp.role_id
       LEFT JOIN permission p ON rp.permission_id = p.id
       WHERE r.id = $1
       GROUP BY r.id`,
      [id]
    );
    return rows[0] || null;
  }

  async search(query) {
    const pattern = `%${query}%`;
    const { rows } = await this.pool.query(
      `SELECT r.*,
        COALESCE(
          json_agg(json_build_object('id', p.id, 'code', p.code, 'description', p.description))
          FILTER (WHERE p.id IS NOT NULL), '[]'
        ) as permissions,
        (SELECT COUNT(*) FROM user_account ua WHERE ua.role_id = r.id)::int as employee_count
       FROM role r
       LEFT JOIN role_permission rp ON r.id = rp.role_id
       LEFT JOIN permission p ON rp.permission_id = p.id
       WHERE r.name ILIKE $1 OR r.description ILIKE $1
       GROUP BY r.id
       ORDER BY r.name`,
      [pattern]
    );
    return rows;
  }

  async findPermissionIdsByCodes(codes) {
    if (!codes || codes.length === 0) return [];
    const placeholders = codes.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await this.pool.query(
      `SELECT id FROM permission WHERE code IN (${placeholders})`,
      codes
    );
    return rows.map(r => r.id);
  }

  async findByName(name) {
    const { rows } = await this.pool.query(
      `SELECT * FROM role WHERE LOWER(name) = LOWER($1)`, [name]
    );
    return rows[0] || null;
  }

  async create({ name, description }) {
    const { rows } = await this.pool.query(
      `INSERT INTO role (name, description) VALUES ($1, $2) RETURNING *`,
      [name, description]
    );
    return rows[0];
  }

  async update(id, { name, description }) {
    const { rows } = await this.pool.query(
      `UPDATE role SET name = COALESCE($2, name), description = COALESCE($3, description)
       WHERE id = $1 RETURNING *`,
      [id, name, description]
    );
    return rows[0] || null;
  }

  async delete(id) {
    const { rowCount } = await this.pool.query(`DELETE FROM role WHERE id = $1`, [id]);
    return rowCount > 0;
  }

  async setPermissions(roleId, permissionIds) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM role_permission WHERE role_id = $1`, [roleId]);
      if (permissionIds.length > 0) {
        const values = permissionIds.map((pid, i) => `($1, $${i + 2})`).join(', ');
        await client.query(
          `INSERT INTO role_permission (role_id, permission_id) VALUES ${values}`,
          [roleId, ...permissionIds]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getAllPermissions() {
    const { rows } = await this.pool.query(
      `SELECT * FROM permission ORDER BY code`
    );
    return rows;
  }
}

module.exports = RoleRepository;
