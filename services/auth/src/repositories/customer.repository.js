/**
 * Customer Repository — Data access for customer table.
 * customer.id is the PK. user_id is optional (NULL = walk-in customer).
 * Supports soft delete via is_active column.
 */

class CustomerRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findAll({ page = 1, limit = 20, search, customerType, gender, isActive, sortBy = 'id', sortOrder = 'asc' } = {}) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    // Default: show only active customers unless explicitly requested
    if (isActive !== undefined && isActive !== '') {
      params.push(isActive === 'true' || isActive === true);
      conditions.push(`c.is_active = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(c.full_name ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR c.address ILIKE $${params.length})`);
    }
    if (customerType) {
      params.push(customerType);
      conditions.push(`c.customer_type = $${params.length}`);
    }
    if (gender) {
      params.push(gender);
      conditions.push(`c.gender = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `SELECT COUNT(*)::int FROM customer c ${where}`;

    const validSortFields = {
      'id': 'c.id',
      'fullName': 'c.full_name',
      'gender': 'c.gender',
      'customerType': 'c.customer_type',
      'totalSpent': 'c.total_spent',
      'isActive': 'c.is_active'
    };
    const orderColumn = validSortFields[sortBy] || 'c.id';
    const orderDir = (sortOrder || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    const dataQuery = `
      SELECT c.*, u.username, u.email, u.is_active as user_is_active
      FROM customer c
      LEFT JOIN user_account u ON c.user_id = u.id
      ${where}
      ORDER BY ${orderColumn} ${orderDir}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

    const [countResult, dataResult] = await Promise.all([
      this.pool.query(countQuery, params),
      this.pool.query(dataQuery, [...params, limit, offset])
    ]);

    return {
      items: dataResult.rows,
      total: countResult.rows[0].count
    };
  }

  async findById(id) {
    const { rows } = await this.pool.query(
      `SELECT c.*, u.username, u.email, u.is_active as user_is_active
       FROM customer c
       LEFT JOIN user_account u ON c.user_id = u.id
       WHERE c.id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  async create(clientOrPool, { userId, fullName, phone, address, gender, dob, customerType }) {
    const executor = clientOrPool || this.pool;
    const { rows } = await executor.query(
      `INSERT INTO customer (user_id, full_name, phone, address, gender, dob, customer_type, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
       RETURNING *`,
      [userId || null, fullName, phone || null, address || null, gender || null, dob || null, customerType || 'retail']
    );
    return rows[0];
  }

  async update(id, { fullName, phone, address, gender, dob, customerType, totalSpent }) {
    const { rows } = await this.pool.query(
      `UPDATE customer SET
        full_name = COALESCE($2, full_name),
        phone = COALESCE($3, phone),
        address = COALESCE($4, address),
        gender = COALESCE($5, gender),
        dob = COALESCE($6, dob),
        customer_type = COALESCE($7, customer_type),
        total_spent = COALESCE($8, total_spent)
       WHERE id = $1
       RETURNING *`,
      [id, fullName, phone, address, gender, dob, customerType, totalSpent]
    );
    return rows[0] || null;
  }

  /**
   * Soft delete — set is_active = FALSE
   */
  async softDelete(id) {
    const { rows } = await this.pool.query(
      `UPDATE customer SET is_active = FALSE WHERE id = $1 RETURNING *`,
      [id]
    );
    return rows[0] || null;
  }

  /**
   * Toggle active status
   */
  async toggleActive(id, isActive) {
    const { rows } = await this.pool.query(
      `UPDATE customer SET is_active = $2 WHERE id = $1 RETURNING *`,
      [id, isActive]
    );
    return rows[0] || null;
  }

  /**
   * Atomically increment total_spent for a customer.
   * Used by ORDER_COMPLETED event handler.
   */
  async incrementTotalSpent(customerId, amount) {
    const { rows } = await this.pool.query(
      `UPDATE customer SET total_spent = total_spent + $2
       WHERE id = $1
       RETURNING id, full_name, total_spent`,
      [customerId, amount]
    );
    return rows[0] || null;
  }

  /**
   * Hard delete — permanently remove (admin only)
   */
  async delete(id) {
    const { rowCount } = await this.pool.query(
      `DELETE FROM customer WHERE id = $1`, [id]
    );
    return rowCount > 0;
  }
}

module.exports = CustomerRepository;
