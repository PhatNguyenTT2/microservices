class SecuritySettingsRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async get() {
    // Singleton, always id = 1
    const { rows } = await this.pool.query('SELECT * FROM security_settings WHERE id = 1');
    return rows[0] || null;
  }

  async updateWithClient(client, data) {
    const q = client || this.pool;
    const updates = [];
    const params = [];
    let idx = 1;

    for (const [key, value] of Object.entries(data)) {
      if (['max_failed_attempts', 'lock_duration_minutes', 'updated_by'].includes(key)) {
        updates.push(`${key} = $${idx++}`);
        params.push(value);
      }
    }

    if (!updates.length) return this.get();

    // Auto update timestamp
    updates.push(`updated_at = NOW()`);

    params.push(1); // id is always 1
    const { rows } = await q.query(
      `UPDATE security_settings SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    return rows[0];
  }
}

module.exports = SecuritySettingsRepository;
