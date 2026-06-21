// =============================================================
// prisma/middleware/adminAuth.js — Admin token verification
// =============================================================

export function requireAdminToken(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized — invalid admin token' });
  }
  next();
}
