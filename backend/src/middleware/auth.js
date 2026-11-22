const jwt = require('jsonwebtoken');
const { isRevoked } = require('../services/tokenBlacklist');
const { resolveUser } = require('../services/userGuard');
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'test' ? 'bmonitor_dev_secret' : null);
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required.');
async function authenticate(req, res, next) {
  // Read from HttpOnly cookie (primary) or Authorization header (fallback)
  let token = req.cookies?.bmonitor_token;
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
  }
  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }
  if (isRevoked(token)) {
    return res.status(401).json({ error: 'Token revoked. Please login again.' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await resolveUser(decoded);
    if (!user) return res.status(401).json({ error: 'Account changed or removed. Please login again.' });
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired. Please login again.' });
    }
    return res.status(403).json({ error: 'Invalid token.' });
  }
}
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions.' });
    }
    next();
  };
}
module.exports = { authenticate, authorize, JWT_SECRET };