const { verifyToken, requirePermission } = require('../../../../shared/auth-middleware');
const { success, paginated } = require('../../../../shared/common/response');

module.exports = function settingsRoutes(settingsService) {
  const router = require('express').Router();

  // --- Security Settings ---
  router.get('/security', verifyToken, requirePermission('manage_settings'), async (req, res, next) => {
    try {
      const result = await settingsService.getSecuritySettings();
      success(res, result);
    } catch (err) { next(err); }
  });

  router.put('/security', verifyToken, requirePermission('manage_settings'), async (req, res, next) => {
    try {
      // Expect change_reason in body
      const { change_reason, ...data } = req.body;
      const result = await settingsService.updateSecuritySettings(data, req.user.id, change_reason);
      success(res, result);
    } catch (err) { next(err); }
  });

  // --- Sales Settings ---
  router.get('/sales', verifyToken, requirePermission('manage_settings'), async (req, res, next) => {
    try {
      const result = await settingsService.getSalesSettings();
      success(res, result);
    } catch (err) { next(err); }
  });

  router.put('/sales', verifyToken, requirePermission('manage_settings'), async (req, res, next) => {
    try {
      const { change_reason, ...data } = req.body;
      const result = await settingsService.updateSalesSettings(data, req.user.id, change_reason);
      success(res, result);
    } catch (err) { next(err); }
  });

  // --- Settings History ---
  router.get('/history', verifyToken, requirePermission('manage_settings'), async (req, res, next) => {
    try {
      const result = await settingsService.getHistory(req.query);
      paginated(res, { ...result, page: req.query.page || 1, limit: req.query.limit || 20 });
    } catch (err) { next(err); }
  });

  // --- Fresh Product Promotion (cross-service trigger) ---
  const eventBus = require('../../../../shared/event-bus');
  const EVENT = require('../../../../shared/event-bus/eventTypes');
  const crypto = require('crypto');

  // In-memory cache for promotion request statuses
  const promotionRequests = new Map();

  // Subscribe to promotion results
  eventBus.subscribe('settings-service', EVENT.PROMOTION_APPLIED, async (message) => {
    const { requestId, ...result } = message.data;
    if (requestId) {
      promotionRequests.set(requestId, {
        status: 'completed',
        result,
        completedAt: new Date().toISOString()
      });
      // Auto-cleanup after 10 minutes
      setTimeout(() => promotionRequests.delete(requestId), 10 * 60 * 1000);
    }
  }).catch(() => {});  // Non-blocking — subscription happens async

  // POST /fresh-promotion/run — trigger promotion via event
  router.post('/fresh-promotion/run', verifyToken, requirePermission('manage_settings'), async (req, res, next) => {
    try {
      const requestId = crypto.randomUUID();
      const salesSettings = await settingsService.getSalesSettings();

      // Store pending request
      promotionRequests.set(requestId, {
        status: 'pending',
        triggeredAt: new Date().toISOString(),
        triggeredBy: req.user.id
      });

      // Publish event for Inventory to process
      await eventBus.publish(EVENT.PROMOTION_RUN_REQUESTED, {
        requestId,
        config: salesSettings
      });

      success(res, { requestId, status: 'pending' });
    } catch (err) { next(err); }
  });

  // GET /fresh-promotion/status/:requestId — poll for result
  router.get('/fresh-promotion/status/:requestId', verifyToken, requirePermission('manage_settings'), async (req, res, next) => {
    try {
      const { requestId } = req.params;
      const entry = promotionRequests.get(requestId);

      if (!entry) {
        return success(res, { requestId, status: 'not_found' });
      }

      success(res, { requestId, ...entry });
    } catch (err) { next(err); }
  });

  return router;
};
