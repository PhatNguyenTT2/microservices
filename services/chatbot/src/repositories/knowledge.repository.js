/**
 * KnowledgeRepository — Dual Search (pgvector + tsvector)
 * Provides semantic search (cosine) and keyword search (full-text) for Hybrid RAG
 */
const logger = require('../../../../shared/common/logger');

class KnowledgeRepository {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * Semantic search via pgvector cosine distance
     * @param {number[]} queryVector - 768d embedding vector
     * @param {number} storeId
     * @param {number} limit
     * @returns {object[]} rows with cosine similarity score
     */
    async searchSemantic(queryVector, storeId, limit = 10) {
        const vectorStr = `[${queryVector.join(',')}]`;
        const startTime = Date.now();

        const { rows } = await this.pool.query(`
            SELECT
                product_id, store_id, content, category_name,
                unit_price, is_in_stock, quantity_on_shelf,
                1 - (embedding <=> $1::vector) AS score
            FROM product_knowledge_base
            WHERE store_id = $2 AND is_in_stock = TRUE
            ORDER BY embedding <=> $1::vector ASC
            LIMIT $3
        `, [vectorStr, storeId, limit]);

        logger.debug({ storeId, resultCount: rows.length, latencyMs: Date.now() - startTime }, 'Semantic search completed');
        return rows;
    }

    /**
     * Keyword search via PostgreSQL tsvector full-text search
     * Uses 'simple' config (no stemming — better for Vietnamese)
     * @param {string} query - raw text query
     * @param {number} storeId
     * @param {number} limit
     * @returns {object[]} rows with ts_rank score
     */
    async searchKeyword(query, storeId, limit = 10) {
        const startTime = Date.now();

        const { rows } = await this.pool.query(`
            SELECT
                product_id, store_id, content, category_name,
                unit_price, is_in_stock, quantity_on_shelf,
                ts_rank(fts_content, plainto_tsquery('simple', $1)) AS score
            FROM product_knowledge_base
            WHERE store_id = $2
              AND is_in_stock = TRUE
              AND fts_content @@ plainto_tsquery('simple', $1)
            ORDER BY score DESC
            LIMIT $3
        `, [query, storeId, limit]);

        logger.debug({ storeId, query, resultCount: rows.length, latencyMs: Date.now() - startTime }, 'Keyword search completed');
        return rows;
    }

    /**
     * UPSERT a product into knowledge base (used by DataIngestionService)
     */
    async upsertKnowledge(data) {
        const { productId, storeId, content, embedding, categoryName, unitPrice, isInStock, qtyOnShelf } = data;
        const vectorStr = `[${embedding.join(',')}]`;

        await this.pool.query(`
            INSERT INTO product_knowledge_base
                (product_id, store_id, content, embedding, fts_content, category_name, unit_price, is_in_stock, quantity_on_shelf, last_synced_at)
            VALUES ($1, $2, $3, $4::vector, to_tsvector('simple', $3), $5, $6, $7, $8, NOW())
            ON CONFLICT (product_id, store_id)
            DO UPDATE SET
                content = EXCLUDED.content,
                embedding = EXCLUDED.embedding,
                fts_content = EXCLUDED.fts_content,
                category_name = EXCLUDED.category_name,
                unit_price = EXCLUDED.unit_price,
                is_in_stock = EXCLUDED.is_in_stock,
                quantity_on_shelf = EXCLUDED.quantity_on_shelf,
                last_synced_at = NOW()
        `, [productId, storeId, content, vectorStr, categoryName, unitPrice, isInStock, qtyOnShelf]);
    }

    /**
     * Delete all entries for a product (all stores)
     */
    async deleteByProductId(productId) {
        const { rowCount } = await this.pool.query(
            'DELETE FROM product_knowledge_base WHERE product_id = $1',
            [productId]
        );
        return rowCount;
    }

    /**
     * Get knowledge base stats for monitoring
     */
    async getStats(storeId = null) {
        const whereClause = storeId ? 'WHERE store_id = $1' : '';
        const params = storeId ? [storeId] : [];

        const { rows } = await this.pool.query(`
            SELECT
                COUNT(*) AS total_entries,
                COUNT(*) FILTER (WHERE is_in_stock = TRUE) AS in_stock_count,
                COUNT(*) FILTER (WHERE is_in_stock = FALSE) AS out_of_stock_count,
                MIN(last_synced_at) AS oldest_sync,
                MAX(last_synced_at) AS latest_sync
            FROM product_knowledge_base
            ${whereClause}
        `, params);

        return rows[0] || { total_entries: 0 };
    }
}

module.exports = KnowledgeRepository;
