const { verifyToken } = require('../../../../shared/auth-middleware');
const { success } = require('../../../../shared/common/response');

module.exports = function employeeRoutes(employeeService) {
  const router = require('express').Router();

  // GET /api/employees?search=xxx&isActive=true
  router.get('/', verifyToken, async (req, res, next) => {
    try {
      const callerStoreId = req.user.storeId || null;
      const { search, isActive } = req.query;
      const result = await employeeService.list(callerStoreId, { search, isActive });
      success(res, result);
    } catch (err) { next(err); }
  });

  // GET /api/employees/:id
  router.get('/:id', verifyToken, async (req, res, next) => {
    try {
      const result = await employeeService.getById(parseInt(req.params.id));
      success(res, result);
    } catch (err) { next(err); }
  });

  // POST /api/employees
  router.post('/', verifyToken, async (req, res, next) => {
    try {
      const callerStoreId = req.user.storeId || null;
      const result = await employeeService.create(callerStoreId, req.body);
      success(res, result, 201);
    } catch (err) { next(err); }
  });

  // PUT /api/employees/:id
  router.put('/:id', verifyToken, async (req, res, next) => {
    try {
      const result = await employeeService.update(parseInt(req.params.id), req.body);
      success(res, result);
    } catch (err) { next(err); }
  });

  // DELETE /api/employees/:id
  router.delete('/:id', verifyToken, async (req, res, next) => {
    try {
      const result = await employeeService.delete(parseInt(req.params.id));
      success(res, result);
    } catch (err) { next(err); }
  });

  return router;
};

