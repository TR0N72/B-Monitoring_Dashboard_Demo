const jwt = require('jsonwebtoken');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { JWT_SECRET } = require('./auth');

const posInt = (v, d) => (Number(v) > 0 ? Math.floor(Number(v)) : d);

// Key by verified JWT user ID, falling back to req.ip; raw unverified claims and raw XFF are ignored.
// Note: under Docker Desktop (Windows), anonymous traffic shares 172.18.0.1; authenticated users remain isolated.
function keyGenerator(req) {
  let token = req.cookies?.bmonitor_token;
  const h = req.headers.authorization;
  if (!token && h && h.startsWith('Bearer ')) token = h.slice(7);
  if (token) {
    try {
      const { id } = jwt.verify(token, JWT_SECRET);
      if (id != null) return `u:${id}`;
    } catch { /* token tak valid/kedaluwarsa -> kunci IP */ }
  }
  return `ip:${ipKeyGenerator(req.ip)}`;
}

// In-memory store per process; move to Redis if the backend scales horizontally.
const apiLimiter = rateLimit({
  windowMs: posInt(process.env.RATE_LIMIT_WINDOW_MS, 60000),
  limit: posInt(process.env.RATE_LIMIT_MAX, 300),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  message: { error: 'Terlalu banyak permintaan.' },
});

module.exports = { apiLimiter };
