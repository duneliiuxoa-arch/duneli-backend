// =============================================================
// topicScoreSync.js — Full TopicScore recalculation job
// Scheduled: every 6 hours via scheduler.js
// This is a drift-correction job — SQL triggers handle real-time
// updates, this job corrects any accumulated drift.
// =============================================================
import prisma from '../../middleware/prismaClient.js';

/**
 * Recalculates TopicScore for all topics in a single batched query.
 * Score formula: (voteCount * 3) + (messageCount * 1) + (meetingJoins * 5)
 */
export async function recalculateTopicScores() {
  // Fetch all topic IDs — Topic has no deletedAt, filter by non-CLOSED
  const topics = await prisma.topic.findMany({
    where: { status: { not: 'CLOSED' } },
    select: { id: true },
  });

  if (topics.length === 0) {
    console.log('[topicScoreSync] No active topics to recalculate.');
    return;
  }

  console.log(`[topicScoreSync] Recalculating ${topics.length} topic(s)...`);
  const topicIds = topics.map((t) => t.id);

  // Single batched query — replaces the old N*3 round-trip loop
  const [votes, messages, joins] = await Promise.all([
    prisma.topicVote.groupBy({
      by: ['topicId'],
      where: { topicId: { in: topicIds } },
      _count: { id: true },
    }),
    prisma.chatMessage.groupBy({
      by: ['topicId'],
      where: { topicId: { in: topicIds }, deletedAt: null },
      _count: { id: true },
    }),
    // meetingJoins requires a raw query — Prisma can't group through a join
    prisma.$queryRaw`
      SELECT m."topicId", COUNT(ma.id)::int AS "joinCount"
      FROM meeting_attendees ma
      JOIN meetings m ON ma."meetingId" = m.id
      WHERE m."topicId" = ANY(${topicIds}::text[])
      GROUP BY m."topicId"
    `,
  ]);

  // Index results by topicId for O(1) lookup
  const voteMap = Object.fromEntries(votes.map((v) => [v.topicId, v._count.id]));
  const msgMap = Object.fromEntries(
    messages.filter((m) => m.topicId).map((m) => [m.topicId, m._count.id])
  );
  const joinMap = Object.fromEntries(joins.map((j) => [j.topicId, j.joinCount]));

  // Bulk upsert all scores
  let updated = 0;
  for (const topic of topics) {
    const voteCount  = voteMap[topic.id]  || 0;
    const messageCount = msgMap[topic.id] || 0;
    const meetingJoins = joinMap[topic.id] || 0;
    const score = voteCount * 3 + messageCount + meetingJoins * 5;

    await prisma.topicScore.upsert({
      where: { topicId: topic.id },
      update: { voteCount, messageCount, meetingJoins, score, calculatedAt: new Date() },
      create: { topicId: topic.id, voteCount, messageCount, meetingJoins, score },
    });
    updated++;
  }

  console.log(
    `[topicScoreSync] Done. Updated ${updated} score(s) at ${new Date().toISOString()}`
  );
}
