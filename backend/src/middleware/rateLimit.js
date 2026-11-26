const jwt = require('jsonwebtoken');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { JWT_SECRET } = require('./auth');

const posInt = (v, d) => (Number(v) > 0 ? Math.floor(Number(v)) : d);

// Kunci per user (JWT terverifikasi), selain itu per IP. Klaim token tak terverifikasi & XFF mentah tak pernah dipercaya.
// ponytail: di Docker Desktop (Windows) semua trafik anonim = satu bucket (172.18.0.1) karena IP asli hilang sebelum nginx;
// user login tetap terisolasi. Host Linux yang menjaga source IP + TRUST_PROXY memberi bucket per-IP sungguhan.
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

// ponytail: store in-memory per proses, pindah ke Redis bila backend diskalakan.
const apiLimiter = rateLimit({
  windowMs: posInt(process.env.RATE_LIMIT_WINDOW_MS, 60000),
  limit: posInt(process.env.RATE_LIMIT_MAX, 300),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  message: { error: 'Terlalu banyak permintaan.' },
});

module.exports = { apiLimiter };
