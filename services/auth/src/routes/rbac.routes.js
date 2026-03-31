const { verifyToken } = require('../../../../shared/auth-middleware');
const { success } = require('../../../../shared/common/response');

module.exports = function rbacRoutes(rbacService) {
  const router = require('express').Router();
  // GET /api/roles
  router.get('/roles', verifyToken, async (req, res, next) => {
    try {
      const result = await rbacService.listRoles();
      success(res, result);
    } catch (err) { next(err); }
  });

  // GET /api/roles/:id
  router.get('/roles/:id', verifyToken, async (req, res, next) => {
    try {
      const result = await rbacService.getRoleById(parseInt(req.params.id));
      success(res, result);
    } catch (err) { next(err); }
  });

  // POST /api/roles
  router.post('/roles', verifyToken, async (req, res, next) => {
    try {
      const result = await rbacService.createRole(req.body);
      success(res, result, 201);
    } catch (err) { next(err); }
  });

  // PUT /api/roles/:id
  router.put('/roles/:id', verifyToken, async (req, res, next) => {
    try {
      const result = await rbacService.updateRole(parseInt(req.params.id), req.body);
      success(res, result);
    } catch (err) { next(err); }
  });

  // DELETE /api/roles/:id
  router.delete('/roles/:id', verifyToken, async (req, res, next) => {
    try {
      await rbacService.deleteRole(parseInt(req.params.id));
      success(res, { message: 'Role deleted' });
    } catch (err) { next(err); }
  });

  // GET /api/permissions
  router.get('/permissions', verifyToken, async (req, res, next) => {
    try {
      const result = await rbacService.listPermissions();
      success(res, result);
    } catch (err) { next(err); }
  });

  return router;
};
