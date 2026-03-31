module.exports = {
  verifyToken: (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: { message: 'No token', code: 'UNAUTHORIZED' } });
    }
    const storeId = req.headers['x-test-store-id'] ? parseInt(req.headers['x-test-store-id']) : 1;
    req.user = { id: 1, username: 'admin', role: 1, permissions: ['order.view', 'order.manage'], storeId };
    next();
  },
  requirePermission: () => (req, res, next) => next(),
  generateToken: jest.fn().mockReturnValue('mock-jwt-token')
};
