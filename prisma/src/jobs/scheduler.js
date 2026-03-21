import cron from 'node-cron';
import { purgeExpiredSessions } from './sessionCleanup.js';
import { recalculateTopicScores } from './topicScoreSync.js';

/**
 * Duneli Background Job Scheduler
 *
 * Jobs:
 *  - Session cleanup   → every Sunday at 02:00 AM
 *  - TopicScore sync   → every 6 hours
 *
 * Usage:
 *   import './prisma/src/jobs/scheduler.js'   // in your main server entry
 *   Or run standalone: node prisma/src/jobs/scheduler.js
 */

// ─── Session cleanup: weekly, Sunday 02:00 AM ───────────────────────────────
cron.schedule('0 2 * * 0', async () => {
  console.log('[scheduler] Running weekly session cleanup...');
  try {
    await purgeExpiredSessions();
  } catch (err) {
    console.error('[scheduler] Session cleanup failed:', err);
  }
});

// ─── TopicScore sync: every 6 hours ─────────────────────────────────────────
cron.schedule('0 */6 * * *', async () => {
  console.log('[scheduler] Running TopicScore recalculation...');
  try {
    await recalculateTopicScores();
  } catch (err) {
    console.error('[scheduler] TopicScore sync failed:', err);
  }
});

console.log('[scheduler] Background jobs registered.');
console.log('  → Session cleanup : every Sunday at 02:00 AM');
console.log('  → TopicScore sync  : every 6 hours');
