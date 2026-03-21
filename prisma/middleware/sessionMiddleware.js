// =============================================================
// sessionMiddleware.js — Hash raw session tokens before storing
// =============================================================
// Usage: when creating a session, pass rawToken in the data.
// This middleware hashes it and stores it as tokenHash.
//
// Example:
//   await prisma.session.create({
//     data: { userId, rawToken: generatedToken, expiresAt }
//   })
//
// The stored tokenHash can then be compared with bcrypt.compare()
// during authentication.
// =============================================================
import bcrypt from 'bcrypt';

export async function hashSessionTokenMiddleware(params, next) {
  if (params.model === 'Session' && params.action === 'create') {
    const rawToken = params.args.data.rawToken;
    if (rawToken) {
      params.args.data.tokenHash = await bcrypt.hash(rawToken, 10);
      delete params.args.data.rawToken; // never persist the raw token
    }
  }
  return next(params);
}
