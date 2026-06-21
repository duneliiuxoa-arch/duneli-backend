// =============================================================
// routes/users.js — User sync & profile routes
// POST /api/users        — Supabase user ka public.users mein upsert
// GET  /api/users/:id    — User profile fetch
// =============================================================
import { Router } from 'express';
import prisma from '../prisma/middleware/prismaClient.js';

const router = Router();

// ── Supabase JWT se user ID extract karne ka helper ──────────
// Frontend Authorization: Bearer <supabase_access_token> bhejta hai
// Hum sirf basic validation karte hain — full JWT verify production mein karo
function getUserIdFromHeader(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  try {
    const token = auth.split(' ')[1];
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString()
    );
    return payload.sub || null; // Supabase sets user ID as 'sub'
  } catch {
    return null;
  }
}

// ── POST /api/users ───────────────────────────────────────────
// Supabase login ke baad frontend ye call karta hai taaki
// public.users mein row ensure ho (trigger backup ke roop mein)
router.post('/', async (req, res) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized — Bearer token required' });
    }

    const { name, email, avatarUrl } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    const user = await prisma.user.upsert({
      where: { id: userId },
      update: {
        name: name || undefined,
        avatarUrl: avatarUrl || undefined,
        updatedAt: new Date(),
      },
      create: {
        id: userId,
        name: name || email.split('@')[0],
        email,
        avatarUrl: avatarUrl || null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        anonymousId: true,
        role: true,
        createdAt: true,
      },
    });

    res.json({ user });
  } catch (err) {
    console.error('[users] POST /api/users error:', err);
    res.status(500).json({ error: 'Failed to sync user', detail: err.message });
  }
});

// ── GET /api/users/:id ────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized — Bearer token required' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        anonymousId: true,
        role: true,
        createdAt: true,
        _count: {
          select: {
            topics: true,
            topicVotes: true,
            chatMessages: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (err) {
    console.error('[users] GET /api/users/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch user', detail: err.message });
  }
});

// ── GET /api/users/me/topics — Topics created by logged-in user ──
router.get('/me/topics', async (req, res) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const topics = await prisma.topic.findMany({
      where: { createdById: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, title: true, status: true, createdAt: true,
        topicScore: { select: { voteCount: true, score: true } },
        meeting: { select: { id: true, meetingDate: true, status: true } },
        _count: { select: { votes: true, chatMessages: true } },
      },
    });
    res.json({ topics });
  } catch (err) {
    console.error('[users] GET /me/topics error:', err);
    res.status(500).json({ error: 'Failed to fetch topics', detail: err.message });
  }
});

// ── GET /api/users/me/votes — Topics voted/supported by logged-in user ──
router.get('/me/votes', async (req, res) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const votes = await prisma.topicVote.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, createdAt: true,
        topic: {
          select: {
            id: true, title: true, status: true, createdAt: true,
            topicScore: { select: { voteCount: true, score: true } },
            meeting: { select: { id: true, meetingDate: true, status: true } },
            createdBy: { select: { id: true, name: true, anonymousId: true } },
          },
        },
      },
    });
    res.json({ votes });
  } catch (err) {
    console.error('[users] GET /me/votes error:', err);
    res.status(500).json({ error: 'Failed to fetch votes', detail: err.message });
  }
});

// ── GET /api/users/me/activity — Meetings attended by logged-in user ──
router.get('/me/activity', async (req, res) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const attendances = await prisma.meetingAttendee.findMany({
      where: { userId },
      orderBy: { joinedAt: 'desc' },
      take: 30,
      select: {
        id: true, joinedAt: true, leftAt: true,
        meeting: {
          select: {
            id: true, meetingDate: true, status: true,
            topic: { select: { id: true, title: true, status: true } },
            post: { select: { id: true, title: true } },
          },
        },
      },
    });
    res.json({ attendances });
  } catch (err) {
    console.error('[users] GET /me/activity error:', err);
    res.status(500).json({ error: 'Failed to fetch activity', detail: err.message });
  }
});

export default router;
