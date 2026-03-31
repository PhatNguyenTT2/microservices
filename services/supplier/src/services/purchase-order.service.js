const { ValidationError, NotFoundError, AppError } = require('../../../../shared/common/errors');
const axios = require('axios');

class PurchaseOrderService {
  constructor(poRepo, poDetailRepo, supplierRepo, pool, { inventoryServiceUrl }) {
    this.poRepo = poRepo;
    this.poDetailRepo = poDetailRepo;
    this.supplierRepo = supplierRepo;
    this.inventoryServiceUrl = inventoryServiceUrl;
    this.pool = pool;
  }

  /**
   * Format DB row (snake_case) → frontend-friendly (camelCase)
   */
  formatPO(row) {
    if (!row) return null;
    return {
      id: row.id,
      storeId: row.store_id,
      supplierId: row.supplier_id,
      orderDate: row.order_date,
      receivedDate: row.received_date,
      shippingFee: Number(row.shipping_fee) || 0,
      discountPercentage: Number(row.discount_percentage) || 0,
      totalPrice: Number(row.total_price) || 0,
      status: row.status,
      paymentStatus: row.payment_status,
      createdBy: row.created_by,
      notes: row.notes || '',
      // Populated supplier (if joined)
      supplier: row._supplier || null,
      // Populated details (if joined)
      details: row._details || []
    };
  }

  formatPODetail(row) {
    if (!row) return null;
    return {
      id: row.id,
      poId: row.po_id,
      productId: row.product_id,
      productName: row.product_name,
      batchId: row.batch_id,
      quantity: row.quantity,
      costPrice: Number(row.cost_price) || 0,
      totalPrice: Number(row.total_price) || 0
    };
  }

  /**
   * Populate supplier data into PO row
   */
  async populateSupplier(po) {
    if (!po || !po.supplier_id) return po;
    const supplier = await this.supplierRepo.findById(po.supplier_id);
    if (supplier) {
      po._supplier = {
        id: supplier.id,
        companyName: supplier.company_name,
        phone: supplier.phone || '',
        paymentTerms: supplier.payment_terms || 'cod'
      };
    }
    return po;
  }

  async getStorePurchaseOrders(storeId, filters) {
    const rows = await this.poRepo.findAll(storeId, filters);
    if (rows.length === 0) return [];

    // Supplier data comes from JOIN — no extra queries needed
    return rows.map(row => {
      // Extract supplier from JOINed columns
      if (row.s_id) {
        row._supplier = {
          id: row.s_id,
          companyName: row.s_company_name,
          phone: row.s_phone || '',
          paymentTerms: row.s_payment_terms || 'cod'
        };
      }
      // List view doesn't need details — loaded on demand via getPurchaseOrderById
      row._details = [];
      return this.formatPO(row);
    });
  }

  async getPurchaseOrderById(storeId, poId) {
    const po = await this.poRepo.findById(storeId, poId);
    if (!po) throw new NotFoundError('Purchase Order not found');

    await this.populateSupplier(po);
    const details = await this.poDetailRepo.findByPoId(po.id);
    po._details = details.map(d => this.formatPODetail(d));

    return this.formatPO(po);
  }

  // Zone 1: Giao dịch tạo phiếu nhập nháp
  async createDraftPO(storeId, data, userId) {
    const supplierId = data.supplier_id || data.supplierId;
    const items = data.items || [];

    if (!items || items.length === 0) throw new ValidationError('Purchase Order must contain items');

    const supplier = await this.supplierRepo.findById(supplierId);
    if (!supplier) throw new ValidationError('Supplier does not exist');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      let subtotal = 0;
      const validItems = [];

      for (const item of items) {
        const qty = item.quantity || 1;
        const price = item.cost_price || item.costPrice || 0;
        const lineTotal = qty * price;
        subtotal += lineTotal;
        validItems.push({
          product_id: item.product_id || item.productId,
          product_name: item.product_name || item.productName,
          quantity: qty,
          cost_price: price,
          total_price: lineTotal
        });
      }

      const discount = data.discount_percentage || data.discountPercentage || 0;
      const shipping = Number(data.shipping_fee || data.shippingFee || 0);
      const total_price = subtotal * (1 - discount / 100) + shipping;

      // 1. Insert Header
      const headerData = {
        supplier_id: supplierId,
        created_by: userId,
        shipping_fee: shipping,
        discount_percentage: discount,
        total_price,
        notes: data.notes
      };

      const header = await this.poRepo.createWithClient(client, storeId, headerData);

      // 2. Insert details
      for (const vItem of validItems) {
        await this.poDetailRepo.addDetailWithClient(client, header.id, vItem);
      }

      await client.query('COMMIT');

      // Return formatted PO with details
      const details = await this.poDetailRepo.findByPoId(header.id);
      header._supplier = {
        id: supplier.id,
        companyName: supplier.company_name,
        phone: supplier.phone || '',
        paymentTerms: supplier.payment_terms || 'cod'
      };
      header._details = details.map(d => this.formatPODetail(d));

      return this.formatPO(header);

    } catch (error) {
      await client.query('ROLLBACK');
      throw new AppError('Failed to create purchase order: ' + error.message, 500);
    } finally {
      client.release();
    }
  }

  // Update draft PO (only allowed for draft status)
  async updateDraftPO(storeId, poId, data) {
    const po = await this.poRepo.findById(storeId, poId);
    if (!po) throw new NotFoundError('Purchase Order not found');

    if (po.status !== 'draft') {
      throw new ValidationError('Can only edit draft purchase orders');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Update header fields
      const updates = {};
      if (data.shipping_fee !== undefined || data.shippingFee !== undefined) {
        updates.shipping_fee = data.shipping_fee ?? data.shippingFee;
      }
      if (data.discount_percentage !== undefined || data.discountPercentage !== undefined) {
        updates.discount_percentage = data.discount_percentage ?? data.discountPercentage;
      }
      if (data.notes !== undefined) {
        updates.notes = data.notes;
      }

      // Update supplier if changed
      const newSupplierId = data.supplier_id || data.supplierId;
      if (newSupplierId && newSupplierId !== po.supplier_id) {
        const supplier = await this.supplierRepo.findById(newSupplierId);
        if (!supplier) throw new ValidationError('Supplier does not exist');
        updates.supplier_id = newSupplierId;
      }

      if (Object.keys(updates).length > 0) {
        await this.poRepo.updateWithClient(client, storeId, poId, updates);
      }

      // If items are provided, replace all details
      if (data.items && data.items.length > 0) {
        // Delete existing details
        await client.query('DELETE FROM purchase_order_detail WHERE po_id = $1', [poId]);

        let subtotal = 0;
        for (const item of data.items) {
          const qty = item.quantity || 1;
          const price = item.cost_price || item.costPrice || 0;
          const lineTotal = qty * price;
          subtotal += lineTotal;
          await this.poDetailRepo.addDetailWithClient(client, poId, {
            product_id: item.product_id || item.productId,
            product_name: item.product_name || item.productName,
            quantity: qty,
            cost_price: price,
            total_price: lineTotal
          });
        }

        // Recalculate total
        const discount = updates.discount_percentage ?? po.discount_percentage ?? 0;
        const shipping = Number(updates.shipping_fee ?? po.shipping_fee ?? 0);
        const total_price = subtotal * (1 - discount / 100) + shipping;
        await client.query(
          'UPDATE purchase_order SET total_price = $1 WHERE id = $2 AND store_id = $3',
          [total_price, poId, storeId]
        );
      }

      await client.query('COMMIT');

      return this.getPurchaseOrderById(storeId, poId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new AppError('Failed to update purchase order: ' + error.message, 500);
    } finally {
      client.release();
    }
  }

  // Delete draft PO
  async deleteDraftPO(storeId, poId) {
    const po = await this.poRepo.findById(storeId, poId);
    if (!po) throw new NotFoundError('Purchase Order not found');
    if (po.status !== 'draft') {
      throw new ValidationError('Can only delete draft purchase orders');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Details have ON DELETE CASCADE
      await client.query('DELETE FROM purchase_order WHERE id = $1 AND store_id = $2', [poId, storeId]);
      await client.query('COMMIT');
      return { deleted: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw new AppError('Failed to delete purchase order: ' + error.message, 500);
    } finally {
      client.release();
    }
  }

  // Chuyển trạng thái - approve, received, cancel
  async updateStatus(storeId, poId, status, paymentStatus) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const po = await this.poRepo.findById(storeId, poId);
      if (!po) throw new NotFoundError('Purchase Order not found');

      // Validate status transitions
      if (status === 'approved' && po.status !== 'draft') {
        throw new ValidationError('Can only approve draft purchase orders');
      }
      if (status === 'received' && po.status !== 'approved') {
        throw new ValidationError('Can only receive approved purchase orders');
      }
      if (status === 'cancelled' && !['draft', 'approved'].includes(po.status)) {
        throw new ValidationError('Can only cancel draft or approved purchase orders');
      }

      if (status === 'received' && po.status !== 'received') {
        // TODO: EventBus -> Emit `purchase_order.received` in RabbitMQ
        // Service 6 Inventory will catch this event and receiveStock() automatically.
      }

      const updated = await this.poRepo.updateStatusWithClient(client, storeId, poId, status, paymentStatus);

      // Tự động cộng nợ Supplier nếu trạng thái là approved
      if (status === 'approved' && po.status !== 'approved') {
        await this.supplierRepo.updateDebtWithClient(client, po.supplier_id, updated.total_price);
      }

      await client.query('COMMIT');

      // Return formatted
      await this.populateSupplier(updated);
      const details = await this.poDetailRepo.findByPoId(updated.id);
      updated._details = details.map(d => this.formatPODetail(d));

      return this.formatPO(updated);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof ValidationError || error instanceof NotFoundError) throw error;
      throw new AppError('Update status failed: ' + error.message, 500);
    } finally {
      client.release();
    }
  }
  /**
   * Receive PO — single backend endpoint replacing 4+ frontend service calls
   * 1. Validate PO is approved
   * 2. For each item: Create batch → receiveStock → link batch to PO detail
   * 3. Update PO status to 'received'
   */
  async receivePO(storeId, poId, items, userId, authToken) {
    const po = await this.poRepo.findById(storeId, poId);
    if (!po) throw new NotFoundError('Purchase Order not found');
    if (po.status !== 'approved') {
      throw new ValidationError('Can only receive approved purchase orders');
    }

    // Get supplier name for movement reason
    let supplierName = `Supplier #${po.supplier_id}`;
    try {
      const supplier = await this.supplierRepo.findById(po.supplier_id);
      if (supplier) {
        supplierName = supplier.company_name || supplierName;
      }
    } catch (err) {
      // Fallback to ID if supplier lookup fails
    }

    // Get PO details
    const poDetails = await this.poDetailRepo.findByPoId(poId);
    if (!poDetails || poDetails.length === 0) {
      throw new ValidationError('Purchase Order has no items');
    }

    const client = await this.pool.connect();
    const createdBatches = [];

    try {
      await client.query('BEGIN');

      const headers = authToken
        ? { Authorization: `Bearer ${authToken}` }
        : {};

      for (const item of items) {
        // Find matching PO detail
        const detail = poDetails.find(d =>
          d.id === item.poDetailId || d.id === parseInt(item.poDetailId)
        );
        if (!detail) {
          throw new ValidationError(`PO Detail #${item.poDetailId} not found`);
        }

        // 1. Create batch in inventory service
        const batchResponse = await axios.post(
          `${this.inventoryServiceUrl}/api/batches`,
          {
            product_id: detail.product_id,
            cost_price: detail.cost_price,
            unit_price: detail.cost_price, // Default selling price = cost (updated later)
            quantity: item.quantity,
            mfg_date: item.mfgDate || null,
            expiry_date: item.expiryDate || null,
            notes: item.notes || `Received from PO #${poId}`
          },
          { headers }
        );

        const newBatch = batchResponse.data?.data;
        if (!newBatch) {
          throw new AppError('Failed to create batch in inventory service');
        }
        createdBatches.push(newBatch);

        // 2. Receive stock in inventory (creates inventory item + movement log)
        // ALWAYS call — inventory service handles null location gracefully
        await axios.post(
          `${this.inventoryServiceUrl}/api/inventory/receive`,
          {
            batchId: newBatch.id,
            locationId: item.locationId ? parseInt(item.locationId) : null,
            quantity: item.quantity,
            reason: `PO #${poId} | ${supplierName} | Qty: ${item.quantity}`
          },
          { headers }
        );
        await client.query(
          'UPDATE purchase_order_detail SET batch_id = $1 WHERE id = $2',
          [newBatch.id, detail.id]
        );
      }

      // 4. Update PO status to 'received'
      await this.poRepo.updateStatusWithClient(client, storeId, poId, 'received');

      // Set received_date
      await client.query(
        'UPDATE purchase_order SET received_date = NOW() WHERE id = $1 AND store_id = $2',
        [poId, storeId]
      );

      await client.query('COMMIT');

      // Return formatted PO
      return this.getPurchaseOrderById(storeId, poId);

    } catch (error) {
      await client.query('ROLLBACK');

      // Saga compensation: cleanup batches already created in inventory service
      if (createdBatches.length > 0) {
        const cleanupHeaders = authToken
          ? { Authorization: `Bearer ${authToken}` }
          : {};

        for (const batch of createdBatches) {
          try {
            await axios.delete(
              `${this.inventoryServiceUrl}/api/batches/${batch.id}`,
              { headers: cleanupHeaders }
            );
          } catch (cleanupErr) {
            // Log but don't throw — best-effort cleanup
            console.error(`Failed to cleanup batch ${batch.id}:`, cleanupErr.message);
          }
        }
      }

      if (error instanceof ValidationError || error instanceof NotFoundError) throw error;
      const errData = error.response?.data?.error;
      const msg = typeof errData === 'object' ? (errData.message || JSON.stringify(errData)) : (errData || error.response?.data?.message || error.message);
      throw new AppError('Failed to receive purchase order: ' + msg, 500);
    } finally {
      client.release();
    }
  }

  /**
   * Delete PO — allowed for draft, cancelled, received statuses
   */
  async deletePurchaseOrder(storeId, poId) {
    const po = await this.poRepo.findById(storeId, poId);
    if (!po) throw new NotFoundError('Purchase Order not found');

    const deletableStatuses = ['draft', 'cancelled', 'received'];
    if (!deletableStatuses.includes(po.status)) {
      throw new ValidationError(
        `Cannot delete purchase order with status '${po.status}'. Only ${deletableStatuses.join(', ')} orders can be deleted.`
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Cascade: delete details first
      await client.query('DELETE FROM purchase_order_detail WHERE po_id = $1', [poId]);
      await client.query(
        'DELETE FROM purchase_order WHERE id = $1 AND store_id = $2',
        [poId, storeId]
      );

      await client.query('COMMIT');
      return { deleted: true, id: poId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw new AppError('Delete failed: ' + error.message, 500);
    } finally {
      client.release();
    }
  }
}

module.exports = PurchaseOrderService;
