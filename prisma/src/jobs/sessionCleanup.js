// =============================================================
// sessionCleanup.js — DEPRECATED (Supabase Auth migration)
// Sessions are now managed entirely by Supabase Auth.
// This file is kept as a no-op to avoid breaking the scheduler import.
// The weekly cron in scheduler.js can be removed in a future cleanup.
// =============================================================

/**
 * No-op: session cleanup is now handled by Supabase Auth automatically.
 */
export async function purgeExpiredSessions() {
  console.log('[sessionCleanup] Skipped — sessions managed by Supabase Auth.');
  return 0;
}
