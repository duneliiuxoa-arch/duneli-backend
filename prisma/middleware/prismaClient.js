// =============================================================
// prismaClient.js — Singleton Prisma client with middleware
// =============================================================
// Connection pool is configured via the DATABASE_URL in .env:
//   ?connection_limit=20&pool_timeout=10
//
// connection_limit : max simultaneous DB connections (default: 10)
// pool_timeout     : seconds to wait for a free connection (default: 10)
//
// For high-traffic production, consider PgBouncer in front of
// PostgreSQL and reduce connection_limit to 5-10 per app instance.
// =============================================================

import { PrismaClient } from '@prisma/client';
import { hashPasswordMiddleware } from './hashPassword.js';
import { hashSessionTokenMiddleware } from './sessionMiddleware.js';

// Prevent multiple Prisma instances during hot-reload in development
const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// ─── Middleware ──────────────────────────────────────────────
prisma.$use(hashPasswordMiddleware);
prisma.$use(hashSessionTokenMiddleware);

export default prisma;
