const { ValidationError, NotFoundError, AppError } = require('../../../../shared/common/errors');
const outbox = require('../../../../shared/outbox');
const EVENT = require('../../../../shared/event-bus/eventTypes');

const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL || 'http://inventory:3006';
const FEFO_TIMEOUT_MS = 2000;

class OrderService {
    constructor(orderRepo, orderDetailRepo, pool) {
      this.orderRepo = orderRepo;
      this.detailRepo = orderDetailRepo;
      this.pool = pool;
    }

    // ============================================================
    // FEFO Batch Allocation (inter-service call to inventory)
    // ============================================================

    /**
     * Fetch available batches for a product from inventory-service
     * Uses 2s timeout + forward JWT for auth
     */
    async fetchBatchesFromInventory(productId, jwtToken) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FEFO_TIMEOUT_MS);

      try {
        const url = `${INVENTORY_SERVICE_URL}/api/inventory/batches/${productId}`;
        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${jwtToken}` },
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`Inventory service returned ${response.status}`);
        }

        const data = await response.json();
        return data.data || [];
      } catch (error) {
        if (error.name === 'AbortError') {
          throw new AppError('Inventory service timeout (2s exceeded)', 503);
        }
        throw new AppError('Failed to fetch batches from inventory: ' + error.message, 503);
      } finally {
        clearTimeout(timeout);
      }
    }

    /**
     * FEFO batch allocation: resolve batch_id for items that don't have one
     * - Items with batch_id (fresh/manual) → kept as-is
     * - Items without batch_id → auto-select from inventory (earliest expiry first)
     * - Multi-batch split if single batch insufficient
     */
    async allocateBatchesFEFO(storeId, items, jwtToken) {
      const allocatedItems = [];

      for (const item of items) {
        // Manual batch selection (fresh products) → keep
        if (item.batch_id) {
          allocatedItems.push({
            product_id: item.product_id,
            product_name: item.product_name,
            batch_id: item.batch_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total_price: item.quantity * item.unit_price
          });
          continue;
        }

        // Auto-allocate via inventory-service FEFO
        if (!item.product_id) {
          throw new ValidationError(`product_id is required for FEFO allocation (product: "${item.product_name}")`);
        }

        const batches = await this.fetchBatchesFromInventory(item.product_id, jwtToken);

        // Filter: active + not expired + has shelf stock → sort FEFO
        const available = batches
          .filter(b => b.status === 'active' && b.totalOnShelf > 0
                    && new Date(b.expiryDate) > new Date())
          .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

        // Multi-batch allocation
        let remaining = item.quantity;
        for (const batch of available) {
          if (remaining <= 0) break;
          const qty = Math.min(remaining, batch.totalOnShelf);
          allocatedItems.push({
            product_id: item.product_id,
            product_name: item.product_name,
            batch_id: batch.id,
            quantity: qty,
            unit_price: item.unit_price,
            total_price: qty * item.unit_price
          });
          remaining -= qty;
        }

        if (remaining > 0) {
          const totalAvailable = available.reduce((sum, b) => sum + b.totalOnShelf, 0);
          throw new ValidationError(
            `Insufficient shelf stock for "${item.product_name}". ` +
            `Needed: ${item.quantity}, Available: ${totalAvailable}`
          );
        }
      }

      return allocatedItems;
    }

    /**
     * Format order row from snake_case DB → camelCase frontend
     */
    formatOrder(row) {
      if (!row) return null;
      return {
        id: row.id,
        orderNumber: `ORD-${String(row.id).padStart(4, '0')}`,
        storeId: row.store_id,
        customerId: row.customer_id,
        createdBy: row.created_by,
        orderDate: row.order_date,
        deliveryType: row.delivery_type,
        address: row.address,
        shippingFee: parseFloat(row.shipping_fee || 0),
        discountPercentage: parseFloat(row.discount_percentage || 0),
        total: parseFloat(row.total_amount || 0),
        paymentStatus: row.payment_status,
        status: row.status
      };
    }

    formatOrderDetail(row) {
      if (!row) return null;
      return {
        id: row.id,
        orderId: row.order_id,
        productId: row.product_id,
        productName: row.product_name,
        batchId: row.batch_id,
        quantity: row.quantity,
        unitPrice: parseFloat(row.unit_price || 0),
        totalPrice: parseFloat(row.total_price || 0)
      };
    }
  
    async getStoreOrders(storeId, filters) {
      const rows = await this.orderRepo.findAll(storeId, filters);
      return rows.map(row => this.formatOrder(row));
    }
  
    async getOrderById(storeId, id) {
      const order = await this.orderRepo.findById(storeId, id);
      if (!order) throw new NotFoundError('Order not found');
      const details = await this.detailRepo.findByOrderId(order.id);
      return {
        ...this.formatOrder(order),
        details: details.map(d => this.formatOrderDetail(d))
      };
    }
  
    async createDraftOrder(storeId, data, userId, jwtToken) {
      const { customer_id, delivery_type, address, items: rawItems } = data; 
      
      if (!rawItems || rawItems.length === 0) throw new ValidationError('Order must contain items');

      // FEFO allocation: resolve batch_id for items without manual batch
      const items = await this.allocateBatchesFEFO(storeId, rawItems, jwtToken);
  
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        
        let subtotal = 0;
        const validItems = items.map(item => {
          subtotal += item.total_price;
          return item;
        });
  
        const discount_percentage = data.discount_percentage || 0;
        const shipping_fee = Number(data.shipping_fee || 0);
        const total_amount = subtotal * (1 - discount_percentage / 100) + shipping_fee;
  
        const orderData = {
           customer_id: customer_id,
           created_by: userId,
           delivery_type,
           address,
           shipping_fee,
           discount_percentage,
           total_amount
        };
  
        const header = await this.orderRepo.createOrderWithClient(client, storeId, orderData);
  
        for (const vItem of validItems) {
           await this.detailRepo.addDetailWithClient(client, header.id, vItem);
        }
  
        await client.query('COMMIT');
        
        const details = await this.detailRepo.findByOrderId(header.id);
        return {
          ...this.formatOrder(header),
          details: details.map(d => this.formatOrderDetail(d))
        };
  
      } catch (error) {
        await client.query('ROLLBACK');
        throw new AppError('Failed to create order: ' + error.message, 500);
      } finally {
        client.release();
      }
    }

    // NOTE: createOnlineOrder REMOVED — simplified flow uses createDraftOrder for ALL orders
    // Online orders follow: draft → (payment.completed) → shipping → delivered

    async updateOrder(storeId, id, data) {
      const order = await this.orderRepo.findById(storeId, id);
      if (!order) throw new NotFoundError('Order not found');

      // Cannot update cancelled or refunded orders
      if (['cancelled', 'refunded'].includes(order.status)) {
        throw new ValidationError(`Cannot update order with status '${order.status}'`);
      }

      // Map camelCase input → snake_case for DB
      const dbData = {};
      if (data.status !== undefined) dbData.status = data.status;
      if (data.paymentStatus !== undefined) dbData.payment_status = data.paymentStatus;
      if (data.deliveryType !== undefined) dbData.delivery_type = data.deliveryType;
      if (data.address !== undefined) dbData.address = data.address;
      if (data.shippingFee !== undefined) dbData.shipping_fee = data.shippingFee;
      if (data.discountPercentage !== undefined) dbData.discount_percentage = data.discountPercentage;

      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const updated = await this.orderRepo.updateWithClient(client, storeId, id, dbData);

        if (!updated) throw new AppError('No fields to update', 400);

        // Publish inventory events on status transitions (delivery orders)
        const newStatus = dbData.status;
        if (newStatus && order.delivery_type === 'delivery' && ['delivered', 'cancelled'].includes(newStatus)) {
          const details = await this.detailRepo.findByOrderId(id);
          const items = details.map(d => ({
            batchId: d.batch_id,
            locationId: null,
            quantity: d.quantity
          }));

          if (newStatus === 'delivered' && order.status === 'shipping') {
            await outbox.insertEvent(client, EVENT.ORDER_DELIVERED, { orderId: id, storeId, items, deliveryType: order.delivery_type }, 'order-service');
          } else if (newStatus === 'cancelled' && order.status === 'shipping') {
            await outbox.insertEvent(client, EVENT.ORDER_CANCELLED, { orderId: id, storeId, items, deliveryType: order.delivery_type }, 'order-service');
          }
        }

        // Publish order.completed when manually transitioning to 'delivered'
        if (newStatus === 'delivered') {
          const details = await this.detailRepo.findByOrderId(id);
          const completedItems = details.map(d => ({
            productId: d.product_id,
            productName: d.product_name,
            batchId: d.batch_id,
            quantity: d.quantity,
            unitPrice: parseFloat(d.unit_price || 0)
          }));

          await outbox.insertEvent(client, EVENT.ORDER_COMPLETED, {
            orderId: id,
            storeId,
            customerId: order.customer_id,
            items: completedItems,
            deliveryType: order.delivery_type
          }, 'order-service');
        }

        await client.query('COMMIT');
        return this.formatOrder(updated);
      } catch (error) {
        await client.query('ROLLBACK');
        if (error instanceof ValidationError || error instanceof NotFoundError) throw error;
        throw new AppError('Update failed: ' + error.message, 500);
      } finally {
        client.release();
      }
    }
    
    async updateOrderStatus(storeId, id, status, paymentStatus) {
         if (!status && !paymentStatus) throw new ValidationError('No status to update');
         
         const client = await this.pool.connect();
         try {
              await client.query('BEGIN');
              const order = await this.orderRepo.findById(storeId, id);
              if (!order) throw new NotFoundError('Order not found');
              
              const updated = await this.orderRepo.updateStatusWithClient(client, storeId, id, status, paymentStatus);

              // Publish inventory events on status transitions (delivery orders)
              if (status && order.delivery_type === 'delivery') {
                const details = await this.detailRepo.findByOrderId(id);
                const items = details.map(d => ({
                  batchId: d.batch_id,
                  locationId: null,
                  quantity: d.quantity
                }));

                if (status === 'shipping' && order.status === 'draft') {
                  // Phase 1: Payment completed for delivery → publish order.shipping
                  await outbox.insertEvent(client, EVENT.ORDER_SHIPPING, { orderId: id, storeId, items, deliveryType: order.delivery_type }, 'order-service');
                } else if (status === 'delivered' && order.status === 'shipping') {
                  // Phase 2: Delivery confirmed → publish order.delivered
                  await outbox.insertEvent(client, EVENT.ORDER_DELIVERED, { orderId: id, storeId, items, deliveryType: order.delivery_type }, 'order-service');
                } else if (status === 'cancelled' && order.status === 'shipping') {
                  // Cancellation of shipping order → publish order.cancelled
                  await outbox.insertEvent(client, EVENT.ORDER_CANCELLED, { orderId: id, storeId, items, deliveryType: order.delivery_type }, 'order-service');
                }
              }

              // Publish order.completed for any order type (pickup or delivery) transitioning to 'delivered'
              // This feeds the Chatbot co-purchase stats pipeline
              if (status === 'delivered') {
                const details = await this.detailRepo.findByOrderId(id);
                const completedItems = details.map(d => ({
                  productId: d.product_id,
                  productName: d.product_name,
                  batchId: d.batch_id,
                  quantity: d.quantity,
                  unitPrice: parseFloat(d.unit_price || 0)
                }));

                await outbox.insertEvent(client, EVENT.ORDER_COMPLETED, {
                  orderId: id,
                  storeId,
                  customerId: order.customer_id,
                  items: completedItems,
                  deliveryType: order.delivery_type
                }, 'order-service');
              }
              
              await client.query('COMMIT');
              return this.formatOrder(updated);
         } catch(error) {
              await client.query('ROLLBACK');
              throw new AppError('Update status failed: ' + error.message, 500);
         } finally {
              client.release();
         }
    }

    async deleteOrder(storeId, id) {
      const order = await this.orderRepo.findById(storeId, id);
      if (!order) throw new NotFoundError('Order not found');

      // Can only hard-delete draft orders with pending payment
      if (order.status !== 'draft' || order.payment_status !== 'pending') {
        throw new ValidationError('Can only delete draft orders with pending payment');
      }

      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const deleted = await this.orderRepo.deleteWithClient(client, storeId, id);
        await client.query('COMMIT');
        return this.formatOrder(deleted);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new AppError('Delete failed: ' + error.message, 500);
      } finally {
        client.release();
      }
    }

    async deleteDraftOrders(storeId) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const deletedCount = await this.orderRepo.deleteDraftsWithClient(client, storeId);
        await client.query('COMMIT');
        return { deletedCount };
      } catch (error) {
        await client.query('ROLLBACK');
        throw new AppError('Bulk delete failed: ' + error.message, 500);
      } finally {
        client.release();
      }
    }

    /**
     * Manual trigger: Mark order as fully refunded.
     * Pre-condition: payment_status must be 'partial_refund' (all payments refunded via Payment service).
     */
    async refundOrder(storeId, id) {
      const order = await this.orderRepo.findById(storeId, id);
      if (!order) throw new NotFoundError('Order not found');

      if (!['delivered', 'shipping'].includes(order.status)) {
        throw new ValidationError('Can only refund delivered or shipping orders');
      }
      if (!['partial_refund', 'refunded'].includes(order.payment_status)) {
        throw new ValidationError('No refund activity detected. Refund payments first.');
      }

      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const updated = await this.orderRepo.updateStatusWithClient(
          client, storeId, id, 'refunded', 'refunded'
        );

        // Publish order.refunded → Inventory will return stock to on_hand
        const details = await this.detailRepo.findByOrderId(id);
        const items = details.map(d => ({
          batchId: d.batch_id,
          locationId: null,
          quantity: d.quantity
        }));
        await outbox.insertEvent(client, EVENT.ORDER_REFUNDED, {
          orderId: id,
          storeId,
          items,
          deliveryType: order.delivery_type
        }, 'order-service');

        await client.query('COMMIT');

        return {
          success: true,
          message: `Order ORD-${String(id).padStart(4, '0')} refunded successfully`,
          order: this.formatOrder(updated)
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw new AppError('Refund failed: ' + error.message, 500);
      } finally {
        client.release();
      }
    }

    // ============================================================
    // Draft Item Editing
    // ============================================================

    /**
     * Replace items in a draft order
     * Flow: delete old details → FEFO allocate new → insert → recalculate total
     * Only allowed for status='draft'
     */
    async updateDraftItems(storeId, orderId, items, userId, jwtToken) {
      const order = await this.orderRepo.findById(storeId, orderId);
      if (!order) throw new NotFoundError('Order not found');
      if (order.status !== 'draft') {
        throw new ValidationError('Items can only be updated for draft orders');
      }

      if (!items || items.length === 0) {
        throw new ValidationError('Must provide at least one item');
      }

      // FEFO allocation for new items
      const allocatedItems = await this.allocateBatchesFEFO(storeId, items, jwtToken);

      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');

        // Delete old details
        await this.detailRepo.deleteByOrderIdWithClient(client, orderId);

        // Insert new details
        let subtotal = 0;
        for (const item of allocatedItems) {
          subtotal += item.total_price;
          await this.detailRepo.addDetailWithClient(client, orderId, item);
        }

        // Recalculate total
        const discount = parseFloat(order.discount_percentage || 0);
        const shipping = parseFloat(order.shipping_fee || 0);
        const total_amount = subtotal * (1 - discount / 100) + shipping;

        const updated = await this.orderRepo.updateWithClient(
          client, storeId, orderId, { total_amount }
        );

        await client.query('COMMIT');

        const details = await this.detailRepo.findByOrderId(orderId);
        return {
          ...this.formatOrder(updated),
          details: details.map(d => this.formatOrderDetail(d))
        };
      } catch (error) {
        await client.query('ROLLBACK');
        if (error instanceof ValidationError || error instanceof NotFoundError) throw error;
        throw new AppError('Failed to update draft items: ' + error.message, 500);
      } finally {
        client.release();
      }
    }
}
  
module.exports = OrderService;
