const { verifyToken } = require('../../../../shared/auth-middleware');

module.exports = function customerRoutes(customerService) {
  const router = require('express').Router();

  // GET /api/customers
  router.get('/', verifyToken, async (req, res, next) => {
    try {
      const result = await customerService.list(req.query);
      res.json({
        success: true,
        data: result
      });
    } catch (err) { next(err); }
  });

  // GET /api/customers/:id
  router.get('/:id', verifyToken, async (req, res, next) => {
    try {
      const result = await customerService.getById(parseInt(req.params.id));
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  });

  // POST /api/customers
  router.post('/', verifyToken, async (req, res, next) => {
    try {
      const result = await customerService.create(req.body);
      res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
  });

  // PUT /api/customers/:id
  router.put('/:id', verifyToken, async (req, res, next) => {
    try {
      const result = await customerService.update(parseInt(req.params.id), req.body);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  });

  // PATCH /api/customers/:id/toggle-active
  router.patch('/:id/toggle-active', verifyToken, async (req, res, next) => {
    try {
      const { isActive } = req.body;
      const result = await customerService.toggleActive(parseInt(req.params.id), isActive);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  });

  // DELETE /api/customers/:id (soft delete)
  router.delete('/:id', verifyToken, async (req, res, next) => {
    try {
      const result = await customerService.delete(parseInt(req.params.id));
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  });

  return router;
};
