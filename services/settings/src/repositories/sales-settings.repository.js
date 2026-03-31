class SalesSettingsRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async get() {
    // Singleton, always id = 1
    const { rows } = await this.pool.query('SELECT * FROM sales_settings WHERE id = 1');
    return rows[0] || null;
  }

  async updateWithClient(client, data) {
    const q = client || this.pool;
    const updates = [];
    const params = [];
    let idx = 1;

    const allowedFields = [
      'auto_promotion_enabled', 'promotion_start_time', 'promotion_discount_percentage',
      'discount_retail', 'discount_wholesale', 'discount_vip', 'updated_by'
    ];

    for (const [key, value] of Object.entries(data)) {
      if (allowedFields.includes(key)) {
        updates.push(`${key} = $${idx++}`);
        params.push(value);
      }
    }

    if (!updates.length) return this.get();

    updates.push(`updated_at = NOW()`);
    params.push(1); // id = 1

    const { rows } = await q.query(
      `UPDATE sales_settings SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    return rows[0];
  }
}

module.exports = SalesSettingsRepository;
