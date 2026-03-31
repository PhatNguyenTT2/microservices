const { ValidationError, NotFoundError, AppError } = require('../../../../shared/common/errors');

/**
 * Inventory Service
 * Dịch vụ xử lý Nhập xuất / Cập nhật tồn kho (Transaction Zone)
 */
class InventoryService {
    constructor(inventoryRepo, batchRepo, warehouseRepo, dbPool) {
        this.inventoryRepo = inventoryRepo;
        this.batchRepo = batchRepo;
        this.warehouseRepo = warehouseRepo;
        this.pool = dbPool;
    }

    // --- Query Views ---
    async getInventorySummary(storeId, filters) {
        return await this.inventoryRepo.getStoreInventory(storeId, filters);
    }

    // --- 🔴 Core Write Operations (Zone 1 Transaction) ---

    /**
     * Nhận hàng và Cập nhật lượng (Cộng On-Hand, sinh Movement Log)
     * Thường gọi từ PurchaseOrder Receive của Supplier Service (qua EventBus)
     */
    async receiveStock(storeId, batchId, locationId, quantity, userId, reason = 'po_receive') {
        if (quantity <= 0) {
            throw new ValidationError('Receive quantity must be strictly positive (>0)');
        }

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            
            // 1. Verify and lock batch
            const batch = await this.batchRepo.findById(storeId, batchId);
            if (!batch) {
                throw new NotFoundError(`Batch ${batchId} not found in this store`);
            }
            if (batch.status !== 'active') {
                throw new ValidationError(`Cannot receive stock into inactive batch ${batchId}`);
            }

            // 2. If no locationId, try to auto-find first available location
            let resolvedLocationId = locationId;
            if (!resolvedLocationId) {
                const blocks = await this.warehouseRepo.findBlocks(storeId);
                if (blocks.length > 0) {
                    for (const block of blocks) {
                        const locations = await this.warehouseRepo.findLocationsByBlock(block.id);
                        const activeLoc = locations.find(l => l.is_active !== false);
                        if (activeLoc) {
                            resolvedLocationId = activeLoc.id;
                            break;
                        }
                    }
                }
                // resolvedLocationId may still be null — that's OK (assign later)
            }

            // 3. Lock item or Create if missing
            let item = await this.inventoryRepo.findItemForUpdateWithClient(client, batchId, resolvedLocationId);
            if (!item) {
                if (resolvedLocationId) {
                    // Verify location belongs to store
                    const locationQuery = 'SELECT * FROM location l JOIN warehouse_block w ON l.block_id = w.id WHERE l.id = $1 AND w.store_id = $2';
                    const locCheck = await client.query(locationQuery, [resolvedLocationId, storeId]);
                    if (locCheck.rows.length === 0) {
                        throw new ValidationError(`Location ${resolvedLocationId} invalid or not belonging to store ${storeId}`);
                    }
                }
                
                // Create item (location_id can be NULL for "assign later")
                item = await this.inventoryRepo.createItemWithClient(client, {
                    product_batch_id: batchId,
                    location_id: resolvedLocationId || null,
                    quantity_on_hand: 0,
                    quantity_on_shelf: 0
                });
            }

            // 4. Update quantity (on_hand + quantity)
            await this.inventoryRepo.updateItemQuantitiesWithClient(
                client, 
                item.id, 
                quantity, // diff on hand
                0,        // diff on shelf
                0         // diff reserved
            );

            // 5. Record Movement Log
            await this.inventoryRepo.recordMovementWithClient(client, {
                inventory_item_id: item.id,
                movement_type: 'in',
                quantity: quantity,
                reason: reason,
                performed_by: userId
            });

            await client.query('COMMIT');
            return { message: 'Stock received successfully' };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Phân quyền nội bộ kho: Move từ On-Hand sang On-Shelf (và ngược lại nếu moveQty âm)
     */
    async moveStockToShelf(storeId, batchId, locationId, moveQty, userId) {
        if (moveQty === 0) throw new ValidationError('Quantity must be non-zero');

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            const item = await this.inventoryRepo.findItemForUpdateWithClient(client, batchId, locationId);
            if (!item) throw new NotFoundError('Inventory item not found');
            
            // Re-check store via batch
            const batch = await this.batchRepo.findById(storeId, batchId);
            if (!batch) throw new ValidationError('Security cross-store violation');

            if (moveQty > 0) {
                // To Shelf
                if (item.quantity_on_hand < moveQty) {
                     throw new ValidationError(`Not enough stock on-hand. Available: ${item.quantity_on_hand}`);
                }
            } else {
                // To Warehouse (negative moveQty)
                const absQty = Math.abs(moveQty);
                if (item.quantity_on_shelf < absQty) {
                     throw new ValidationError(`Not enough stock on-shelf. Available: ${item.quantity_on_shelf}`);
                }
            }

            // Decrease on_hand, increase on_shelf (moveQty can be negative)
            await this.inventoryRepo.updateItemQuantitiesWithClient(
                client, item.id, -moveQty, moveQty, 0
            );

            // Record Log
            await this.inventoryRepo.recordMovementWithClient(client, {
                inventory_item_id: item.id,
                movement_type: 'transfer',
                quantity: moveQty,
                reason: 'moved_to_shelf',
                performed_by: userId
            });

            await client.query('COMMIT');
            return { message: 'Stock moved to shelf' };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Trừ kho khi POS checkout thành công (On-Shelf giảm, sinh Movement Log)
     * Gọi từ EventBus: payment.completed → deductStock
     */
    async deductStock(storeId, batchId, locationId, quantity, userId, reason = 'pos_sale') {
        if (quantity <= 0) {
            throw new ValidationError('Deduct quantity must be strictly positive (>0)');
        }

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Verify batch belongs to store
            const batch = await this.batchRepo.findById(storeId, batchId);
            if (!batch) {
                throw new NotFoundError(`Batch ${batchId} not found in this store`);
            }

            // 2. Lock item
            const item = await this.inventoryRepo.findItemForUpdateWithClient(client, batchId, locationId);
            if (!item) throw new NotFoundError('Inventory item not found');

            if (item.quantity_on_shelf < quantity) {
                throw new ValidationError(`Not enough stock on shelf. Available: ${item.quantity_on_shelf}, Requested: ${quantity}`);
            }

            // 3. Decrease on_shelf
            await this.inventoryRepo.updateItemQuantitiesWithClient(
                client, item.id, 0, -quantity, 0
            );

            // 4. Record Movement Log
            await this.inventoryRepo.recordMovementWithClient(client, {
                inventory_item_id: item.id,
                movement_type: 'out',
                quantity: quantity,
                reason: reason,
                performed_by: userId
            });

            await client.query('COMMIT');
            return { message: 'Stock deducted successfully' };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Adjust stock manually (manual count correction, damage, etc.)
     * quantity > 0 = increase, quantity < 0 = decrease
     * targetLocation: 'onHand' or 'onShelf'
     */
    async adjustStock(storeId, batchId, locationId, quantity, targetLocation, userId, reason = 'manual_adjustment') {
        if (quantity === 0) throw new ValidationError('Adjustment quantity cannot be zero');

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            const batch = await this.batchRepo.findById(storeId, batchId);
            if (!batch) throw new NotFoundError(`Batch ${batchId} not found in this store`);

            const item = await this.inventoryRepo.findItemForUpdateWithClient(client, batchId, locationId);
            if (!item) throw new NotFoundError('Inventory item not found');

            // Validate decrease doesn't go below 0
            if (quantity < 0) {
                const currentQty = targetLocation === 'onShelf' ? item.quantity_on_shelf : item.quantity_on_hand;
                if (currentQty < Math.abs(quantity)) {
                    throw new ValidationError(
                        `Insufficient stock. Available ${targetLocation}: ${currentQty}, Requested decrease: ${Math.abs(quantity)}`
                    );
                }
            }

            // Apply adjustment to correct location
            const diffOnHand = targetLocation === 'onHand' ? quantity : 0;
            const diffOnShelf = targetLocation === 'onShelf' ? quantity : 0;

            await this.inventoryRepo.updateItemQuantitiesWithClient(
                client, item.id, diffOnHand, diffOnShelf, 0
            );

            await this.inventoryRepo.recordMovementWithClient(client, {
                inventory_item_id: item.id,
                movement_type: 'adjustment',
                quantity: quantity,
                reason: reason,
                performed_by: userId
            });

            await client.query('COMMIT');
            return { message: 'Stock adjusted successfully' };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    // --- 🔵 Saga Reserve Operations (Phase 1) ---

    /**
     * Giữ chỗ hàng trên kệ (On-Shelf → Reserved)
     * Gọi khi tạo Order → giảm on_shelf, tăng reserved
     * Event: order.created → reserveStock
     */
    async reserveStock(storeId, items, reason = 'order_reserve') {
        if (!items || items.length === 0) {
            throw new ValidationError('No items to reserve');
        }

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            for (const { batchId, locationId, quantity } of items) {
                if (quantity <= 0) throw new ValidationError('Reserve quantity must be > 0');

                const batch = await this.batchRepo.findById(storeId, batchId);
                if (!batch) throw new NotFoundError(`Batch ${batchId} not found`);

                const item = await this.inventoryRepo.findItemForUpdateWithClient(client, batchId, locationId);
                if (!item) throw new NotFoundError(`Inventory item not found for batch ${batchId}`);

                if (item.quantity_on_shelf < quantity) {
                    throw new ValidationError(
                        `Not enough stock on shelf for batch ${batchId}. Available: ${item.quantity_on_shelf}, Requested: ${quantity}`
                    );
                }

                // on_shelf -= qty, reserved += qty
                await this.inventoryRepo.updateItemQuantitiesWithClient(
                    client, item.id, 0, -quantity, quantity
                );

                await this.inventoryRepo.recordMovementWithClient(client, {
                    inventory_item_id: item.id,
                    movement_type: 'reserve',
                    quantity: quantity,
                    reason: reason,
                    performed_by: null
                });
            }

            await client.query('COMMIT');
            return { message: 'Stock reserved successfully' };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Hoàn trả hàng đã giữ chỗ (Reserved → On-Shelf)
     * Compensating transaction khi payment fail/timeout hoặc order cancelled
     * Event: payment.failed / payment.timeout → releaseStock
     */
    async releaseStock(storeId, items, reason = 'order_release') {
        if (!items || items.length === 0) return { message: 'No items to release' };

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            for (const { batchId, locationId, quantity } of items) {
                if (quantity <= 0) continue;

                const item = await this.inventoryRepo.findItemForUpdateWithClient(client, batchId, locationId);
                if (!item) continue; // best-effort release

                const releaseQty = Math.min(quantity, item.quantity_reserved);
                if (releaseQty <= 0) continue;

                // reserved -= qty, on_shelf += qty
                await this.inventoryRepo.updateItemQuantitiesWithClient(
                    client, item.id, 0, releaseQty, -releaseQty
                );

                await this.inventoryRepo.recordMovementWithClient(client, {
                    inventory_item_id: item.id,
                    movement_type: 'release',
                    quantity: releaseQty,
                    reason: reason,
                    performed_by: null
                });
            }

            await client.query('COMMIT');
            return { message: 'Stock released successfully' };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Xác nhận trừ kho đã giữ chỗ (Reserved → Sold / Deducted)
     * Final step khi payment thành công
     * Event: payment.completed → confirmDeduct
     */
    async confirmDeduct(storeId, items, reason = 'order_confirmed') {
        if (!items || items.length === 0) return { message: 'No items to confirm' };

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            for (const { batchId, locationId, quantity } of items) {
                if (quantity <= 0) continue;

                const item = await this.inventoryRepo.findItemForUpdateWithClient(client, batchId, locationId);
                if (!item) continue;

                const deductQty = Math.min(quantity, item.quantity_reserved);
                if (deductQty <= 0) continue;

                // reserved -= qty (stock officially sold)
                await this.inventoryRepo.updateItemQuantitiesWithClient(
                    client, item.id, 0, 0, -deductQty
                );

                await this.inventoryRepo.recordMovementWithClient(client, {
                    inventory_item_id: item.id,
                    movement_type: 'out',
                    quantity: deductQty,
                    reason: reason,
                    performed_by: null
                });
            }

            await client.query('COMMIT');
            return { message: 'Stock deduction confirmed' };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = InventoryService;
