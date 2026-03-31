/**
 * Order Repository
 * Quản lý đơn hàng (Multi-Tenancy)
 */
class OrderRepository {
    constructor(pool) {
      this.pool = pool;
    }
  
    async findAll(storeId, filters = {}) {
      let query = 'SELECT * FROM sale_order WHERE store_id = $1';
      const params = [storeId];
  
      if (filters.status) {
        params.push(filters.status);
        query += ` AND status = $${params.length}`;
      }
      if (filters.paymentStatus) {
        params.push(filters.paymentStatus);
        query += ` AND payment_status = $${params.length}`;
      }
      if (filters.deliveryType) {
        params.push(filters.deliveryType);
        query += ` AND delivery_type = $${params.length}`;
      }
      if (filters.customerId) {
        params.push(filters.customerId);
        query += ` AND customer_id = $${params.length}`;
      }
      if (filters.createdBy) {
        params.push(filters.createdBy);
        query += ` AND created_by = $${params.length}`;
      }
      if (filters.startDate) {
        params.push(filters.startDate);
        query += ` AND order_date >= $${params.length}`;
      }
      if (filters.endDate) {
        params.push(filters.endDate);
        query += ` AND order_date <= $${params.length}`;
      }
  
      query += ' ORDER BY order_date DESC';
      const { rows } = await this.pool.query(query, params);
      return rows;
    }
  
    async findById(storeId, id) {
      const query = 'SELECT * FROM sale_order WHERE id = $1 AND store_id = $2';
      const { rows } = await this.pool.query(query, [id, storeId]);
      return rows[0] || null;
    }
  
    async createOrderWithClient(client, storeId, data, status = 'draft') {
      const { customer_id, created_by, delivery_type, address, shipping_fee, discount_percentage, total_amount } = data;
      const query = `
        INSERT INTO sale_order 
        (store_id, customer_id, created_by, delivery_type, address, shipping_fee, discount_percentage, total_amount, status, payment_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
        RETURNING *
      `;
      const { rows } = await client.query(query, [
        storeId, customer_id, created_by, delivery_type, address, shipping_fee || 0, discount_percentage || 0, total_amount || 0, status
      ]);
      return rows[0];
    }

    async updateWithClient(client, storeId, id, data) {
      const setClauses = [];
      const params = [id, storeId]; // $1, $2

      const fieldMap = {
        status: 'status',
        payment_status: 'payment_status',
        delivery_type: 'delivery_type',
        address: 'address',
        shipping_fee: 'shipping_fee',
        discount_percentage: 'discount_percentage',
        total_amount: 'total_amount'
      };

      for (const [key, column] of Object.entries(fieldMap)) {
        if (data[key] !== undefined) {
          params.push(data[key]);
          setClauses.push(`${column} = $${params.length}`);
        }
      }

      if (setClauses.length === 0) return null;

      const query = `
        UPDATE sale_order 
        SET ${setClauses.join(', ')}
        WHERE id = $1 AND store_id = $2
        RETURNING *
      `;
      const { rows } = await client.query(query, params);
      return rows[0];
    }
  
    async updateStatusWithClient(client, storeId, id, status, paymentStatus) {
       const setClauses = [];
       const params = [id, storeId]; // $1, $2
       
       if (status) {
           params.push(status);
           setClauses.push(`status = $${params.length}`);
       }
       if (paymentStatus) {
           params.push(paymentStatus);
           setClauses.push(`payment_status = $${params.length}`);
       }
       
       if (setClauses.length === 0) return null;
       
       const query = `
          UPDATE sale_order 
          SET ${setClauses.join(', ')}
          WHERE id = $1 AND store_id = $2
          RETURNING *
       `;
       const { rows } = await client.query(query, params);
       return rows[0];
    }

    async deleteWithClient(client, storeId, id) {
      const query = 'DELETE FROM sale_order WHERE id = $1 AND store_id = $2 RETURNING *';
      const { rows } = await client.query(query, [id, storeId]);
      return rows[0] || null;
    }

    async deleteDraftsWithClient(client, storeId) {
      const query = `
        DELETE FROM sale_order 
        WHERE store_id = $1 AND status = 'draft' AND payment_status = 'pending'
        RETURNING id
      `;
      const { rows } = await client.query(query, [storeId]);
      return rows.length;
    }
}
  
module.exports = OrderRepository;
