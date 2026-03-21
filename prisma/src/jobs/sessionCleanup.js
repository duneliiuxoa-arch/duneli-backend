// =============================================================
// sessionCleanup.js — Purge expired sessions
// Scheduled: every Sunday at 02:00 AM via scheduler.js
// =============================================================
import prisma from '../../middleware/prismaClient.js';

/**
 * Purges all sessions whose expiresAt is in the past.
 * Returns the number of deleted sessions.
 */
export async function purgeExpiredSessions() {
  const result = await prisma.session.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });
  console.log(
    `[sessionCleanup] Deleted ${result.count} expired session(s) at ${new Date().toISOString()}`
  );
  return result.count;
}
