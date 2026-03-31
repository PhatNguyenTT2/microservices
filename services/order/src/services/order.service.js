const { ValidationError, NotFoundError, AppError } = require('../../../../shared/common/errors');
const outbox = require('../../../../shared/outbox');

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
        status: row.status,
        // Customer placeholder — will be enriched when Auth service integration is ready
        customer: {
          id: row.customer_id,
          fullName: `Customer #${row.customer_id}`,
          phone: ''
        }
      };
    }

    formatOrderDetail(row) {
      if (!row) return null;
      return {
        id: row.id,
        orderId: row.order_id,
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

    /**
     * Saga entry point: Create an online order (status = pending)
     * Atomically saves order + publishes order.created via outbox
     */
    async createOnlineOrder(storeId, data, userId, jwtToken) {
      const { customer_id, delivery_type, address, items: rawItems } = data;

      if (!rawItems || rawItems.length === 0) throw new ValidationError('Order must contain items');

      // FEFO allocation
      const items = await this.allocateBatchesFEFO(storeId, rawItems, jwtToken);

      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');

        let subtotal = 0;
        const validItems = items.map(item => {
          subtotal += item.total_price;
          return { ...item, location_id: item.location_id };
        });

        const discount_percentage = data.discount_percentage || 0;
        const shipping_fee = Number(data.shipping_fee || 0);
        const total_amount = subtotal * (1 - discount_percentage / 100) + shipping_fee;

        const orderData = {
          customer_id,
          created_by: userId,
          delivery_type: delivery_type || 'delivery',
          address,
          shipping_fee,
          discount_percentage,
          total_amount
        };

        // 1. Create order with pending status
        const header = await this.orderRepo.createOrderWithClient(client, storeId, orderData, 'pending');

        // 2. Insert order details
        for (const vItem of validItems) {
          await this.detailRepo.addDetailWithClient(client, header.id, vItem);
        }

        // 3. Publish order.created via outbox (same transaction — atomic!)
        const inventoryItems = validItems.map(item => ({
          batchId: item.batch_id,
          locationId: item.location_id,
          quantity: item.quantity
        }));

        await outbox.insertEvent(client, 'order.created', {
          orderId: header.id,
          storeId,
          customerId: customer_id,
          totalAmount: total_amount,
          items: inventoryItems
        });

        await client.query('COMMIT');

        const details = await this.detailRepo.findByOrderId(header.id);
        return {
          ...this.formatOrder(header),
          details: details.map(d => this.formatOrderDetail(d))
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw new AppError('Failed to create online order: ' + error.message, 500);
      } finally {
        client.release();
      }
    }

    async updateOrder(storeId, id, data) {
      const order = await this.orderRepo.findById(storeId, id);
      if (!order) throw new NotFoundError('Order not found');

      // Cannot update delivered, cancelled, or refunded orders
      if (['delivered', 'cancelled', 'refunded'].includes(order.status)) {
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
        await client.query('COMMIT');

        if (!updated) throw new AppError('No fields to update', 400);
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

      // Can only hard-delete draft/pending orders with pending payment
      if (!['draft', 'pending'].includes(order.status) || order.payment_status !== 'pending') {
        throw new ValidationError('Can only delete draft or pending orders with pending payment');
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

    async refundOrder(storeId, id, data) {
      const order = await this.orderRepo.findById(storeId, id);
      if (!order) throw new NotFoundError('Order not found');

      if (order.status !== 'delivered' || order.payment_status !== 'paid') {
        throw new ValidationError('Can only refund delivered orders that are fully paid');
      }

      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const updated = await this.orderRepo.updateStatusWithClient(
          client, storeId, id, 'refunded', 'refunded'
        );
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
