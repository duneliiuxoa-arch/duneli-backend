// routes/ideas.js — Idea sharing during live meetings
// POST /api/ideas/:topicId        — Share a new idea (speaker/debater only, 5min cooldown)
// GET  /api/ideas/:topicId        — Fetch all ideas for a topic (with user reactions)
// POST /api/ideas/:ideaId/react   — Toggle agree/disagree reaction

import { Router } from 'express';
import prisma from '../prisma/middleware/prismaClient.js';

const router = Router();

const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

function getUserId(req) {
  const adminToken = req.headers['x-admin-token'];
  if (adminToken && adminToken === process.env.ADMIN_TOKEN) return 'admin';
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    const payload = JSON.parse(Buffer.from(auth.split('.')[1], 'base64url').toString());
    return payload.sub || null;
  } catch { return null; }
}

// ── GET /api/ideas/:topicId — fetch all ideas with reaction counts ─────────
router.get('/:topicId', async (req, res) => {
  const userId = getUserId(req);
  const { topicId } = req.params;

  try {
    const ideas = await prisma.$queryRawUnsafe(`
      SELECT
        i.id,
        i."topicId",
        i."userId",
        i.content,
        i."createdAt",
        u.name AS "userName",
        u."anonymousId",
        u."avatarUrl",
        COUNT(CASE WHEN r.type = 'agree'    THEN 1 END)::int AS "agreeCount",
        COUNT(CASE WHEN r.type = 'disagree' THEN 1 END)::int AS "disagreeCount",
        MAX(CASE WHEN r."userId" = $1 THEN r.type END) AS "myReaction"
      FROM idea_shares i
      JOIN users u ON u.id = i."userId"
      LEFT JOIN idea_reactions r ON r."ideaId" = i.id
      WHERE i."topicId" = $2
      GROUP BY i.id, u.name, u."anonymousId", u."avatarUrl"
      ORDER BY i."createdAt" ASC
    `, userId || '', topicId);

    res.json({ ideas });
  } catch (err) {
    console.error('[ideas] GET error:', err);
    res.status(500).json({ error: 'Failed to fetch ideas' });
  }
});

// ── POST /api/ideas/:topicId — share a new idea ────────────────────────────
router.post('/:topicId', async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { topicId } = req.params;
  const { content } = req.body;

  if (!content?.trim()) return res.status(400).json({ error: 'content is required' });
  if (content.length > 1000) return res.status(400).json({ error: 'content too long (max 1000 chars)' });

  try {
    // ── 5-minute cooldown check ────────────────────────────────
    const [lastIdea] = await prisma.$queryRawUnsafe(`
      SELECT "createdAt" FROM idea_shares
      WHERE "topicId" = $1 AND "userId" = $2
      ORDER BY "createdAt" DESC LIMIT 1
    `, topicId, userId);

    if (lastIdea) {
      const elapsed = Date.now() - new Date(lastIdea.createdAt).getTime();
      if (elapsed < COOLDOWN_MS) {
        const remaining = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
        return res.status(429).json({
          error: 'Cooldown active',
          remainingSeconds: remaining,
          message: `Wait ${Math.floor(remaining / 60)}m ${remaining % 60}s before sharing another idea`,
        });
      }
    }

    // ── Create idea ────────────────────────────────────────────
    const [idea] = await prisma.$queryRawUnsafe(`
      INSERT INTO idea_shares (id, "topicId", "userId", content, "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, $1, $2, $3, now(), now())
      RETURNING id, "topicId", "userId", content, "createdAt"
    `, topicId, userId, content.trim());

    // Fetch with user info
    const [full] = await prisma.$queryRawUnsafe(`
      SELECT i.id, i."topicId", i."userId", i.content, i."createdAt",
             u.name AS "userName", u."anonymousId", u."avatarUrl",
             0::int AS "agreeCount", 0::int AS "disagreeCount", NULL AS "myReaction"
      FROM idea_shares i JOIN users u ON u.id = i."userId"
      WHERE i.id = $1
    `, idea.id);

    res.status(201).json({ idea: full });
  } catch (err) {
    console.error('[ideas] POST error:', err);
    res.status(500).json({ error: 'Failed to create idea' });
  }
});

// ── POST /api/ideas/:ideaId/react — toggle agree/disagree ─────────────────
router.post('/:ideaId/react', async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { ideaId } = req.params;
  const { type } = req.body; // 'agree' | 'disagree'

  if (!['agree', 'disagree'].includes(type))
    return res.status(400).json({ error: "type must be 'agree' or 'disagree'" });

  try {
    // Check existing reaction
    const [existing] = await prisma.$queryRawUnsafe(`
      SELECT id, type FROM idea_reactions WHERE "ideaId" = $1 AND "userId" = $2
    `, ideaId, userId);

    if (existing) {
      if (existing.type === type) {
        // Same type → remove (toggle off)
        await prisma.$executeRawUnsafe(`
          DELETE FROM idea_reactions WHERE "ideaId" = $1 AND "userId" = $2
        `, ideaId, userId);
      } else {
        // Different type → switch
        await prisma.$executeRawUnsafe(`
          UPDATE idea_reactions SET type = $1, "updatedAt" = now()
          WHERE "ideaId" = $2 AND "userId" = $3
        `, type, ideaId, userId);
      }
    } else {
      // New reaction
      await prisma.$executeRawUnsafe(`
        INSERT INTO idea_reactions (id, "ideaId", "userId", type, "createdAt", "updatedAt")
        VALUES (gen_random_uuid()::text, $1, $2, $3, now(), now())
      `, ideaId, userId, type);
    }

    // Return updated counts + user's reaction
    const [counts] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(CASE WHEN type = 'agree'    THEN 1 END)::int AS "agreeCount",
        COUNT(CASE WHEN type = 'disagree' THEN 1 END)::int AS "disagreeCount",
        MAX(CASE WHEN "userId" = $2 THEN type END) AS "myReaction"
      FROM idea_reactions WHERE "ideaId" = $1
    `, ideaId, userId);

    res.json({ ideaId, ...counts });
  } catch (err) {
    console.error('[ideas] react error:', err);
    res.status(500).json({ error: 'Failed to react' });
  }
});

export default router;
