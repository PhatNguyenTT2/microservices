class PoDetailRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findByPoId(poId) {
    const { rows } = await this.pool.query(
      'SELECT * FROM purchase_order_detail WHERE po_id = $1 ORDER BY id', 
      [poId]
    );
    return rows;
  }

  async createWithClient(client, { po_id, product_id, product_name, quantity, cost_price }) {
    const total_price = quantity * cost_price;
    const { rows } = await client.query(
      `INSERT INTO purchase_order_detail (po_id, product_id, product_name, quantity, cost_price, total_price)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [po_id, product_id, product_name, quantity, cost_price, total_price]
    );
    return rows[0];
  }

  async updateBatchId(client, id, batchId) {
    const q = client || this.pool;
    const { rows } = await q.query(
      'UPDATE purchase_order_detail SET batch_id = $1 WHERE id = $2 RETURNING *',
      [batchId, id]
    );
    return rows[0] || null;
  }
}

module.exports = PoDetailRepository;
