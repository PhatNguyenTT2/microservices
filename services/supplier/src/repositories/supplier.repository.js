class SupplierRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findAll({ page = 1, limit = 20, search, isActive, sortBy = 'id', sortOrder = 'asc' } = {}) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (search) {
      conditions.push(`company_name ILIKE $${idx++}`);
      params.push(`%${search}%`);
    }

    if (isActive !== undefined) {
      conditions.push(`is_active = $${idx++}`);
      params.push(isActive === 'true' || isActive === true);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const countResult = await this.pool.query(`SELECT COUNT(*) FROM supplier ${where}`, params);
    params.push(limit, offset);

    // Map frontend sort fields to DB columns
    const validSortFields = {
      'id': 'id',
      'companyName': 'company_name',
      'phone': 'phone',
      'paymentTerms': 'payment_terms',
      'creditLimit': 'credit_limit',
      'currentDebt': 'current_debt',
      'isActive': 'is_active'
    };
    const orderColumn = validSortFields[sortBy] || 'id';
    const orderDir = (sortOrder || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    
    const { rows } = await this.pool.query(
      `SELECT * FROM supplier ${where} ORDER BY ${orderColumn} ${orderDir} LIMIT $${idx++} OFFSET $${idx}`, 
      params
    );

    return { items: rows, total: parseInt(countResult.rows[0].count) };
  }

  async findById(id) {
    const { rows } = await this.pool.query('SELECT * FROM supplier WHERE id = $1', [id]);
    return rows[0] || null;
  }
  
  async findByName(name) {
    const { rows } = await this.pool.query('SELECT * FROM supplier WHERE company_name = $1', [name]);
    return rows[0] || null;
  }

  async create(data) {
    const { rows } = await this.pool.query(
      `INSERT INTO supplier (company_name, phone, address, account_number, payment_terms, credit_limit)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [data.company_name, data.phone || null, data.address || null, data.account_number || null,
       data.payment_terms || 'cod', data.credit_limit || 0]
    );
    return rows[0];
  }

  async update(id, data) {
    const updates = [];
    const params = [];
    let idx = 1;

    for (const [key, value] of Object.entries(data)) {
      if (['company_name', 'phone', 'address', 'account_number', 'payment_terms', 'credit_limit', 'is_active'].includes(key)) {
        updates.push(`${key} = $${idx++}`);
        params.push(value);
      }
    }

    if (!updates.length) return this.findById(id);

    params.push(id);
    const { rows } = await this.pool.query(
      `UPDATE supplier SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    return rows[0] || null;
  }

  async updateDebtWithClient(client, id, amountChange) {
    const q = client || this.pool;
    const { rows } = await q.query(
      'UPDATE supplier SET current_debt = current_debt + $1 WHERE id = $2 RETURNING *', 
      [amountChange, id]
    );
    return rows[0] || null;
  }
}

module.exports = SupplierRepository;
