// =============================================================
// Duneli — Server Entry Point
// =============================================================
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import './prisma/src/jobs/scheduler.js';
import prisma from './prisma/middleware/prismaClient.js';
import metricsRouter from './routes/metrics.js';
import usersRouter from './routes/users.js';
import discussionsRouter from './routes/discussions.js';
import adminRouter from './routes/admin.js';
import agoraRouter from './routes/agora.js';
import ideasRouter from './routes/ideas.js';

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || 'http://localhost:5173')
  .split(',').map(o => o.trim());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-token'],
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => req.headers['x-admin-token'] === process.env.ADMIN_TOKEN,
}));

app.use(express.json());

// Health check
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected', ts: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'disconnected', error: err.message });
  }
});

// Database intelligence metrics API
app.use('/api/metrics', metricsRouter);

// Users — Supabase user sync & profile
app.use('/api/users', usersRouter);

// Discussions — topics, meetings, completion
app.use('/api/discussions', discussionsRouter);

// Admin — protected by x-admin-token
app.use('/api/admin', adminRouter);

// Agora — token generation
app.use('/api/agora', agoraRouter);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] Duneli running on port ${PORT}`);
  console.log(`[server] NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`[server] Health:  http://localhost:${PORT}/health`);
  console.log(`[server] Metrics: http://localhost:${PORT}/api/metrics`);
});
