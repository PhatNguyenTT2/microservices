const express = require('express');
const { verifyToken } = require('../../../../shared/auth-middleware');

function createBatchRouter(batchRepo) {
  const router = express.Router();

  // Create a new product batch
  router.post('/', verifyToken, async (req, res, next) => {
    try {
      const storeId = req.user ? req.user.storeId : 1;
      const { product_id, cost_price, unit_price, quantity, mfg_date, expiry_date, notes } = req.body;

      if (!product_id || !quantity) {
        return res.status(400).json({
          success: false,
          error: 'product_id and quantity are required'
        });
      }

      const batch = await batchRepo.create(storeId, {
        product_id,
        cost_price: cost_price || 0,
        unit_price: unit_price || cost_price || 0,
        quantity,
        mfg_date: mfg_date || null,
        expiry_date: expiry_date || null,
        notes: notes || null
      });

      res.status(201).json({
        success: true,
        data: batch
      });
    } catch (error) {
      next(error);
    }
  });

  // Get batches by storeId + optional filters
  router.get('/', verifyToken, async (req, res, next) => {
    try {
      const storeId = req.user ? req.user.storeId : 1;
      const filters = {
        productId: req.query.productId,
        status: req.query.status
      };

      const batches = await batchRepo.findAll(storeId, filters);
      res.json({
        success: true,
        data: batches
      });
    } catch (error) {
      next(error);
    }
  });

  // Get single batch by ID (includes serverTime for expiry validation)
  router.get('/:id', verifyToken, async (req, res, next) => {
    try {
      const storeId = req.user ? req.user.storeId : 1;
      const batchId = parseInt(req.params.id);

      const batch = await batchRepo.findById(storeId, batchId);
      if (!batch) {
        return res.status(404).json({ success: false, error: 'Batch not found' });
      }

      res.json({
        success: true,
        data: { ...batch, serverTime: new Date().toISOString() }
      });
    } catch (error) {
      next(error);
    }
  });

  // Saga compensation: delete orphaned batch (CASCADE cleans inventory_item + movement)
  router.delete('/:id', verifyToken, async (req, res, next) => {
    try {
      const storeId = req.user ? req.user.storeId : 1;
      const batchId = parseInt(req.params.id);

      const deleted = await batchRepo.deleteById(storeId, batchId);
      if (!deleted) {
        return res.status(404).json({ success: false, error: 'Batch not found' });
      }

      res.json({ success: true, data: deleted });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = createBatchRouter;
