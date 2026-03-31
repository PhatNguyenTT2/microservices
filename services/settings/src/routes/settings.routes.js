const { verifyToken, requirePermission } = require('../../../../shared/auth-middleware');
const { success, paginated } = require('../../../../shared/common/response');

module.exports = function settingsRoutes(settingsService) {
  const router = require('express').Router();

  // --- Security Settings ---
  router.get('/security', verifyToken, requirePermission('settings.view'), async (req, res, next) => {
    try {
      const result = await settingsService.getSecuritySettings();
      success(res, result);
    } catch (err) { next(err); }
  });

  router.put('/security', verifyToken, requirePermission('settings.edit'), async (req, res, next) => {
    try {
      // Expect change_reason in body
      const { change_reason, ...data } = req.body;
      const result = await settingsService.updateSecuritySettings(data, req.user.id, change_reason);
      success(res, result);
    } catch (err) { next(err); }
  });

  // --- Sales Settings ---
  router.get('/sales', verifyToken, requirePermission('settings.view'), async (req, res, next) => {
    try {
      const result = await settingsService.getSalesSettings();
      success(res, result);
    } catch (err) { next(err); }
  });

  router.put('/sales', verifyToken, requirePermission('settings.edit'), async (req, res, next) => {
    try {
      const { change_reason, ...data } = req.body;
      const result = await settingsService.updateSalesSettings(data, req.user.id, change_reason);
      success(res, result);
    } catch (err) { next(err); }
  });

  // --- Settings History ---
  router.get('/history', verifyToken, requirePermission('settings.view'), async (req, res, next) => {
    try {
      const result = await settingsService.getHistory(req.query);
      paginated(res, { ...result, page: req.query.page || 1, limit: req.query.limit || 20 });
    } catch (err) { next(err); }
  });

  return router;
};
