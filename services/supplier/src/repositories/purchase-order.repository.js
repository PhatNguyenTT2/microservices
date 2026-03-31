/**
 * Purchase Order Repository
 * Quản lý đơn nhập hàng (Multi-Tenancy)
 */
class PurchaseOrderRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findAll(storeId, filters = {}) {
    let query = `
      SELECT po.*, 
             s.id AS s_id, s.company_name AS s_company_name, 
             s.phone AS s_phone, s.payment_terms AS s_payment_terms
      FROM purchase_order po
      LEFT JOIN supplier s ON po.supplier_id = s.id
      WHERE po.store_id = $1
    `;
    const params = [storeId];

    if (filters.supplierId) {
      params.push(filters.supplierId);
      query += ` AND po.supplier_id = $${params.length}`;
    }
    if (filters.status) {
      params.push(filters.status);
      query += ` AND po.status = $${params.length}`;
    }
    if (filters.paymentStatus) {
      params.push(filters.paymentStatus);
      query += ` AND po.payment_status = $${params.length}`;
    }

    query += ' ORDER BY po.order_date DESC';
    const { rows } = await this.pool.query(query, params);
    return rows;
  }

  async findById(storeId, id) {
    const query = 'SELECT * FROM purchase_order WHERE id = $1 AND store_id = $2';
    const { rows } = await this.pool.query(query, [id, storeId]);
    return rows[0] || null;
  }

  async createWithClient(client, storeId, data) {
    const { supplier_id, created_by, shipping_fee, discount_percentage, total_price, notes } = data;
    const query = `
      INSERT INTO purchase_order 
      (store_id, supplier_id, created_by, shipping_fee, discount_percentage, total_price, notes, status, payment_status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', 'unpaid')
      RETURNING *
    `;
    const { rows } = await client.query(query, [
      storeId, supplier_id, created_by, shipping_fee || 0, discount_percentage || 0, total_price || 0, notes
    ]);
    return rows[0];
  }

  async updateWithClient(client, storeId, id, data) {
    const setClauses = [];
    const params = [id, storeId];

    for (const [key, value] of Object.entries(data)) {
      if (['supplier_id', 'shipping_fee', 'discount_percentage', 'total_price', 'notes'].includes(key)) {
        params.push(value);
        setClauses.push(`${key} = $${params.length}`);
      }
    }

    if (setClauses.length === 0) return this.findById(storeId, id);

    const query = `
      UPDATE purchase_order 
      SET ${setClauses.join(', ')}
      WHERE id = $1 AND store_id = $2
      RETURNING *
    `;
    const { rows } = await client.query(query, params);
    return rows[0] || null;
  }

  async updateStatusWithClient(client, storeId, id, status, paymentStatus) {
    const setClauses = [];
    const params = [id, storeId]; // $1 = id, $2 = store_id

    if (status) {
      params.push(status);
      setClauses.push(`status = $${params.length}`);
      if (status === 'received') {
        setClauses.push(`received_date = NOW()`);
      }
    }

    if (paymentStatus) {
      params.push(paymentStatus);
      setClauses.push(`payment_status = $${params.length}`);
    }

    if (setClauses.length === 0) return null;

    const query = `
      UPDATE purchase_order 
      SET ${setClauses.join(', ')}
      WHERE id = $1 AND store_id = $2
      RETURNING *
    `;
    const { rows } = await client.query(query, params);
    return rows[0];
  }
}

module.exports = PurchaseOrderRepository;
