const { verifyToken } = require('../../../../shared/auth-middleware');

module.exports = function supplierRoutes(supplierService) {
  const router = require('express').Router();

  router.get('/', verifyToken, async (req, res, next) => {
    try {
      const result = await supplierService.list(req.query);
      res.json({
        success: true,
        data: result.items,
        pagination: {
          page: parseInt(req.query.page) || 1,
          limit: parseInt(req.query.limit) || 20,
          total: result.total,
          totalPages: Math.ceil(result.total / (parseInt(req.query.limit) || 20))
        }
      });
    } catch (err) { next(err); }
  });

  router.get('/:id', verifyToken, async (req, res, next) => {
    try {
      const result = await supplierService.getById(parseInt(req.params.id));
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  });

  router.post('/', verifyToken, async (req, res, next) => {
    try {
      const result = await supplierService.create(req.body);
      res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
  });

  router.put('/:id', verifyToken, async (req, res, next) => {
    try {
      const result = await supplierService.update(parseInt(req.params.id), req.body);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  });

  router.delete('/:id', verifyToken, async (req, res, next) => {
    try {
      const result = await supplierService.delete(parseInt(req.params.id));
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  });

  router.get('/:id/debt', verifyToken, async (req, res, next) => {
    try {
      const result = await supplierService.getDebtInfo(parseInt(req.params.id));
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  });

  return router;
};
