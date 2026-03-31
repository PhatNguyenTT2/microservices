/**
 * Order Detail Repository
 */
class OrderDetailRepository {
    constructor(pool) {
      this.pool = pool;
    }
  
    async findByOrderId(orderId) {
      const query = 'SELECT * FROM sale_order_detail WHERE order_id = $1';
      const { rows } = await this.pool.query(query, [orderId]);
      return rows;
    }
  
    async addDetailWithClient(client, orderId, data) {
      const { product_name, batch_id, quantity, unit_price, total_price } = data;
      const query = `
        INSERT INTO sale_order_detail 
        (order_id, product_name, batch_id, quantity, unit_price, total_price)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
      const { rows } = await client.query(query, [
        orderId, product_name, batch_id, quantity, unit_price, total_price
      ]);
      return rows[0];
    }

    /**
     * Delete all details for an order (used in draft item editing)
     * CASCADE would handle this on order delete, but we need explicit delete for item replacement
     */
    async deleteByOrderIdWithClient(client, orderId) {
      const query = 'DELETE FROM sale_order_detail WHERE order_id = $1 RETURNING *';
      const { rows } = await client.query(query, [orderId]);
      return rows.length;
    }
}
  
module.exports = OrderDetailRepository;
