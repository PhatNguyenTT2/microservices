/**
 * DataIngestionService — Event-Driven + Cron Fallback RAG Pipeline
 * Primary: subscribe product.*, inventory.updated, order.completed
 * Fallback: full-sync every 30 minutes
 */
const logger = require('../../../../shared/common/logger');

const SERVICE_NAME = 'chatbot-service';

class DataIngestionService {
    constructor(pool, embeddingClient, apiClient) {
        this.pool = pool;
        this.embeddingClient = embeddingClient;
        this.apiClient = apiClient;
    }

    // ── Event Handlers (Primary — near real-time) ────────────

    async handleProductCreated(message) {
        const { productId, name, categoryId, categoryName, unitPrice, vendor } = message.data;
        if (await this._isProcessed(message.id)) return;

        logger.info({ productId, name }, 'Ingesting new product');

        const storeIds = await this._getStoreIds();
        for (const storeId of storeIds) {
            const inventory = await this._fetchInventoryForProduct(storeId, productId);
            await this._upsertKnowledge({
                productId, storeId, name, categoryName,
                unitPrice, vendor,
                isInStock: inventory?.isInStock || false,
                qtyOnShelf: inventory?.totalOnShelf || 0
            });
        }

        await this._markProcessed(message.id, message.type);
    }

    async handleProductUpdated(message) {
        const { productId, name, categoryName, unitPrice, vendor } = message.data;
        if (await this._isProcessed(message.id)) return;

        logger.info({ productId, name }, 'Updating product in knowledge base');

        const storeIds = await this._getStoreIds();
        for (const storeId of storeIds) {
            const inventory = await this._fetchInventoryForProduct(storeId, productId);
            await this._upsertKnowledge({
                productId, storeId, name, categoryName,
                unitPrice, vendor,
                isInStock: inventory?.isInStock || false,
                qtyOnShelf: inventory?.totalOnShelf || 0
            });
        }

        await this._markProcessed(message.id, message.type);
    }

    async handleProductDeleted(message) {
        const { productId } = message.data;
        if (await this._isProcessed(message.id)) return;

        logger.info({ productId }, 'Removing product from knowledge base');
        await this.pool.query(
            'DELETE FROM product_knowledge_base WHERE product_id = $1',
            [productId]
        );

        await this._markProcessed(message.id, message.type);
    }

    async handleInventoryUpdated(message) {
        const { storeId, productId, quantityOnShelf, isInStock } = message.data;
        if (await this._isProcessed(message.id)) return;

        logger.info({ storeId, productId, quantityOnShelf }, 'Updating inventory in knowledge base');

        const { rows } = await this.pool.query(
            'SELECT * FROM product_knowledge_base WHERE product_id = $1 AND store_id = $2',
            [productId, storeId]
        );

        if (rows.length > 0) {
            const existing = rows[0];
            const newIsInStock = isInStock !== undefined ? isInStock : quantityOnShelf > 0;
            const newQty = quantityOnShelf !== undefined ? quantityOnShelf : existing.quantity_on_shelf;

            const contentChanged = existing.is_in_stock !== newIsInStock;
            if (contentChanged) {
                // Re-embed since stock status affects content
                await this._upsertKnowledge({
                    productId, storeId,
                    name: existing.content.match(/"([^"]+)"/)?.[1] || `Product ${productId}`,
                    categoryName: existing.category_name,
                    unitPrice: existing.unit_price,
                    vendor: null,
                    isInStock: newIsInStock,
                    qtyOnShelf: newQty
                });
            } else {
                // Light update — no re-embedding needed
                await this.pool.query(`
                    UPDATE product_knowledge_base
                    SET quantity_on_shelf = $1, is_in_stock = $2, last_synced_at = NOW()
                    WHERE product_id = $3 AND store_id = $4
                `, [newQty, newIsInStock, productId, storeId]);
            }
        }

        await this._markProcessed(message.id, message.type);
    }

    async handleOrderCompleted(message) {
        const { items, storeId } = message.data;
        if (await this._isProcessed(message.id)) return;
        if (!items?.length || items.length < 2) return;

        logger.info({ storeId, itemCount: items.length }, 'Processing co-purchase pairs');

        const productIds = items.map(i => i.product_id || i.productId);
        for (let i = 0; i < productIds.length; i++) {
            for (let j = i + 1; j < productIds.length; j++) {
                const [a, b] = [productIds[i], productIds[j]].sort((x, y) => x - y);
                await this.pool.query(`
                    INSERT INTO co_purchase_stats (product_id_a, product_id_b, store_id, co_purchase_count, last_updated_at)
                    VALUES ($1, $2, $3, 1, NOW())
                    ON CONFLICT (product_id_a, product_id_b, store_id)
                    DO UPDATE SET
                        co_purchase_count = co_purchase_stats.co_purchase_count + 1,
                        last_updated_at = NOW()
                `, [a, b, storeId]);
            }
        }

        await this._markProcessed(message.id, message.type);
    }

    // ── Cron Fallback (full-sync) ────────────────────────────

    async syncAll() {
        const startTime = Date.now();
        logger.info('RAG Data Ingestion: Starting full sync...');

        try {
            const storeIds = await this._getStoreIds();
            const productsResult = await this.apiClient.getAllProducts();

            // Catalog API returns: { success, data: { products: [...] } }
            if (!productsResult.success || !productsResult.data?.products?.length) {
                logger.warn('No products found from Catalog — skipping sync');
                return { synced: 0, skipped: 0 };
            }

            const products = productsResult.data.products;

            let synced = 0;
            let skipped = 0;

            for (const storeId of storeIds) {
                const inventoryResult = await this.apiClient.getStoreInventory(storeId);
                const inventoryMap = this._buildInventoryMap(inventoryResult);

                for (const product of products) {
                    try {
                        if (product.isActive === false) {
                            skipped++;
                            continue;
                        }
                        const inventory = inventoryMap.get(String(product.id)) || null;
                        await this._upsertKnowledge({
                            productId: product.id,
                            storeId,
                            name: product.name,
                            categoryName: product.categoryName || 'Chưa phân loại',
                            unitPrice: product.unitPrice || 0,
                            vendor: product.vendor || null,
                            isInStock: inventory ? inventory.isInStock : false,
                            qtyOnShelf: inventory ? inventory.totalOnShelf : 0
                        });
                        synced++;
                    } catch (err) {
                        logger.error({ err, productId: product.id, storeId }, 'Failed to sync product');
                        skipped++;
                    }
                }
            }

            const durationMs = Date.now() - startTime;
            logger.info({ synced, skipped, storeCount: storeIds.length, durationMs },
                'RAG Data Ingestion: Full sync completed');
            return { synced, skipped, durationMs };
        } catch (err) {
            logger.error({ err }, 'RAG Data Ingestion: Sync failed');
            throw err;
        }
    }

    // ── Helpers ──────────────────────────────────────────────

    async _upsertKnowledge({ productId, storeId, name, categoryName, unitPrice, vendor, isInStock, qtyOnShelf }) {
        const content = this._buildContentText(name, categoryName, unitPrice, vendor, isInStock, qtyOnShelf);
        const embedding = await this.embeddingClient.embed(content);
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

    _buildContentText(name, categoryName, price, vendor, isInStock, qtyOnShelf) {
        const parts = [
            `Sản phẩm "${name}"`,
            `danh mục "${categoryName}"`,
            `giá ${Number(price).toLocaleString('vi-VN')} VND`
        ];
        if (vendor) parts.push(`nhà cung cấp "${vendor}"`);
        if (isInStock) {
            parts.push(`hiện còn ${qtyOnShelf} sản phẩm trên kệ`);
        } else {
            parts.push('hiện đã hết hàng');
        }
        // Append keywords for tsvector search
        const keywords = this._extractKeywords(name, vendor);
        return parts.join(', ') + `. Từ khóa: ${keywords}.`;
    }

    _extractKeywords(name, vendor) {
        const keywords = new Set();
        // Add original name tokens
        name.toLowerCase().split(/\s+/).forEach(w => keywords.add(w));
        // Add non-diacritics version
        const noDiacritics = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        noDiacritics.split(/\s+/).forEach(w => keywords.add(w));
        if (vendor) {
            vendor.toLowerCase().split(/\s+/).forEach(w => keywords.add(w));
        }
        return [...keywords].join(', ');
    }

    async _getStoreIds() {
        try {
            const result = await this.apiClient.getStores();
            // Auth API returns: { status, data: { stores: [...] } }
            // ApiClient._fetch extracts: { success, data: { stores: [...] } }
            if (result.success && result.data?.stores?.length) {
                return result.data.stores.map(s => s.id);
            }
        } catch (err) {
            logger.warn({ err }, 'Failed to fetch stores — using fallback');
        }
        const { rows } = await this.pool.query(
            'SELECT DISTINCT store_id FROM product_knowledge_base'
        );
        if (rows.length > 0) return rows.map(r => r.store_id);
        return [1];
    }

    async _fetchInventoryForProduct(storeId, productId) {
        try {
            const result = await this.apiClient.getInventorySummary(storeId, productId);
            if (result.success && result.data) {
                // API returns direct array: [{ productId, quantityOnShelf, ... }]
                const items = Array.isArray(result.data) ? result.data : [];
                const item = items.find(i => String(i.productId || i.id) === String(productId));
                if (item) {
                    const totalOnShelf = parseInt(item.quantityOnShelf || 0);
                    return { totalOnShelf, isInStock: totalOnShelf > 0 };
                }
            }
        } catch (err) {
            logger.warn({ err, storeId, productId }, 'Failed to fetch inventory for product');
        }
        return null;
    }

    _buildInventoryMap(inventoryResult) {
        const map = new Map();
        if (!inventoryResult?.success || !inventoryResult.data) return map;

        // API returns: { success: true, data: [{ productId, quantityOnShelf, ... }] }
        const items = Array.isArray(inventoryResult.data) ? inventoryResult.data : [];

        for (const item of items) {
            const productId = String(item.productId || item.id);
            const totalOnShelf = parseInt(item.quantityOnShelf || 0);
            map.set(productId, {
                totalOnShelf,
                totalOnHand: parseInt(item.quantityOnHand || 0),
                isInStock: totalOnShelf > 0
            });
        }
        return map;
    }

    async _isProcessed(eventId) {
        try {
            await this.pool.query(
                'INSERT INTO processed_events (event_id, event_type, service_name) VALUES ($1, $2, $3)',
                [eventId, 'check', SERVICE_NAME]
            );
            return false;
        } catch (err) {
            if (err.code === '23505') return true;
            throw err;
        }
    }

    async _markProcessed(eventId, eventType) {
        // Event already inserted by _isProcessed — update event_type
        await this.pool.query(
            'UPDATE processed_events SET event_type = $1 WHERE event_id = $2 AND service_name = $3',
            [eventType, eventId, SERVICE_NAME]
        );
    }
}

module.exports = DataIngestionService;
