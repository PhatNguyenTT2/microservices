const express = require('express');
const { verifyToken } = require('../../../../shared/auth-middleware');

function createStatisticsRouter(statisticsService) {
  const router = express.Router();

  // Helper: extract token from request
  const getToken = (req) => {
    const auth = req.headers.authorization;
    return auth ? auth.split(' ')[1] : null;
  };

  /**
   * GET /api/statistics/dashboard
   * Dashboard overview with period comparison
   */
  router.get('/dashboard', verifyToken, async (req, res, next) => {
    try {
      const { period = 'month' } = req.query;
      const token = getToken(req);
      const data = await statisticsService.getDashboard(token, period);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  });

  /**
   * GET /api/statistics/sales
   * Sales report by product
   */
  router.get('/sales', verifyToken, async (req, res, next) => {
    try {
      const token = getToken(req);
      const data = await statisticsService.getSalesReport(token, req.query);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  });

  /**
   * GET /api/statistics/purchases
   * Purchase report by product
   */
  router.get('/purchases', verifyToken, async (req, res, next) => {
    try {
      const token = getToken(req);
      const data = await statisticsService.getPurchaseReport(token, req.query);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  });

  /**
   * GET /api/statistics/profit
   * Profit analysis — revenue vs costs
   */
  router.get('/profit', verifyToken, async (req, res, next) => {
    try {
      const token = getToken(req);
      const data = await statisticsService.getProfitReport(token, req.query);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  });

  /**
   * GET /api/statistics/inventory
   * Inventory status report
   */
  router.get('/inventory', verifyToken, async (req, res, next) => {
    try {
      const token = getToken(req);
      const data = await statisticsService.getInventoryReport(token, req.query);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  });

  /**
   * GET /api/statistics/employee-sales
   * Sales report grouped by employee
   */
  router.get('/employee-sales', verifyToken, async (req, res, next) => {
    try {
      const token = getToken(req);
      const data = await statisticsService.getEmployeeSalesReport(token, req.query);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  });

  /**
   * GET /api/statistics/customer-sales
   * Sales report grouped by customer
   */
  router.get('/customer-sales', verifyToken, async (req, res, next) => {
    try {
      const token = getToken(req);
      const data = await statisticsService.getCustomerSalesReport(token, req.query);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  });

  return router;
}

module.exports = createStatisticsRouter;
