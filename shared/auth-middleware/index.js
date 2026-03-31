const jwt = require('jsonwebtoken');
const { UnauthorizedError, ForbiddenError } = require('../common/errors');

const JWT_SECRET = () => process.env.JWT_SECRET || 'dev-secret';

/**
 * Middleware: Verify JWT token from Authorization header.
 * Attaches decoded user to req.user.
 */
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new UnauthorizedError('No token provided'));
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET());
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new UnauthorizedError('Token expired'));
    }
    return next(new UnauthorizedError('Invalid token'));
  }
}

/**
 * Middleware factory: Check if user has required permission.
 * Must be used AFTER verifyToken.
 * @param {string} permissionCode - e.g. 'products.create'
 */
function requirePermission(permissionCode) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    const permissions = req.user.permissions || [];
    if (!permissions.includes(permissionCode)) {
      return next(new ForbiddenError(`Permission required: ${permissionCode}`));
    }

    next();
  };
}

/**
 * Generate a JWT token.
 */
function generateToken(payload, expiresIn) {
  return jwt.sign(payload, JWT_SECRET(), {
    expiresIn: expiresIn || process.env.JWT_EXPIRES_IN || '7d'
  });
}

module.exports = { verifyToken, requirePermission, generateToken };
