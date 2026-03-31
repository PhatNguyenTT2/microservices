const { ValidationError, NotFoundError, AppError } = require('../../../../shared/common/errors');

class StockOutService {
    constructor(stockOutRepo, inventoryRepo, batchRepo, pool) {
        this.stockOutRepo = stockOutRepo;
        this.inventoryRepo = inventoryRepo;
        this.batchRepo = batchRepo;
        this.pool = pool;
    }

    async getOrders(storeId, filters) {
        return await this.stockOutRepo.findAll(storeId, filters);
    }

    async getOrderById(storeId, soId) {
        const order = await this.stockOutRepo.findById(storeId, soId);
        if (!order) throw new NotFoundError('Stock Out Order not found');
        const details = await this.stockOutRepo.findDetails(soId);
        return { ...order, details };
    }

    /**
     * Create order with items in a single transaction
     * items = [{ batch_id, quantity, unit_price }]
     */
    async createOrder(storeId, data, userId) {
        const { reason, destination, items } = data;
        if (!items || items.length === 0) throw new ValidationError('Must provide items to stock out');

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            let totalPrice = 0;
            const validItems = [];

            for (const item of items) {
                const batch = await this.batchRepo.findById(storeId, item.batch_id);
                if (!batch) {
                    throw new ValidationError(`Batch ${item.batch_id} invalid or unauthorized for this store`);
                }
                const lineTotal = item.quantity * (item.unit_price || batch.unit_price);
                totalPrice += Number(lineTotal);

                validItems.push({
                    batch_id: item.batch_id,
                    quantity: item.quantity,
                    unit_price: item.unit_price || batch.unit_price,
                    total_price: lineTotal
                });
            }

            const header = await this.stockOutRepo.createOrderWithClient(client, storeId, {
                reason,
                destination,
                total_price: totalPrice,
                created_by: userId
            });

            for (const vItem of validItems) {
                await this.stockOutRepo.addDetailWithClient(client, header.id, vItem);
            }

            await client.query('COMMIT');
            return header;
        } catch (error) {
            await client.query('ROLLBACK');
            throw new AppError(error.message, error.statusCode || 500);
        } finally {
            client.release();
        }
    }

    /**
     * Update order — full edit (header + items) for draft, header-only for pending
     */
    async updateOrder(storeId, soId, data, userId) {
        const order = await this.stockOutRepo.findById(storeId, soId);
        if (!order) throw new NotFoundError('Stock Out Order not found');

        if (order.status === 'completed' || order.status === 'cancelled') {
            throw new ValidationError(`Cannot edit ${order.status} orders`);
        }

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            // Update header (allowed for both draft and pending)
            if (data.reason || data.destination !== undefined) {
                await this.stockOutRepo.updateOrderWithClient(client, storeId, soId, {
                    reason: data.reason,
                    destination: data.destination
                });
            }

            // Update items — only allowed for draft
            if (data.items && order.status === 'draft') {
                // Delete old details
                await this.stockOutRepo.deleteAllDetailsWithClient(client, soId);

                // Insert new details
                let totalPrice = 0;
                for (const item of data.items) {
                    const batch = await this.batchRepo.findById(storeId, item.batch_id);
                    if (!batch) {
                        throw new ValidationError(`Batch ${item.batch_id} invalid`);
                    }
                    const lineTotal = item.quantity * (item.unit_price || batch.unit_price);
                    totalPrice += Number(lineTotal);

                    await this.stockOutRepo.addDetailWithClient(client, soId, {
                        batch_id: item.batch_id,
                        quantity: item.quantity,
                        unit_price: item.unit_price || batch.unit_price,
                        total_price: lineTotal
                    });
                }

                // Update total
                await client.query(
                    'UPDATE stock_out_order SET total_price = $1 WHERE id = $2 AND store_id = $3',
                    [totalPrice, soId, storeId]
                );
            } else if (data.items && order.status === 'pending') {
                throw new ValidationError('Cannot modify items on pending orders. Only header fields can be edited.');
            }

            await client.query('COMMIT');
            return await this.getOrderById(storeId, soId);
        } catch (error) {
            await client.query('ROLLBACK');
            throw new AppError(error.message, error.statusCode || 500);
        } finally {
            client.release();
        }
    }

    /**
     * Delete order — only draft
     */
    async deleteOrder(storeId, soId) {
        const order = await this.stockOutRepo.findById(storeId, soId);
        if (!order) throw new NotFoundError('Stock Out Order not found');
        if (order.status !== 'draft') {
            throw new ValidationError('Only draft orders can be deleted');
        }

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await this.stockOutRepo.deleteOrderWithClient(client, storeId, soId);
            await client.query('COMMIT');
            return { message: 'Stock Out Order deleted' };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Status transitions:
     *   draft → pending (lock items)
     *   draft → cancelled
     *   pending → completed (deduct inventory)
     *   pending → cancelled
     */
    async updateStatus(storeId, soId, newStatus, userId) {
        const order = await this.stockOutRepo.findById(storeId, soId);
        if (!order) throw new NotFoundError('Stock Out Order not found');

        const allowed = {
            'draft': ['pending', 'cancelled'],
            'pending': ['completed', 'cancelled']
        };

        if (!allowed[order.status]?.includes(newStatus)) {
            throw new ValidationError(`Cannot transition from '${order.status}' to '${newStatus}'`);
        }

        if (newStatus === 'completed') {
            return await this._completeOrder(storeId, soId, userId);
        }

        // For pending/cancelled — simple status update
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const updated = await this.stockOutRepo.updateStatusWithClient(client, storeId, soId, newStatus);
            await client.query('COMMIT');
            return updated;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Complete order — deduct on_hand inventory + create movement logs
     */
    async _completeOrder(storeId, soId, userId) {
        const orderData = await this.getOrderById(storeId, soId);

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            await this.stockOutRepo.updateStatusWithClient(client, storeId, soId, 'completed');

            for (const detail of orderData.details) {
                const qtyToDeduct = detail.quantity;
                let remainingToDeduct = qtyToDeduct;

                const itemsQuery = `
                    SELECT * FROM inventory_item 
                    WHERE product_batch_id = $1 AND quantity_on_hand > 0
                    FOR UPDATE
                `;
                const { rows: inventoryItems } = await client.query(itemsQuery, [detail.batch_id]);

                for (const invItem of inventoryItems) {
                    if (remainingToDeduct <= 0) break;

                    const deductFromThisItem = Math.min(invItem.quantity_on_hand, remainingToDeduct);

                    await this.inventoryRepo.updateItemQuantitiesWithClient(
                        client, invItem.id, -deductFromThisItem, 0, 0
                    );

                    await this.inventoryRepo.recordMovementWithClient(client, {
                        inventory_item_id: invItem.id,
                        movement_type: 'out',
                        quantity: deductFromThisItem,
                        reason: `stock_out | SO #${soId} | ${orderData.reason}`,
                        performed_by: userId
                    });

                    remainingToDeduct -= deductFromThisItem;
                }

                if (remainingToDeduct > 0) {
                    throw new ValidationError(
                        `Insufficient on_hand stock for batch ${detail.batch_id}. Missing ${remainingToDeduct}`
                    );
                }
            }

            await client.query('COMMIT');
            return { message: 'Stock Out Order completed successfully' };
        } catch (error) {
            await client.query('ROLLBACK');
            throw new AppError(error.message, error.statusCode || 500);
        } finally {
            client.release();
        }
    }
}

module.exports = StockOutService;
