/**
 * PO details Repo
 */
class PurchaseOrderDetailRepository {
    constructor(pool) {
      this.pool = pool;
    }
  
    async findByPoId(poId) {
      const query = 'SELECT * FROM purchase_order_detail WHERE po_id = $1';
      const { rows } = await this.pool.query(query, [poId]);
      return rows;
    }
  
    async addDetailWithClient(client, poId, data) {
      const { product_id, product_name, quantity, cost_price, total_price } = data;
      const query = `
        INSERT INTO purchase_order_detail 
        (po_id, product_id, product_name, quantity, cost_price, total_price)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
      const { rows } = await client.query(query, [
        poId, product_id, product_name, quantity, cost_price, total_price
      ]);
      return rows[0];
    }
}
  
module.exports = PurchaseOrderDetailRepository;
