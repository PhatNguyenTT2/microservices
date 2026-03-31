/**
 * Product Price History Repository
 * Ghi log biến động giá niêm yết
 */
class ProductPriceHistoryRepository {
    constructor(pool) {
        this.pool = pool;
    }

    async getHistoryByProductId(productId) {
        const query = `
            SELECT * FROM product_price_history 
            WHERE product_id = $1 
            ORDER BY changed_at DESC
        `;
        const { rows } = await this.pool.query(query, [productId]);
        return rows;
    }

    // Insert log trong Zone 1 (Transaction)
    async createWithClient(client, data) {
        const { product_id, old_price, new_price, reason, changed_by } = data;
        const query = `
            INSERT INTO product_price_history 
            (product_id, old_price, new_price, reason, changed_by)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `;
        const { rows } = await client.query(query, [
            product_id, old_price, new_price, reason, changed_by
        ]);
        return rows[0];
    }
}

module.exports = ProductPriceHistoryRepository;
