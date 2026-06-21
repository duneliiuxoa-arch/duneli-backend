import cron from 'node-cron';
import { purgeExpiredSessions } from './sessionCleanup.js';
import { recalculateTopicScores } from './topicScoreSync.js';
import { autoScheduleTopMeetings } from './autoScheduleMeetings.js';

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

// ─── Auto-schedule top 5 topics: daily at 11:00 PM ──────────────────────────
cron.schedule('0 23 * * *', async () => {
  console.log('[scheduler] Running auto-schedule top meetings...');
  try {
    const result = await autoScheduleTopMeetings();
    console.log(`[scheduler] Auto-schedule done: ${result.scheduled} meetings created.`);
  } catch (err) {
    console.error('[scheduler] Auto-schedule failed:', err);
  }
});

console.log('[scheduler] Background jobs registered.');
console.log('  → Session cleanup   : every Sunday at 02:00 AM');
console.log('  → TopicScore sync   : every 6 hours');
console.log('  → Auto-schedule     : daily at 11:00 PM');
