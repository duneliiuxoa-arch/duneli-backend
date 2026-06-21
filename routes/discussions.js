// =============================================================
// routes/discussions.js — Discussion/Topic routes
// GET  /api/discussions        — Sabhi active topics list
// GET  /api/discussions/:id    — Single topic detail
// POST /api/discussions/complete — Discussion end karo, Post create karo
// =============================================================
import { Router } from 'express';
import prisma from '../prisma/middleware/prismaClient.js';

// ── Dunora webhook — inline (avoids ESM path-with-spaces issue) ──
const DUNORA_URL = process.env.DUNORA_URL || 'http://localhost:3001';
const WEBHOOK_SECRET = process.env.DUNELI_WEBHOOK_SECRET || 'duneli_to_dunora_secret_2026';

async function notifyDunora({ title, content, meetingId, topicId, tags = [] }) {
  try {
    const response = await fetch(`${DUNORA_URL}/api/articles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-duneli-secret': WEBHOOK_SECRET,
      },
      body: JSON.stringify({ title, content, meetingId, topicId, tags, source: 'Duneli Discussion' }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('[dunora-webhook] Failed:', response.status, err);
      return { success: false };
    }
    const data = await response.json();
    console.log('[dunora-webhook] Article created in Dunora:', data.article?.id);
    return { success: true, articleId: data.article?.id };
  } catch (err) {
    console.error('[dunora-webhook] Dunora unreachable:', err.message);
    return { success: false };
  }
}

const router = Router();

function getUserIdFromHeader(req) {
  // ── Admin token bypass ──────────────────────────────────────
  const adminToken = req.headers['x-admin-token'];
  if (adminToken && adminToken === process.env.ADMIN_TOKEN) {
    return 'admin'; // Use 'admin' as userId for admin actions
  }

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  try {
    const token = auth.split(' ')[1];
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString()
    );
    return payload.sub || null;
  } catch {
    return null;
  }
}

// ── POST /api/discussions — Naya topic create karo ───────────
router.post('/', async (req, res) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized — Bearer token required' });
    }

    const { title, description, category, language } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    // User exist karta hai check karo, nahi to create karo
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        name: 'User',
        email: `${userId}@duneli.app`,
      },
    });

    const topic = await prisma.topic.create({
      data: {
        title,
        description: description || null,
        createdById: userId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        createdAt: true,
        createdBy: {
          select: { id: true, name: true, anonymousId: true },
        },
      },
    });

    // TopicScore initialize karo
    await prisma.topicScore.upsert({
      where: { topicId: topic.id },
      update: {},
      create: { topicId: topic.id, score: 0, voteCount: 0, messageCount: 0, meetingJoins: 0 },
    });

    res.status(201).json({ topic });
  } catch (err) {
    console.error('[discussions] POST / error:', err);
    res.status(500).json({ error: 'Failed to create topic', detail: err.message });
  }
});

// ── GET /api/discussions ──────────────────────────────────────
// Public — no auth needed, guests bhi dekh sakte hain
router.get('/', async (req, res) => {
  try {
    const { status = 'ACTIVE', limit = 20, offset = 0 } = req.query;
    const userId = getUserIdFromHeader(req); // null for guests

    const VALID_STATUSES = ['ACTIVE', 'CLOSED', 'SELECTED'];
    const statusFilter = status.toUpperCase();
    // status=ALL (ya koi bhi non-whitelisted value) — sab topics, koi status filter nahi
    const whereClause = statusFilter === 'ALL'
      ? {}
      : VALID_STATUSES.includes(statusFilter)
        ? { status: statusFilter }
        : { status: 'ACTIVE' };

    const topics = await prisma.topic.findMany({
      where: whereClause,
      orderBy: [
        { topicScore: { score: 'desc' } },
        { createdAt: 'desc' },
      ],
      take: Math.min(Number(limit), 50),
      skip: Number(offset),
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        createdAt: true,
        createdBy: {
          select: { id: true, name: true, anonymousId: true, avatarUrl: true },
        },
        topicScore: {
          select: { score: true, voteCount: true, messageCount: true, meetingJoins: true },
        },
        meeting: {
          select: {
            id: true,
            meetingDate: true,
            status: true,
            _count: { select: { attendees: true } },
          },
        },
        _count: {
          select: { votes: true, chatMessages: true },
        },
      },
    });

    // If logged in, check which topics user has voted on
    let userVotedTopicIds = new Set();
    if (userId) {
      const userVotes = await prisma.topicVote.findMany({
        where: { userId, topicId: { in: topics.map(t => t.id) } },
        select: { topicId: true },
      });
      userVotedTopicIds = new Set(userVotes.map(v => v.topicId));
    }

    const topicsWithVote = topics.map(t => ({
      ...t,
      hasUserVoted: userVotedTopicIds.has(t.id),
      voteCount: t.topicScore?.voteCount ?? t._count.votes,
    }));

    const total = await prisma.topic.count({ where: whereClause });

    res.json({ topics: topicsWithVote, total, limit: Number(limit), offset: Number(offset) });
  } catch (err) {
    console.error('[discussions] GET / error:', err);
    res.status(500).json({ error: 'Failed to fetch discussions', detail: err.message });
  }
});

// ── GET /api/discussions/:id ──────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const topic = await prisma.topic.findUnique({
      where: { id: req.params.id },
      include: {
        createdBy: {
          select: { id: true, name: true, anonymousId: true, avatarUrl: true },
        },
        topicScore: true,
        meeting: {
          select: {
            id: true,
            meetingDate: true,
            status: true,
            _count: { select: { attendees: true } },
          },
        },
        _count: {
          select: { votes: true, chatMessages: true },
        },
      },
    });

    if (!topic) {
      return res.status(404).json({ error: 'Discussion not found' });
    }

    res.json({ topic });
  } catch (err) {
    console.error('[discussions] GET /:id error:', err);
    res.status(500).json({ error: 'Failed to fetch discussion', detail: err.message });
  }
});

// ── POST /api/discussions/transcript — Save audio transcript segment ──
router.post('/transcript', async (req, res) => {
  try {
    const { meetingId, userId, speaker, text, timestamp } = req.body;
    if (!meetingId || !text) return res.status(400).json({ error: 'meetingId and text required' });

    // ChatMessage ke roop mein save karo with type TRANSCRIPT
    await prisma.chatMessage.create({
      data: {
        meetingId,
        userId: userId || null,
        message: `[TRANSCRIPT] [${speaker || 'Speaker'}]: ${text}`,
        type: 'SYSTEM',
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[discussions] POST /transcript error:', err);
    res.status(500).json({ error: 'Failed to save transcript', detail: err.message });
  }
});

// ── POST /api/discussions/test-webhook — Sirf Dunora connection test ──
// Development only — production mein remove karo
router.post('/test-webhook', async (req, res) => {
  const { title = 'Test Discussion', content = 'Test content from Duneli.' } = req.body;
  const result = await notifyDunora({
    title,
    content,
    meetingId: 'test-' + Date.now(),
    topicId: 'test-topic',
    tags: ['test'],
  });
  res.json({ webhookResult: result });
});

// ── POST /api/discussions/complete ───────────────────────────
// Jab meeting end ho — topic CLOSED karo, Post create karo
// Body: { meetingId, title, content }
router.post('/complete', async (req, res) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized — Bearer token required' });
    }

    const { meetingId, title, content } = req.body;

    if (!meetingId || !title || !content) {
      return res.status(400).json({
        error: 'meetingId, title, and content are required',
      });
    }

    // Meeting exist karti hai check karo
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { topic: true },
    });

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    // ── If already COMPLETED, still allow post creation ────────
    // (Admin ne pehle "End Meeting" kiya, ab "Publish Post" kar raha hai)
    const alreadyCompleted = meeting.status === 'COMPLETED';

    // Check: kya is meeting ka post already exist karta hai?
    const existingPost = await prisma.post.findFirst({
      where: { meetingId },
    });
    if (existingPost) {
      return res.status(409).json({ error: 'Post already published for this meeting', postId: existingPost.id });
    }

    // Transaction mein sab ek saath karo
    const result = await prisma.$transaction(async (tx) => {
      // 1. Meeting COMPLETED mark karo (agar pehle se nahi hai to)
      const updatedMeeting = alreadyCompleted
        ? meeting
        : await tx.meeting.update({
            where: { id: meetingId },
            data: { status: 'COMPLETED' },
          });

      // 2. Topic CLOSED mark karo
      await tx.topic.update({
        where: { id: meeting.topicId },
        data: { status: 'CLOSED' },
      });

      // 3. Post create karo (meeting ka summary)
      const post = await tx.post.create({
        data: {
          meetingId,
          title,
          content,
        },
      });

      // 4. AuditLog entry (admin action ke liye userId skip karo)
      if (userId !== 'admin') {
        await tx.auditLog.create({
          data: {
            userId,
            action: 'DISCUSSION_COMPLETED',
            resource: 'meeting',
            resourceId: meetingId,
            details: { topicId: meeting.topicId, postId: post.id },
          },
        });
      }

      return { meeting: updatedMeeting, post };
    });

    res.json({
      message: 'Discussion completed successfully',
      meetingId: result.meeting.id,
      postId: result.post.id,
    });

    // ── Dunora ko notify karo (async, non-blocking) ──────────
    // res already sent — agar ye fail ho to user affect nahi hoga
    notifyDunora({
      title,
      content,
      meetingId,
      topicId: meeting.topicId,
      tags: [],
    }).catch(err => console.error('[discussions] Dunora notify failed:', err));

  } catch (err) {
    console.error('[discussions] POST /complete error:', err);
    res.status(500).json({ error: 'Failed to complete discussion', detail: err.message });
  }
});

// ── POST /api/discussions/:id/vote ───────────────────────────
// Toggle vote (show interest / remove interest). Auth required.
router.post('/:id/vote', async (req, res) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized — Bearer token required' });
    }

    const topicId = req.params.id;

    const topic = await prisma.topic.findUnique({ where: { id: topicId } });
    if (!topic) return res.status(404).json({ error: 'Topic not found' });

    // Ensure user row exists
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId, name: 'User', email: `${userId}@duneli.app` },
    });

    const existing = await prisma.topicVote.findUnique({
      where: { topicId_userId: { topicId, userId } },
    });

    if (existing) {
      // Unvote
      await prisma.topicVote.delete({ where: { id: existing.id } });
      await prisma.topicScore.upsert({
        where: { topicId },
        update: { voteCount: { decrement: 1 }, score: { decrement: 1 } },
        create: { topicId, voteCount: 0, score: 0 },
      });
      return res.json({ voted: false });
    } else {
      // Vote
      await prisma.topicVote.create({ data: { topicId, userId } });
      const score = await prisma.topicScore.upsert({
        where: { topicId },
        update: { voteCount: { increment: 1 }, score: { increment: 1 } },
        create: { topicId, voteCount: 1, score: 1 },
      });
      return res.json({ voted: true, voteCount: score.voteCount });
    }
  } catch (err) {
    console.error('[discussions] POST /:id/vote error:', err);
    res.status(500).json({ error: 'Failed to vote', detail: err.message });
  }
});

// ── GET /api/discussions/:id/messages — Fetch chat messages ──
router.get('/:id/messages', async (req, res) => {
  const userId = getUserIdFromHeader(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { id } = req.params;
    const limit  = Math.min(parseInt(req.query.limit  || '60'), 100);
    const before = req.query.before; // cursor: createdAt ISO string

    // id can be topicId or meetingId
    const [byTopic, byMeeting] = await Promise.all([
      prisma.chatMessage.count({ where: { topicId: id, deletedAt: null } }),
      prisma.chatMessage.count({ where: { meetingId: id, deletedAt: null } }),
    ]);
    const field = byTopic >= byMeeting ? 'topicId' : 'meetingId';

    const messages = await prisma.chatMessage.findMany({
      where: {
        [field]:    id,
        deletedAt:  null,
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: {
        id: true, message: true, createdAt: true,
        user: { select: { id: true, name: true, anonymousId: true } },
      },
    });

    res.json({ messages, field });
  } catch (err) {
    console.error('[discussions] GET /:id/messages error:', err);
    res.status(500).json({ error: 'Failed to fetch messages', detail: err.message });
  }
});

// ── POST /api/discussions/:id/messages — Send a chat message ─
router.post('/:id/messages', async (req, res) => {
  const userId = getUserIdFromHeader(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { message } = req.body;
  if (!message?.trim())        return res.status(400).json({ error: 'message is required' });
  if (message.length > 500)    return res.status(400).json({ error: 'message too long (max 500 chars)' });

  try {
    const { id } = req.params;

    // Resolve whether id is topicId or meetingId
    const [topic, meeting] = await Promise.all([
      prisma.topic.findUnique({ where: { id }, select: { id: true } }),
      prisma.meeting.findUnique({ where: { id }, select: { id: true, topicId: true } }),
    ]);

    const data = {
      userId,
      message: message.trim(),
      ...(topic   ? { topicId: id }                                    : {}),
      ...(meeting ? { meetingId: id, topicId: meeting.topicId }        : {}),
    };

    if (!data.topicId && !data.meetingId)
      return res.status(404).json({ error: 'Discussion not found' });

    const created = await prisma.chatMessage.create({
      data,
      select: {
        id: true, message: true, createdAt: true,
        user: { select: { id: true, name: true, anonymousId: true } },
      },
    });

    // Update messageCount in TopicScore
    const topicIdForScore = data.topicId;
    if (topicIdForScore) {
      prisma.topicScore.upsert({
        where:  { topicId: topicIdForScore },
        update: { messageCount: { increment: 1 } },
        create: { topicId: topicIdForScore, messageCount: 1 },
      }).catch(() => {});
    }

    res.status(201).json({ message: created });
  } catch (err) {
    console.error('[discussions] POST /:id/messages error:', err);
    res.status(500).json({ error: 'Failed to send message', detail: err.message });
  }
});

// ── POST /api/discussions/:id/join — Join a meeting (record attendee) ─
router.post('/:id/join', async (req, res) => {
  const userId = getUserIdFromHeader(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const topic = await prisma.topic.findUnique({
      where: { id: req.params.id },
      include: { meeting: true },
    });

    if (!topic)         return res.status(404).json({ error: 'Topic not found' });
    if (!topic.meeting) return res.status(404).json({ error: 'No meeting found for this topic' });

    const meetingId = topic.meeting.id;

    // Upsert — if already joined, just update joinedAt; leftAt stays as-is
    const attendee = await prisma.meetingAttendee.upsert({
      where:  { unique_meeting_attendee: { meetingId, userId } },
      update: { joinedAt: new Date(), leftAt: null },
      create: { meetingId, userId },
    });

    res.json({ success: true, meetingId, attendee });
  } catch (err) {
    console.error('[discussions] POST /:id/join error:', err);
    res.status(500).json({ error: 'Failed to join meeting', detail: err.message });
  }
});

// ── POST /api/discussions/:id/leave — Leave a meeting ─────────
router.post('/:id/leave', async (req, res) => {
  const userId = getUserIdFromHeader(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const topic = await prisma.topic.findUnique({
      where: { id: req.params.id },
      include: { meeting: true },
    });

    if (!topic)         return res.status(404).json({ error: 'Topic not found' });
    if (!topic.meeting) return res.status(404).json({ error: 'No meeting found for this topic' });

    const meetingId = topic.meeting.id;

    await prisma.meetingAttendee.updateMany({
      where:  { meetingId, userId, leftAt: null },
      data:   { leftAt: new Date() },
    });

    res.json({ success: true, meetingId });
  } catch (err) {
    console.error('[discussions] POST /:id/leave error:', err);
    res.status(500).json({ error: 'Failed to leave meeting', detail: err.message });
  }
});

export default router;


