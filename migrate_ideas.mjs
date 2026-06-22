import prisma from './prisma/middleware/prismaClient.js';
try {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS idea_shares (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "topicId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    content VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY ("topicId") REFERENCES topics(id) ON DELETE RESTRICT,
    FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE RESTRICT
  )`);
  console.log('idea_shares created');

  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idea_shares_topic ON idea_shares("topicId","createdAt")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idea_shares_user ON idea_shares("userId","createdAt")`);

  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS idea_reactions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "ideaId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    type VARCHAR(10) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY ("ideaId") REFERENCES idea_shares(id) ON DELETE CASCADE,
    UNIQUE("ideaId","userId")
  )`);
  console.log('idea_reactions created');
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idea_reactions_idea ON idea_reactions("ideaId")`);
  console.log('ALL DONE');
} catch(e) {
  console.error('ERROR:', e.message);
}
await prisma.$disconnect();
