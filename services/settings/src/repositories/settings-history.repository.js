class SettingsHistoryRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findAll({ page = 1, limit = 20, settingType } = {}) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (settingType) {
      conditions.push(`setting_type = $${idx++}`);
      params.push(settingType);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const countResult = await this.pool.query(`SELECT COUNT(*) FROM settings_history ${where}`, params);
    params.push(limit, offset);
    
    const { rows } = await this.pool.query(
      `SELECT * FROM settings_history ${where} ORDER BY changed_at DESC LIMIT $${idx++} OFFSET $${idx}`, 
      params
    );

    return { items: rows, total: parseInt(countResult.rows[0].count) };
  }

  async createWithClient(client, { setting_type, old_value, new_value, changed_by, change_reason }) {
    const q = client || this.pool;
    const { rows } = await q.query(
      `INSERT INTO settings_history (setting_type, old_value, new_value, changed_by, change_reason)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [setting_type, JSON.stringify(old_value), JSON.stringify(new_value), changed_by, change_reason]
    );
    return rows[0];
  }
}

module.exports = SettingsHistoryRepository;
