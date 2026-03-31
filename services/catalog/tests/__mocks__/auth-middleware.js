module.exports = {
  verifyToken: (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: { message: 'No token', code: 'UNAUTHORIZED' } });
    }
    req.user = { id: 1, username: 'admin', role: 1, permissions: ['catalog.view', 'catalog.manage'], storeId: 1 };
    next();
  },
  requirePermission: () => (req, res, next) => next(),
  generateToken: jest.fn().mockReturnValue('mock-jwt-token')
};
