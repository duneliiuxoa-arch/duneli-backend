// =============================================================
// Duneli — Server Entry Point
// =============================================================
import 'dotenv/config';
import express from 'express';

// ─── Background Jobs ──────────────────────────────────────────
import './prisma/src/jobs/scheduler.js';

// ─── Prisma Client ────────────────────────────────────────────
import prisma from './prisma/middleware/prismaClient.js';

// ─── Express App ──────────────────────────────────────────────
const app = express();
app.use(express.json());

// Health check endpoint — required by Railway to confirm app is alive
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected', ts: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'disconnected', error: err.message });
  }
});

// =============================================================
// Add your routes here as you build them:
// import topicRoutes from './routes/topics.js';
// app.use('/api/topics', topicRoutes);
// =============================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] Duneli running on port ${PORT}`);
  console.log(`[server] NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`[server] Health check: http://localhost:${PORT}/health`);
});
