const rateLimit = require('express-rate-limit');
const { verifyToken } = require('../../../../shared/auth-middleware');
const { success } = require('../../../../shared/common/response');

const isTest = process.env.NODE_ENV === 'test';

function createLimiter(options) {
  if (isTest) return (req, res, next) => next();
  return rateLimit(options);
}

const loginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many login attempts. Try again in 15 minutes.', code: 'RATE_LIMITED' } }
});

const registerLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many registration attempts. Try again later.', code: 'RATE_LIMITED' } }
});

module.exports = function authRoutes(authService) {
  const router = require('express').Router();

  router.post('/login', loginLimiter, async (req, res, next) => {
    try {
      const result = await authService.login(req.body);
      success(res, result);
    } catch (err) { next(err); }
  });

  // Trial Registration (Public) — creates Chain Owner + Store in one shot
  router.post('/register-trial', registerLimiter, async (req, res, next) => {
    try {
      const result = await authService.registerTrial(req.body);
      success(res, result, 201);
    } catch (err) { next(err); }
  });

  // Customer Self-Registration (Public) — for online web store
  router.post('/register-customer', registerLimiter, async (req, res, next) => {
    try {
      const result = await authService.registerCustomer(req.body);
      success(res, result, 201);
    } catch (err) { next(err); }
  });

  router.post('/logout', verifyToken, async (req, res, next) => {
    try {
      const token = req.headers.authorization.split(' ')[1];
      await authService.logout(token);
      success(res, { message: 'Logged out successfully' });
    } catch (err) { next(err); }
  });

  router.get('/me', verifyToken, async (req, res, next) => {
    try {
      const result = await authService.getMe(req.user.id);
      success(res, result);
    } catch (err) { next(err); }
  });

  router.post('/pos/login', loginLimiter, async (req, res, next) => {
    try {
      const result = await authService.posLogin(req.body);
      success(res, result);
    } catch (err) { next(err); }
  });

  router.post('/pos/logout', verifyToken, async (req, res, next) => {
    try {
      const token = req.headers.authorization.split(' ')[1];
      await authService.logout(token);
      success(res, { message: 'POS logged out successfully' });
    } catch (err) { next(err); }
  });

  // POS Session Verify — returns employee-shaped response for POS frontend
  router.get('/pos/verify', verifyToken, async (req, res, next) => {
    try {
      const result = await authService.getMe(req.user.id);
      // Shape response as "employee" to match POS frontend expectation
      success(res, {
        employee: {
          id: result.id,
          username: result.username,
          fullName: result.fullName,
          phone: result.phone,
          role: result.role,
          storeId: result.storeId,
          permissions: result.permissions
        }
      });
    } catch (err) { next(err); }
  });

  return router;
};
