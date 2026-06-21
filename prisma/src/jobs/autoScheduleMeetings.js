// prisma/src/jobs/autoScheduleMeetings.js
// Every day at 11:00 PM — top 5 voted ACTIVE topics ko next day ke liye schedule karo

import prisma from '../../middleware/prismaClient.js';

const TOP_N          = 5;   // kitne topics schedule karne hain
const MEETING_HOUR   = 12;  // 12:00 PM se start
const MEETING_MINUTE = 0;

export async function autoScheduleTopMeetings() {
  console.log('[autoSchedule] Starting top-5 auto-schedule job...');

  try {
    // ── 1. Top N ACTIVE topics by vote count ─────────────────────────────────
    const topTopics = await prisma.topic.findMany({
      where: {
        status: 'ACTIVE',
        meeting: null, // already scheduled nahi ho
      },
      orderBy: [
        { topicScore: { voteCount: 'desc' } },
        { createdAt: 'asc' },
      ],
      take: TOP_N,
      select: {
        id: true,
        title: true,
        topicScore: { select: { voteCount: true } },
      },
    });

    if (topTopics.length === 0) {
      console.log('[autoSchedule] No eligible ACTIVE topics found.');
      return { scheduled: 0 };
    }

    // ── 2. Next day ki meetings banao (staggered times) ──────────────────────
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(MEETING_HOUR, MEETING_MINUTE, 0, 0);

    const results = [];
    for (let i = 0; i < topTopics.length; i++) {
      const topic = topTopics[i];

      // 12 hours ÷ 5 = 144 min each — equal slots, last ends exactly 12AM
      const meetingTime = new Date(tomorrow.getTime() + i * 144 * 60 * 1000);

      try {
        await prisma.$transaction([
          // Topic status → SELECTED
          prisma.topic.update({
            where: { id: topic.id },
            data:  { status: 'SELECTED' },
          }),
          // Meeting create
          prisma.meeting.create({
            data: {
              topicId:     topic.id,
              meetingDate: meetingTime,
              status:      'SCHEDULED',
            },
          }),
        ]);

        results.push({ id: topic.id, title: topic.title, votes: topic.topicScore?.voteCount ?? 0, scheduledAt: meetingTime });
        console.log(`[autoSchedule] ✅ "${topic.title}" scheduled at ${meetingTime.toISOString()} (${topic.topicScore?.voteCount ?? 0} votes)`);
      } catch (err) {
        console.error(`[autoSchedule] ❌ Failed for topic "${topic.title}":`, err.message);
      }
    }

    console.log(`[autoSchedule] Done — ${results.length}/${topTopics.length} topics scheduled.`);
    return { scheduled: results.length, topics: results };
  } catch (err) {
    console.error('[autoSchedule] Fatal error:', err);
    throw err;
  }
}
