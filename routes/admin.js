// =============================================================
// routes/admin.js — Full Admin API
// All routes protected by x-admin-token header
// =============================================================
import { Router } from 'express';
import prisma from '../prisma/middleware/prismaClient.js';
import { requireAdminToken } from '../prisma/middleware/adminAuth.js';

const router = Router();
router.use(requireAdminToken);

// ── GET /api/admin/health ─────────────────────────────────────
router.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected', ts: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// ── GET /api/admin/stats — Dashboard KPIs ────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [
      totalUsers, totalTopics, totalMeetings,
      activeTopics, scheduledMeetings, completedMeetings,
      totalVotes, totalMessages,
    ] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.topic.count(),
      prisma.meeting.count(),
      prisma.topic.count({ where: { status: 'ACTIVE' } }),
      prisma.meeting.count({ where: { status: 'SCHEDULED' } }),
      prisma.meeting.count({ where: { status: 'COMPLETED' } }),
      prisma.topicVote.count(),
      prisma.chatMessage.count({ where: { deletedAt: null } }),
    ]);

    res.json({
      totalUsers, totalTopics, totalMeetings,
      activeTopics, scheduledMeetings, completedMeetings,
      totalVotes, totalMessages,
    });
  } catch (err) {
    console.error('[admin] GET /stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats', detail: err.message });
  }
});

// ── GET /api/admin/users — All users ─────────────────────────
router.get('/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, email: true, avatarUrl: true,
        anonymousId: true, role: true, isActive: true,
        createdAt: true, updatedAt: true,
        _count: {
          select: {
            topics: true,
            topicVotes: true,
            meetingAttendees: true,
            chatMessages: true,
          },
        },
      },
    });

    // Map to admin panel shape
    const mapped = users.map(u => ({
      id:               u.id,
      anonymousId:      u.anonymousId || `DNL-${u.id.slice(0,4).toUpperCase()}`,
      email:            maskEmail(u.email),
      provider:         'google',
      role:             u.role,
      isActive:         u.isActive,
      isBanned:         !u.isActive,
      isGuest:          false,
      topics:           u._count.topics,
      meetings:         u._count.meetingAttendees,
      joined:           formatDate(u.createdAt),
      lastSeen:         timeAgo(u.updatedAt),
      color:            randomColor(u.id),
      country:          'India',
      preferredLanguage:'English',
      preferredEngagement: 'listener',
      interestCount:    u._count.topicVotes,
      flagCount:        0,
      isSuspect:        false,
      savedTopics:      0,
      supportedTopics:  u._count.topicVotes,
      listenerCount:    u._count.meetingAttendees,
      speakerCount:     0,
      debaterCount:     0,
      feedbackHistory:  [],
    }));

    res.json(mapped);
  } catch (err) {
    console.error('[admin] GET /users error:', err);
    res.status(500).json({ error: 'Failed to fetch users', detail: err.message });
  }
});

// ── PATCH /api/admin/users/:id/ban ───────────────────────────
router.patch('/users/:id/ban', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: !user.isActive },
      select: { id: true, isActive: true },
    });

    await logAudit(req.params.id, updated.isActive ? 'UNBAN_USER' : 'BAN_USER', 'user', req.params.id);
    res.json({ success: true, isActive: updated.isActive });
  } catch (err) {
    console.error('[admin] PATCH /users/:id/ban error:', err);
    res.status(500).json({ error: 'Failed to ban/unban user', detail: err.message });
  }
});

// ── DELETE /api/admin/users/:id ──────────────────────────────
router.delete('/users/:id', async (req, res) => {
  try {
    await prisma.user.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await logAudit(req.params.id, 'DELETE_USER', 'user', req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[admin] DELETE /users/:id error:', err);
    res.status(500).json({ error: 'Failed to delete user', detail: err.message });
  }
});

// ── GET /api/admin/topics — All topics ───────────────────────
router.get('/topics', async (req, res) => {
  try {
    const topics = await prisma.topic.findMany({
      orderBy: [{ topicScore: { score: 'desc' } }, { createdAt: 'desc' }],
      select: {
        id: true, title: true, description: true,
        status: true, createdAt: true,
        createdBy: { select: { id: true, name: true, anonymousId: true } },
        topicScore: { select: { score: true, voteCount: true, messageCount: true } },
        meeting: { select: { id: true, meetingDate: true, status: true } },
        _count: { select: { votes: true, chatMessages: true } },
      },
    });

    const mapped = topics.map(t => ({
      id:              t.id,
      title:           t.title,
      by:              t.createdBy?.anonymousId || 'DNL-ADMIN',
      byAnonymousId:   t.createdBy?.anonymousId || 'DNL-ADMIN',
      status:          t.status,
      approvalStatus:  'APPROVED',
      votes:           t.topicScore?.voteCount  ?? t._count.votes,
      score:           t.topicScore?.score      ?? 0,
      msgs:            t.topicScore?.messageCount ?? t._count.chatMessages,
      created:         formatDate(t.createdAt),
      category:        'Technology',
      language:        'English',
      savedCount:      0,
      supportedCount:  t.topicScore?.voteCount ?? 0,
      featured:        false,
      interestVelocity:0,
      scheduledTime:   t.meeting?.meetingDate ? formatDate(t.meeting.meetingDate) : undefined,
    }));

    res.json(mapped);
  } catch (err) {
    console.error('[admin] GET /topics error:', err);
    res.status(500).json({ error: 'Failed to fetch topics', detail: err.message });
  }
});

// ── POST /api/admin/topics — Create topic ────────────────────
router.post('/topics', async (req, res) => {
  try {
    const { title, description, category, language, scheduledTime, duration } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

    // Use first admin user as creator, or create a system user
    let adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (!adminUser) {
      adminUser = await prisma.user.findFirst();
    }
    if (!adminUser) return res.status(400).json({ error: 'No users found — create a user first' });

    const topic = await prisma.topic.create({
      data: {
        title: title.trim(),
        description: description || null,
        createdById: adminUser.id,
        status: 'ACTIVE',
      },
      select: {
        id: true, title: true, status: true, createdAt: true,
        createdBy: { select: { id: true, name: true, anonymousId: true } },
      },
    });

    await prisma.topicScore.create({
      data: { topicId: topic.id, score: 0, voteCount: 0, messageCount: 0, meetingJoins: 0 },
    });

    // If scheduledTime provided, create a meeting too
    if (scheduledTime) {
      await prisma.meeting.create({
        data: {
          topicId: topic.id,
          meetingDate: new Date(scheduledTime),
          status: 'SCHEDULED',
        },
      });
    }

    await logAudit(adminUser.id, 'CREATE_TOPIC', 'topic', topic.id);
    res.status(201).json({ success: true, topic });
  } catch (err) {
    console.error('[admin] POST /topics error:', err);
    res.status(500).json({ error: 'Failed to create topic', detail: err.message });
  }
});

// ── PATCH /api/admin/topics/:id/status ───────────────────────
router.patch('/topics/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['ACTIVE', 'CLOSED', 'SELECTED'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });

    const topic = await prisma.topic.update({
      where: { id: req.params.id },
      data: { status },
      select: { id: true, title: true, status: true },
    });

    // Jab SELECTED ho — meeting automatically create karo (agar pehle se nahi hai)
    if (status === 'SELECTED') {
      const existingMeeting = await prisma.meeting.findUnique({
        where: { topicId: req.params.id },
      });
      if (!existingMeeting) {
        await prisma.meeting.create({
          data: {
            topicId: req.params.id,
            meetingDate: new Date(), // abhi se live
            status: 'SCHEDULED',
          },
        });
      }
    }

    await logAudit(req.params.id, `${status}_TOPIC`, 'topic', req.params.id);
    res.json({ success: true, topic });
  } catch (err) {
    console.error('[admin] PATCH /topics/:id/status error:', err);
    res.status(500).json({ error: 'Failed to update topic status', detail: err.message });
  }
});

// ── DELETE /api/admin/topics/:id ─────────────────────────────
router.delete('/topics/:id', async (req, res) => {
  const topicId = req.params.id;
  try {
    // 1. Find linked meeting
    const meeting = await prisma.meeting.findUnique({ where: { topicId } });

    if (meeting) {
      // 2. Delete meeting children in parallel
      const post = await prisma.post.findUnique({ where: { meetingId: meeting.id } });
      await Promise.all([
        prisma.chatMessage.deleteMany({ where: { meetingId: meeting.id } }),
        prisma.meetingAttendee.deleteMany({ where: { meetingId: meeting.id } }),
        post ? prisma.postLike.deleteMany({ where: { postId: post.id } }) : Promise.resolve(),
        post ? prisma.postView.deleteMany({ where: { postId: post.id } }) : Promise.resolve(),
      ]);
      if (post) await prisma.post.delete({ where: { id: post.id } });
      await prisma.meeting.delete({ where: { id: meeting.id } });
    }

    // 3. Delete topic children in parallel
    await Promise.all([
      prisma.chatMessage.deleteMany({ where: { topicId } }),
      prisma.topicVote.deleteMany({ where: { topicId } }),
      prisma.topicScore.deleteMany({ where: { topicId } }),
    ]);

    // 4. Delete topic
    await prisma.topic.delete({ where: { id: topicId } });

    logAudit(topicId, 'DELETE_TOPIC', 'topic', topicId).catch(() => {});
    res.json({ success: true });
  } catch (err) {
    console.error('[admin] DELETE /topics/:id error:', err);
    res.status(500).json({ error: 'Failed to delete topic', detail: err.message });
  }
});

// ── GET /api/admin/meetings — All meetings ───────────────────
router.get('/meetings', async (req, res) => {
  try {
    const meetings = await prisma.meeting.findMany({
      orderBy: { meetingDate: 'desc' },
      select: {
        id: true, meetingDate: true, status: true, createdAt: true,
        topic: { select: { id: true, title: true } },
        _count: { select: { attendees: true } },
        post: { select: { id: true, title: true } },
      },
    });

    const mapped = meetings.map(m => ({
      id:       m.id,
      topic:    m.topic?.title || 'Unknown',
      status:   m.status,
      attendees:m._count.attendees,
      duration: '60m',
      date:     formatDate(m.meetingDate),
      post:     !!m.post,
      category: 'Technology',
      language: 'English',
      scheduledDuration: '60m',
      overrun: false,
    }));

    res.json(mapped);
  } catch (err) {
    console.error('[admin] GET /meetings error:', err);
    res.status(500).json({ error: 'Failed to fetch meetings', detail: err.message });
  }
});

// ── PATCH /api/admin/meetings/:id/status ─────────────────────
router.patch('/meetings/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['SCHEDULED', 'COMPLETED', 'CANCELLED'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });

    const meeting = await prisma.meeting.update({
      where: { id: req.params.id },
      data: { status },
      select: { id: true, status: true },
    });
    res.json({ success: true, meeting });
  } catch (err) {
    console.error('[admin] PATCH /meetings/:id/status error:', err);
    res.status(500).json({ error: 'Failed to update meeting status', detail: err.message });
  }
});

// ── GET /api/admin/posts — All posts ─────────────────────────
router.get('/posts', async (req, res) => {
  try {
    const posts = await prisma.post.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, title: true, createdAt: true, deletedAt: true,
        meeting: { select: { id: true, meetingDate: true, topic: { select: { title: true } } } },
        _count: { select: { views: true, likes: true } },
      },
    });

    const mapped = posts.map(p => ({
      id:      p.id,
      title:   p.title,
      meeting: p.meeting?.topic?.title || 'Unknown Meeting',
      views:   p._count.views,
      likes:   p._count.likes,
      status:  p.deletedAt ? 'deleted' : 'active',
      created: formatDate(p.createdAt),
    }));

    res.json(mapped);
  } catch (err) {
    console.error('[admin] GET /posts error:', err);
    res.status(500).json({ error: 'Failed to fetch posts', detail: err.message });
  }
});

// ── DELETE /api/admin/posts/:id — Soft delete ────────────────
router.delete('/posts/:id', async (req, res) => {
  try {
    await prisma.post.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date() },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[admin] DELETE /posts/:id error:', err);
    res.status(500).json({ error: 'Failed to delete post', detail: err.message });
  }
});

// ── PATCH /api/admin/posts/:id/restore ───────────────────────
router.patch('/posts/:id/restore', async (req, res) => {
  try {
    await prisma.post.update({
      where: { id: req.params.id },
      data: { deletedAt: null },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[admin] PATCH /posts/:id/restore error:', err);
    res.status(500).json({ error: 'Failed to restore post', detail: err.message });
  }
});

// ── GET /api/admin/audit — Audit log ─────────────────────────
router.get('/audit', async (req, res) => {
  try {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, action: true, resource: true,
        resourceId: true, details: true,
        ipAddress: true, createdAt: true,
        user: { select: { name: true, anonymousId: true } },
      },
    });

    const mapped = logs.map(l => ({
      action:  l.action,
      admin:   l.user?.name || 'Admin',
      target:  l.resourceId || l.resource,
      detail:  JSON.stringify(l.details || {}),
      ip:      l.ipAddress || '—',
      time:    timeAgo(l.createdAt),
    }));

    res.json(mapped);
  } catch (err) {
    console.error('[admin] GET /audit error:', err);
    res.status(500).json({ error: 'Failed to fetch audit log', detail: err.message });
  }
});

// ── GET /api/admin/live — Real-time meeting monitor ──────────
router.get('/live', async (req, res) => {
  try {
    const now = new Date();

    const meetings = await prisma.meeting.findMany({
      where: { status: { in: ['SCHEDULED', 'COMPLETED'] } },
      orderBy: { meetingDate: 'desc' },
      take: 30,
      select: {
        id: true, meetingDate: true, status: true, createdAt: true,
        topic: { select: { id: true, title: true } },
        _count: { select: { attendees: true, chatMessages: true } },
        attendees: {
          where: { leftAt: null },   // still in meeting (no leftAt)
          select: { userId: true, joinedAt: true },
        },
      },
    });

    // Separate LIVE (no leftAt attendees in last 15 min) vs SCHEDULED
    const mapped = meetings.map(m => {
      const totalAttendees  = m._count.attendees;
      const activeAttendees = m.attendees.length;  // leftAt IS NULL
      const msgCount        = m._count.chatMessages;

      // Determine if the meeting is effectively live:
      // status SCHEDULED + attendees present = LIVE
      // status COMPLETED = completed
      const ageMinutes = (now - new Date(m.meetingDate)) / 60000;
      const isLive     = m.status === 'SCHEDULED' && activeAttendees > 0;
      const isUpcoming = m.status === 'SCHEDULED' && activeAttendees === 0 && ageMinutes < 60;

      // Approximate role breakdown from attendee count
      // Real role data would need a role column in meeting_attendees
      const listeners = Math.max(0, Math.round(activeAttendees * 0.7));
      const speakers  = Math.max(0, Math.round(activeAttendees * 0.15));
      const debaters  = Math.max(0, activeAttendees - listeners - speakers);

      // Elapsed time in minutes since meetingDate
      const elapsedMin = Math.max(0, Math.floor(ageMinutes));

      // Sentiment proxy from message count vs attendees (more msgs = more heated)
      const msgPerPerson = activeAttendees > 0 ? msgCount / activeAttendees : 0;
      const sentiment = msgPerPerson > 10 ? 'heated' : msgPerPerson > 4 ? 'neutral' : 'positive';

      // Agree/disagree proxy: heated = more disagree
      const agreePercent    = sentiment === 'heated' ? 48 : sentiment === 'neutral' ? 62 : 75;
      const disagreePercent = 100 - agreePercent;

      return {
        id:              m.id,
        topicId:         m.topic?.id,
        topic:           m.topic?.title || 'Unknown',
        status:          isLive ? 'LIVE' : isUpcoming ? 'SCHEDULED' : m.status,
        meetingDate:     m.meetingDate,
        startedAt:       new Date(m.meetingDate).toLocaleTimeString('en', { hour:'numeric', minute:'2-digit' }),
        elapsedMinutes:  elapsedMin,
        scheduledDuration: 60,
        totalAttendees,
        activeAttendees,
        listeners,
        speakers,
        debaters,
        queueLength:     Math.max(0, Math.round(activeAttendees * 0.1)),
        messageCount:    msgCount,
        sentiment,
        agreePercent,
        disagreePercent,
      };
    });

    // Sort: LIVE first, then SCHEDULED, then rest
    const order = { LIVE: 0, SCHEDULED: 1, COMPLETED: 2, CANCELLED: 3 };
    mapped.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

    const live      = mapped.filter(m => m.status === 'LIVE');
    const scheduled = mapped.filter(m => m.status === 'SCHEDULED');

    res.json({
      live,
      scheduled,
      stats: {
        totalLive:         live.length,
        totalParticipants: live.reduce((a, m) => a + m.activeAttendees, 0),
        avgAgreeRate:      live.length > 0
          ? Math.round(live.reduce((a, m) => a + m.agreePercent, 0) / live.length)
          : 0,
        overtimeCount: live.filter(m => m.elapsedMinutes > m.scheduledDuration).length,
      },
    });

  } catch (err) {
    console.error('[admin] GET /live error:', err);
    res.status(500).json({ error: 'Failed to fetch live meetings', detail: err.message });
  }
});

// ── GET /api/admin/analytics — Full analytics payload ────────
router.get('/analytics', async (req, res) => {
  try {
    const now   = new Date();
    const day30 = new Date(now - 30 * 86400000);
    const day7  = new Date(now - 7  * 86400000);
    const day1  = new Date(now - 1  * 86400000);

    const [
      // ── Counts ──────────────────────────────────────────────
      totalTopics, totalMeetings, totalPosts, totalVotes,
      totalMessages, totalUsers, totalFlags,
      completedMeetings, scheduledMeetings, cancelledMeetings,
      deletedPosts,

      // ── 30-day daily topic creation ──────────────────────────
      topicsRaw,

      // ── 7-day daily votes ────────────────────────────────────
      votesRaw,

      // ── Topic scores for quality buckets ─────────────────────
      topicScores,

      // ── Meeting attendees for engagement ─────────────────────
      meetingAttendees,

      // ── Post stats ───────────────────────────────────────────
      postStats,

      // ── Chat messages per hour (last 7d) for heatmap ─────────
      chatHeatmap,

      // ── Users by provider ────────────────────────────────────
      guestCount, googleCount, phoneCount,

      // ── Topics with scores for leaderboard ───────────────────
      topicsWithScores,

      // ── Messages per day (7d) for engagement ─────────────────
      msgsRaw,

      // ── Chat message sample for language detection ───────────
      chatSample,

      // ── Meeting attendance this week ──────────────────────────
      weeklyMeetingAttendance,

    ] = await Promise.all([
      prisma.topic.count(),
      prisma.meeting.count(),
      prisma.post.count({ where: { deletedAt: null } }),
      prisma.topicVote.count(),
      prisma.chatMessage.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.auditLog.count({ where: { action: { in: ['BAN_USER','DELETE_USER'] } } }),
      prisma.meeting.count({ where: { status: 'COMPLETED' } }),
      prisma.meeting.count({ where: { status: 'SCHEDULED' } }),
      prisma.meeting.count({ where: { status: 'CANCELLED' } }),
      prisma.post.count({ where: { deletedAt: { not: null } } }),

      // 30-day topic creation counts per day
      prisma.$queryRawUnsafe(`
        SELECT DATE("createdAt") AS day, COUNT(*)::int AS count
        FROM topics
        WHERE "createdAt" >= NOW() - INTERVAL '30 days'
        GROUP BY DATE("createdAt")
        ORDER BY day ASC
      `),

      // 7-day votes per day + unique voters
      prisma.$queryRawUnsafe(`
        SELECT DATE("createdAt") AS day,
               COUNT(*)::int AS votes,
               COUNT(DISTINCT "userId")::int AS voters
        FROM topic_votes
        WHERE "createdAt" >= NOW() - INTERVAL '7 days'
        GROUP BY DATE("createdAt")
        ORDER BY day ASC
      `),

      // all topic scores for quality distribution
      prisma.topicScore.findMany({
        select: { score: true, voteCount: true, messageCount: true, meetingJoins: true },
      }),

      // all meeting attendees for role/engagement
      prisma.meetingAttendee.findMany({
        select: { userId: true },
      }),

      // post likes + views
      prisma.post.findMany({
        where: { deletedAt: null },
        select: {
          _count: { select: { likes: true, views: true } },
        },
      }),

      // chat messages per hour of day (last 7d) for heatmap
      prisma.$queryRawUnsafe(`
        SELECT EXTRACT(HOUR FROM "createdAt")::int AS hour,
               COUNT(*)::int AS count
        FROM chat_messages
        WHERE "createdAt" >= NOW() - INTERVAL '7 days'
          AND "deletedAt" IS NULL
        GROUP BY EXTRACT(HOUR FROM "createdAt")
        ORDER BY hour ASC
      `),

      // guest users
      prisma.user.count({ where: { deletedAt: null, role: 'USER', isActive: false } }),
      // google (all non-admin active users approximated as google for now)
      prisma.user.count({ where: { deletedAt: null, isActive: true } }),
      // phone (0 since schema has no provider field beyond isActive)
      Promise.resolve(0),

      // topics with score for leaderboard + category
      prisma.topic.findMany({
        take: 50,
        select: {
          id: true, title: true, status: true, createdAt: true,
          topicScore: { select: { score: true, voteCount: true, messageCount: true, meetingJoins: true } },
        },
        orderBy: { topicScore: { score: 'desc' } },
      }),

      // messages per day 7d
      prisma.$queryRawUnsafe(`
        SELECT DATE("createdAt") AS day,
               COUNT(*)::int AS count
        FROM chat_messages
        WHERE "createdAt" >= NOW() - INTERVAL '7 days'
          AND "deletedAt" IS NULL
        GROUP BY DATE("createdAt")
        ORDER BY day ASC
      `),

      // ── Language detection: sample last 500 chat messages ──
      prisma.$queryRawUnsafe(`
        SELECT message
        FROM chat_messages
        WHERE "deletedAt" IS NULL
        ORDER BY "createdAt" DESC
        LIMIT 500
      `),

      // ── Meeting attendees per meeting (for lang×engagement) ──
      prisma.$queryRawUnsafe(`
        SELECT m.id AS meeting_id, COUNT(ma."userId")::int AS attendees,
               t.title AS topic_title
        FROM meetings m
        JOIN topics t ON t.id = m."topicId"
        LEFT JOIN meeting_attendees ma ON ma."meetingId" = m.id
        WHERE m."createdAt" >= NOW() - INTERVAL '7 days'
        GROUP BY m.id, t.title
        ORDER BY attendees DESC
        LIMIT 20
      `),
    ]);

    // ── Build 30-day topic chart (fill missing days with 0) ──
    const topicMap = {};
    topicsRaw.forEach(r => {
      topicMap[new Date(r.day).toLocaleDateString('en', { month: 'short', day: 'numeric' })] = Number(r.count);
    });
    const dailyTopics = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - 29 + i);
      const key = d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
      return { day: i + 1, label: key, count: topicMap[key] || 0 };
    });

    // ── Build 7-day vote chart ────────────────────────────────
    const voteMap = {};
    votesRaw.forEach(r => {
      voteMap[new Date(r.day).toLocaleDateString('en', { month: 'short', day: 'numeric' })] =
        { votes: Number(r.votes), voters: Number(r.voters) };
    });
    const dailyVotes = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - 6 + i);
      const key = d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
      const v   = voteMap[key] || { votes: 0, voters: 0 };
      return { day: key, votes: v.votes, voters: v.voters };
    });

    // ── Meeting completion donut ──────────────────────────────
    const totalMtg = completedMeetings + scheduledMeetings + cancelledMeetings || 1;
    const meetingDonut = [
      { name: 'Completed', value: Math.round(completedMeetings / totalMtg * 100), color: '#34d399' },
      { name: 'Scheduled', value: Math.round(scheduledMeetings / totalMtg * 100), color: '#6366f1' },
      { name: 'Cancelled', value: Math.round(cancelledMeetings / totalMtg * 100), color: '#ef4444' },
    ];
    const completionRate = Math.round(completedMeetings / totalMtg * 100);

    // ── Quality buckets ───────────────────────────────────────
    const scores = topicScores.map(s => Number(s.score));
    const qualityBuckets = [
      { label: 'High Quality (80+)', count: scores.filter(s => s >= 80).length,            color: '#34d399' },
      { label: 'Good (50–79)',        count: scores.filter(s => s >= 50 && s < 80).length, color: '#6366f1' },
      { label: 'Fair (25–49)',        count: scores.filter(s => s >= 25 && s < 50).length, color: '#fbbf24' },
      { label: 'Low (< 25)',          count: scores.filter(s => s < 25).length,            color: '#ef4444' },
    ];

    // ── Avg topic stats ───────────────────────────────────────
    const avgScore = scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length*10)/10 : 0;
    const avgVotes = topicScores.length ? Math.round(topicScores.reduce((a,s)=>a+Number(s.voteCount),0)/topicScores.length*10)/10 : 0;
    const avgMsgs  = topicScores.length ? Math.round(topicScores.reduce((a,s)=>a+Number(s.messageCount),0)/topicScores.length*10)/10 : 0;
    const avgJoins = topicScores.length ? Math.round(topicScores.reduce((a,s)=>a+Number(s.meetingJoins),0)/topicScores.length*10)/10 : 0;

    // ── Post stats ────────────────────────────────────────────
    const totalLikes = postStats.reduce((a,p)=>a+Number(p._count.likes),0);
    const totalViews = postStats.reduce((a,p)=>a+Number(p._count.views),0);
    const postCount  = postStats.length || 1;
    const avgLikes   = Math.round(totalLikes / postCount * 10) / 10;
    const avgViews   = Math.round(totalViews / postCount * 10) / 10;

    // ── Heatmap — 24 hours ────────────────────────────────────
    const heatMap = {};
    chatHeatmap.forEach(r => { heatMap[Number(r.hour)] = Number(r.count); });
    const maxHeat = Math.max(...Object.values(heatMap), 1);
    const heatmapHours = Array.from({ length: 24 }, (_, h) => ({
      hour: h, count: heatMap[h] || 0,
      intensity: (heatMap[h] || 0) / maxHeat,
    }));

    // ── Engagement radar — normalised to 100 ─────────────────
    const engagementRadar = [
      { metric: 'Voting',   value: Math.min(100, Math.round(totalVotes    / Math.max(totalVotes,    200) * 100)) },
      { metric: 'Chat',     value: Math.min(100, Math.round(totalMessages / Math.max(totalMessages, 500) * 100)) },
      { metric: 'Meetings', value: Math.min(100, Math.round(completedMeetings / Math.max(totalMeetings, 10) * 100)) },
      { metric: 'Posts',    value: Math.min(100, Math.round(totalPosts    / Math.max(totalPosts,    50)  * 100)) },
      { metric: 'Reactions',value: Math.min(100, Math.round(totalLikes    / Math.max(totalLikes,   100) * 100)) },
      { metric: 'Topics',   value: Math.min(100, Math.round(totalTopics   / Math.max(totalTopics,  200) * 100)) },
    ];

    // ── Category breakdown (from topic titles heuristic) ─────
    // Since schema has no category field, classify by keywords
    const catKeywords = {
      Technology:  ['ai','tech','software','digital','internet','app','code','crypto','robot','cyber'],
      Politics:    ['politic','election','government','law','policy','vote','democrat','republic','minister'],
      Environment: ['climate','environment','green','energy','carbon','pollution','nature','forest','ocean'],
      Economics:   ['economy','finance','money','market','trade','inflation','gdp','tax','income','invest'],
      Health:      ['health','mental','medical','doctor','vaccine','covid','fitness','wellness','hospital'],
    };
    const catCount = { Technology:0, Politics:0, Environment:0, Economics:0, Health:0, Other:0 };
    topicsWithScores.forEach(t => {
      const lower = t.title.toLowerCase();
      let matched = false;
      for (const [cat, kws] of Object.entries(catKeywords)) {
        if (kws.some(kw => lower.includes(kw))) { catCount[cat]++; matched = true; break; }
      }
      if (!matched) catCount['Other']++;
    });
    const catTotal = Object.values(catCount).reduce((a,b)=>a+b,1);
    const CATEGORY_COLORS = {
      Technology:'#6366f1', Politics:'#f472b6', Environment:'#34d399',
      Economics:'#fbbf24', Health:'#06b6d4', Other:'#818cf8',
    };
    const categoryData = Object.entries(catCount)
      .map(([name, count]) => ({ name, value: Math.round(count/catTotal*100), color: CATEGORY_COLORS[name] }))
      .filter(c => c.value > 0)
      .sort((a,b) => b.value - a.value);

    // ── Language detection from real chat messages ───────────
    // Detect script via Unicode ranges on sampled messages
    const langCount = { English: 0, Hindi: 0, Arabic: 0, Chinese: 0, Spanish: 0, Others: 0 };

    const DEVANAGARI   = /[\u0900-\u097F]/;   // Hindi/Marathi/Nepali
    const CJK          = /[\u4E00-\u9FFF\u3400-\u4DBF]/; // Chinese/Japanese/Korean
    const ARABIC       = /[\u0600-\u06FF]/;   // Arabic/Urdu
    const LATIN_EXTRA  = /[áéíóúüñ¿¡àèùâêîôûç]/i; // Spanish/French/Portuguese diacritics

    chatSample.forEach(row => {
      const msg = row.message || '';
      if (DEVANAGARI.test(msg))       langCount.Hindi++;
      else if (CJK.test(msg))         langCount.Chinese++;
      else if (ARABIC.test(msg))      langCount.Arabic++;
      else if (LATIN_EXTRA.test(msg)) langCount.Spanish++;
      else if (/[a-zA-Z]/.test(msg))  langCount.English++;
      else                            langCount.Others++;
    });

    // Also scan topic titles
    topicsWithScores.forEach(t => {
      const txt = t.title || '';
      if (DEVANAGARI.test(txt))       langCount.Hindi++;
      else if (CJK.test(txt))         langCount.Chinese++;
      else if (ARABIC.test(txt))      langCount.Arabic++;
      else if (LATIN_EXTRA.test(txt)) langCount.Spanish++;
      else if (/[a-zA-Z]/.test(txt))  langCount.English++;
    });

    const langTotal = Math.max(Object.values(langCount).reduce((a, b) => a + b, 0), 1);
    const LANG_COLORS = { English:'#6366f1', Hindi:'#f472b6', Arabic:'#fbbf24', Chinese:'#06b6d4', Spanish:'#34d399', Others:'#818cf8' };

    const languageData = Object.entries(langCount)
      .filter(([, c]) => c > 0)
      .map(([name, count]) => ({ name, value: Math.round(count / langTotal * 100), color: LANG_COLORS[name] }))
      .sort((a, b) => b.value - a.value);

    // Ensure at least something shown if all messages are empty/no data
    const finalLanguageData = languageData.length > 0 ? languageData : [
      { name: 'English', value: 100, color: '#6366f1' },
    ];

    // ── Language × Engagement: real meeting attendance bucketed by lang ──
    // Classify each meeting's topic title by script, sum attendees
    const langEngagement = { English: 0, Hindi: 0, Spanish: 0, French: 0, Chinese: 0, Others: 0 };
    const LANG_ENG_COLORS = { English:'#6366f1', Hindi:'#f472b6', Spanish:'#34d399', French:'#06b6d4', Chinese:'#fbbf24', Others:'#818cf8' };

    // Use weekly meeting attendance data
    weeklyMeetingAttendance.forEach(row => {
      const title = row.topic_title || '';
      const att   = Number(row.attendees) || 0;
      if (DEVANAGARI.test(title))       langEngagement.Hindi   += att;
      else if (CJK.test(title))         langEngagement.Chinese += att;
      else if (/[a-zA-Z]/.test(title))  langEngagement.English += att;
      else                              langEngagement.Others  += att;
    });

    // Fallback: distribute total meeting attendees proportionally if no weekly data
    const langEngTotal = Object.values(langEngagement).reduce((a, b) => a + b, 0);
    const totalAttendees = meetingAttendees.length;

    let langEngagementData;
    if (langEngTotal === 0 && totalAttendees > 0) {
      // No weekly meetings but we have historical data — distribute by language dist
      langEngagementData = finalLanguageData.map(l => ({
        lang:      l.name,
        sessions:  Math.round(totalAttendees * l.value / 100),
        color:     l.color,
        meetings:  Math.round(totalAttendees * l.value / 100 / 10),
      })).filter(l => l.sessions > 0);
    } else {
      langEngagementData = Object.entries(langEngagement)
        .filter(([, v]) => v > 0)
        .map(([lang, sessions]) => ({
          lang,
          sessions,
          color:    LANG_ENG_COLORS[lang] || '#818cf8',
          meetings: Math.round(sessions / 10),
        }))
        .sort((a, b) => b.sessions - a.sessions);
    }

    // If still empty, show total attendees under English
    if (langEngagementData.length === 0) {
      langEngagementData = [{ lang: 'English', sessions: totalAttendees || 0, color: '#6366f1', meetings: 0 }];
    }

    // ── Sentiment trend ───────────────────────────────────────
    const sentimentTrend = topicsWithScores.slice(0, 6).map(t => ({
      name:     t.title.slice(0, 12) + '…',
      agree:    Math.max(1, Number(t.topicScore?.voteCount || 0)),
      disagree: Math.max(0, Math.round(Number(t.topicScore?.voteCount || 0) * 0.3)),
    }));

    // ── Conversion ────────────────────────────────────────────
    const guestUsers  = Math.max(0, totalUsers - googleCount);
    const convRate    = totalUsers > 0 ? Math.round(googleCount / totalUsers * 100) : 0;

    // ── DAU/WAU/MAU estimates from meeting_attendees ──────────
    const dauCount = (await prisma.meetingAttendee.findMany({
      where: { joinedAt: { gte: day1 } },
      distinct: ['userId'],
      select: { userId: true },
    })).length;
    const wauCount = (await prisma.meetingAttendee.findMany({
      where: { joinedAt: { gte: day7 } },
      distinct: ['userId'],
      select: { userId: true },
    })).length;

    res.json({
      // Charts
      dailyTopics,
      dailyVotes,
      meetingDonut,
      completionRate,
      engagementRadar,
      sentimentTrend,
      categoryData,
      languageData:     finalLanguageData,
      languageEngagement: langEngagementData,
      heatmapHours,
      qualityBuckets,

      // Stat cards
      topicStats:  { avgScore, avgVotes, avgMsgs, avgJoins },
      engagement:  { dau: dauCount, wau: wauCount, mau: totalUsers, avgSession: '—' },
      postStats:   { total: totalPosts, avgLikes, avgViews, deleted: deletedPosts },
      moderation:  { flags: totalFlags, deleted: deletedPosts, warned: 0, banned: 0 },

      // Conversion
      userStats: { total: totalUsers, auth: googleCount, guests: guestUsers, google: googleCount, phone: phoneCount },
      convRate,
    });

  } catch (err) {
    console.error('[admin] GET /analytics error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics', detail: err.message });
  }
});

// ── GET /api/admin/activity — Real live activity feed ────────
// Pulls latest 20 events across topics, meetings, votes, chat, users
router.get('/activity', async (req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24h

    const [
      recentTopics,
      recentAttendees,
      recentVotes,
      recentMessages,
      recentUsers,
      recentAudit,
    ] = await Promise.all([
      // New topics submitted
      prisma.topic.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true, title: true, createdAt: true,
          createdBy: { select: { anonymousId: true } },
        },
      }),
      // Meeting joins
      prisma.meetingAttendee.findMany({
        where: { joinedAt: { gte: since } },
        orderBy: { joinedAt: 'desc' },
        take: 8,
        select: {
          id: true, joinedAt: true,
          user: { select: { anonymousId: true } },
          meeting: { select: { topic: { select: { title: true } } } },
        },
      }),
      // Topic votes
      prisma.topicVote.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true, createdAt: true,
          user:  { select: { anonymousId: true } },
          topic: { select: { title: true } },
        },
      }),
      // Chat messages (non-deleted)
      prisma.chatMessage.findMany({
        where: { createdAt: { gte: since }, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true, createdAt: true,
          user:  { select: { anonymousId: true } },
          topic: { select: { title: true } },
          meeting: { select: { topic: { select: { title: true } } } },
        },
      }),
      // New user registrations
      prisma.user.findMany({
        where: { createdAt: { gte: since }, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, anonymousId: true, createdAt: true },
      }),
      // Audit log (admin actions)
      prisma.auditLog.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true, action: true, resource: true, createdAt: true,
          user: { select: { anonymousId: true } },
        },
      }),
    ]);

    // ── Map each source to unified event shape ────────────────
    const events = [];

    recentTopics.forEach(t => {
      events.push({
        id:    `topic-${t.id}`,
        color: '#6366f1',
        text:  `New topic submitted: <b>"${t.title}"</b>`,
        by:    t.createdBy?.anonymousId || 'Unknown',
        time:  timeAgo(t.createdAt),
        ts:    t.createdAt.getTime(),
        type:  'topic',
      });
    });

    recentAttendees.forEach(a => {
      const topicTitle = a.meeting?.topic?.title || 'a meeting';
      events.push({
        id:    `join-${a.id}`,
        color: '#34d399',
        text:  `<b>${a.user?.anonymousId || 'User'}</b> joined meeting <b>${topicTitle}</b>`,
        by:    a.user?.anonymousId || '—',
        time:  timeAgo(a.joinedAt),
        ts:    a.joinedAt.getTime(),
        type:  'join',
      });
    });

    recentVotes.forEach(v => {
      events.push({
        id:    `vote-${v.id}`,
        color: '#f472b6',
        text:  `<b>${v.user?.anonymousId || 'User'}</b> voted on <b>"${v.topic?.title || 'a topic'}"</b>`,
        by:    v.user?.anonymousId || '—',
        time:  timeAgo(v.createdAt),
        ts:    v.createdAt.getTime(),
        type:  'vote',
      });
    });

    recentMessages.forEach(m => {
      const ctx = m.topic?.title || m.meeting?.topic?.title || 'a discussion';
      events.push({
        id:    `msg-${m.id}`,
        color: '#06b6d4',
        text:  `<b>${m.user?.anonymousId || 'User'}</b> sent a message in <b>${ctx}</b>`,
        by:    m.user?.anonymousId || '—',
        time:  timeAgo(m.createdAt),
        ts:    m.createdAt.getTime(),
        type:  'message',
      });
    });

    recentUsers.forEach(u => {
      events.push({
        id:    `user-${u.id}`,
        color: '#a78bfa',
        text:  `New user <b>${u.anonymousId || 'DNL-????'}</b> joined the platform`,
        by:    u.anonymousId || '—',
        time:  timeAgo(u.createdAt),
        ts:    u.createdAt.getTime(),
        type:  'user',
      });
    });

    recentAudit.forEach(l => {
      const actionLabel = {
        BAN_USER:    '🚫 banned a user',
        UNBAN_USER:  '✅ unbanned a user',
        DELETE_USER: '🗑️ deleted a user',
        DELETE_TOPIC:'🗑️ deleted a topic',
        CREATE_TOPIC:'📝 created a topic',
        SELECTED_TOPIC: '📌 selected a topic for meeting',
        CLOSED_TOPIC:   '🔒 closed a topic',
      }[l.action] || `performed ${l.action}`;

      events.push({
        id:    `audit-${l.id}`,
        color: '#ef4444',
        text:  `Admin <b>${l.user?.anonymousId || 'Admin'}</b> ${actionLabel}`,
        by:    l.user?.anonymousId || 'Admin',
        time:  timeAgo(l.createdAt),
        ts:    l.createdAt.getTime(),
        type:  'audit',
      });
    });

    // Sort all events by timestamp desc, return top 20
    events.sort((a, b) => b.ts - a.ts);
    res.json(events.slice(0, 20));

  } catch (err) {
    console.error('[admin] GET /activity error:', err);
    res.status(500).json({ error: 'Failed to fetch activity', detail: err.message });
  }
});

// ── GET /api/admin/growth — 14-day user signups + sessions ───
router.get('/growth', async (req, res) => {
  try {
    const days = 14;
    const results = [];

    for (let i = days - 1; i >= 0; i--) {
      const start = new Date();
      start.setDate(start.getDate() - i);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);

      const [newUsers, activeSessions] = await Promise.all([
        prisma.user.count({
          where: { createdAt: { gte: start, lte: end }, deletedAt: null },
        }),
        prisma.meetingAttendee.count({
          where: { joinedAt: { gte: start, lte: end } },
        }),
      ]);

      results.push({
        day: start.toLocaleDateString('en', { month: 'short', day: 'numeric' }),
        users: newUsers,
        sessions: activeSessions,
      });
    }

    res.json(results);
  } catch (err) {
    console.error('[admin] GET /growth error:', err);
    res.status(500).json({ error: 'Failed to fetch growth data', detail: err.message });
  }
});

// ── GET /api/admin/chat/messages — All chat messages ─────────
// Query params: ?limit=50&offset=0&flagged=true&search=text
router.get('/chat/messages', async (req, res) => {
  try {
    const limit   = Math.min(parseInt(req.query.limit  || '100'), 200);
    const offset  = parseInt(req.query.offset || '0');
    const search  = req.query.search?.trim() || '';
    const onlyDel = req.query.deleted === 'true';

    const where = {
      ...(onlyDel ? { deletedAt: { not: null } } : {}),
      ...(search ? {
        OR: [
          { message:        { contains: search, mode: 'insensitive' } },
          { user: { anonymousId: { contains: search, mode: 'insensitive' } } },
        ],
      } : {}),
    };

    const [messages, total] = await Promise.all([
      prisma.chatMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        select: {
          id: true, message: true, createdAt: true, deletedAt: true,
          topicId: true, meetingId: true,
          user: { select: { id: true, name: true, anonymousId: true, email: true, isActive: true } },
          topic:   { select: { id: true, title: true } },
          meeting: { select: { id: true } },
        },
      }),
      prisma.chatMessage.count({ where }),
    ]);

    const COLORS = ['#6366f1','#06b6d4','#f472b6','#34d399','#fbbf24','#a78bfa','#67e8f9','#fca5a5'];
    const colorOf = (id) => COLORS[(id?.charCodeAt(0) || 0) % COLORS.length];

    const mapped = messages.map(m => ({
      id:          m.id,
      anonymousId: m.user?.anonymousId || `DNL-${m.user?.id?.slice(0,4).toUpperCase() || 'XXXX'}`,
      userId:      m.user?.id,
      userName:    m.user?.name,
      email:       m.user?.email ? maskEmail(m.user.email) : '—',
      color:       colorOf(m.user?.id),
      msg:         m.message,
      time:        timeAgo(m.createdAt),
      createdAt:   m.createdAt,
      deleted:     !!m.deletedAt,
      flagged:     false,           // No flag field in DB — tracked via audit log
      topicId:     m.topicId,
      topicTitle:  m.topic?.title || null,
      meetingId:   m.meetingId,
      context:     m.topicId ? 'topic' : m.meetingId ? 'meeting' : 'unknown',
    }));

    res.json({ messages: mapped, total, limit, offset });
  } catch (err) {
    console.error('[admin] GET /chat/messages error:', err);
    res.status(500).json({ error: 'Failed to fetch messages', detail: err.message });
  }
});

// ── DELETE /api/admin/chat/messages/:id — Soft delete ────────
router.delete('/chat/messages/:id', async (req, res) => {
  try {
    const msg = await prisma.chatMessage.findUnique({ where: { id: req.params.id } });
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    await prisma.chatMessage.update({
      where: { id: req.params.id },
      data:  { deletedAt: new Date() },
    });

    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (admin) {
      await prisma.auditLog.create({
        data: {
          userId:     admin.id,
          action:     'DELETE_MESSAGE',
          resource:   'chat_message',
          resourceId: req.params.id,
          details:    { preview: msg.message.slice(0, 80) },
        },
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[admin] DELETE /chat/messages/:id error:', err);
    res.status(500).json({ error: 'Failed to delete message', detail: err.message });
  }
});

// ── POST /api/admin/chat/messages/:id/restore — Restore ──────
router.post('/chat/messages/:id/restore', async (req, res) => {
  try {
    await prisma.chatMessage.update({
      where: { id: req.params.id },
      data:  { deletedAt: null },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to restore message', detail: err.message });
  }
});

// ── POST /api/admin/chat/messages/:id/flag — Flag (audit log) 
router.post('/chat/messages/:id/flag', async (req, res) => {
  try {
    const msg = await prisma.chatMessage.findUnique({
      where: { id: req.params.id },
      include: { user: { select: { id: true, anonymousId: true } } },
    });
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (admin) {
      await prisma.auditLog.create({
        data: {
          userId:     admin.id,
          action:     'FLAG_MESSAGE',
          resource:   'chat_message',
          resourceId: req.params.id,
          details:    {
            preview:   msg.message.slice(0, 80),
            messageUserId: msg.userId,
            reason:    req.body.reason || 'Admin flagged',
          },
        },
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[admin] POST /chat/messages/:id/flag error:', err);
    res.status(500).json({ error: 'Failed to flag message', detail: err.message });
  }
});

// ── GET /api/admin/chat/stats — Chat stats ───────────────────
router.get('/chat/stats', async (req, res) => {
  try {
    const [total, deleted, flaggedFromAudit] = await Promise.all([
      prisma.chatMessage.count(),
      prisma.chatMessage.count({ where: { deletedAt: { not: null } } }),
      prisma.auditLog.count({ where: { action: 'FLAG_MESSAGE' } }),
    ]);
    res.json({ total, deleted, active: total - deleted, flagged: flaggedFromAudit });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch chat stats', detail: err.message });
  }
});

// ── Helper: log audit entry ───────────────────────────────────
async function logAudit(userId, action, resource, resourceId, details = {}) {
  try {
    const user = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (!user) return;
    await prisma.auditLog.create({
      data: { userId: user.id, action, resource, resourceId, details },
    });
  } catch (_) {}
}

// ── Helper: mask email ────────────────────────────────────────
function maskEmail(email) {
  if (!email) return 'unknown';
  const [local, domain] = email.split('@');
  if (!domain) return email;
  return `${local.slice(0, 3)}***@${domain}`;
}

// ── Helper: format date ───────────────────────────────────────
function formatDate(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// ── Helper: time ago ──────────────────────────────────────────
function timeAgo(date) {
  if (!date) return '—';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Helper: consistent color from user id ────────────────────
function randomColor(id) {
  const colors = ['#6366f1','#06b6d4','#f472b6','#34d399','#fbbf24','#a78bfa','#67e8f9','#fca5a5'];
  const idx = id?.charCodeAt(0) % colors.length || 0;
  return colors[idx];
}

export default router;
