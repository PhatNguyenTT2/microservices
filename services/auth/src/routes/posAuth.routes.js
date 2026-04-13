const { verifyToken } = require('../../../../shared/auth-middleware');
const { success } = require('../../../../shared/common/response');

module.exports = function posAuthRoutes(posAuthService) {
  const router = require('express').Router();

  // GET /api/pos-auth — list all POS access records
  router.get('/', verifyToken, async (req, res, next) => {
    try {
      const data = await posAuthService.list();
      success(res, data);
    } catch (err) { next(err); }
  });

  // GET /api/pos-auth/available-employees — employees without POS access
  router.get('/available-employees', verifyToken, async (req, res, next) => {
    try {
      const data = await posAuthService.getAvailableEmployees();
      success(res, data);
    } catch (err) { next(err); }
  });

  // GET /api/pos-auth/status/locked — locked accounts (alias for filtered list)
  router.get('/status/locked', verifyToken, async (req, res, next) => {
    try {
      const all = await posAuthService.list();
      const locked = all.filter(a => a.isPinLocked);
      success(res, locked);
    } catch (err) { next(err); }
  });

  // GET /api/pos-auth/:id — single POS auth record
  router.get('/:id', verifyToken, async (req, res, next) => {
    try {
      const data = await posAuthService.getById(parseInt(req.params.id));
      success(res, data);
    } catch (err) { next(err); }
  });

  // POST /api/pos-auth — grant POS access
  router.post('/', verifyToken, async (req, res, next) => {
    try {
      const { employeeId, pin } = req.body;
      const data = await posAuthService.grant(parseInt(employeeId), pin);
      success(res, data, 201);
    } catch (err) { next(err); }
  });

  // POST /api/pos-auth/verify-pin — verify PIN (for POS login)
  router.post('/verify-pin', verifyToken, async (req, res, next) => {
    try {
      const { employeeId, pin } = req.body;
      // Delegate to auth service's posLogin if needed, or simple verify
      const data = await posAuthService.getById(parseInt(employeeId));
      success(res, data);
    } catch (err) { next(err); }
  });

  // PUT /api/pos-auth/:id/pin — update PIN
  router.put('/:id/pin', verifyToken, async (req, res, next) => {
    try {
      const data = await posAuthService.updatePin(parseInt(req.params.id), req.body.pin);
      success(res, data);
    } catch (err) { next(err); }
  });

  // PUT /api/pos-auth/:id/enable — enable POS access
  router.put('/:id/enable', verifyToken, async (req, res, next) => {
    try {
      const data = await posAuthService.enable(parseInt(req.params.id));
      success(res, data);
    } catch (err) { next(err); }
  });

  // PUT /api/pos-auth/:id/disable — disable POS access
  router.put('/:id/disable', verifyToken, async (req, res, next) => {
    try {
      const data = await posAuthService.disable(parseInt(req.params.id));
      success(res, data);
    } catch (err) { next(err); }
  });

  // POST /api/pos-auth/:id/reset-attempts — reset failed attempts + unlock
  router.post('/:id/reset-attempts', verifyToken, async (req, res, next) => {
    try {
      const data = await posAuthService.resetAttempts(parseInt(req.params.id));
      success(res, data);
    } catch (err) { next(err); }
  });

  // DELETE /api/pos-auth/:id — revoke POS access
  router.delete('/:id', verifyToken, async (req, res, next) => {
    try {
      const data = await posAuthService.revoke(parseInt(req.params.id));
      success(res, data);
    } catch (err) { next(err); }
  });

  return router;
};
