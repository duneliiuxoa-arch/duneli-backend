-- =============================================================
-- Migration: schema_fixes
-- Applies all 22-issue audit fixes to the live database.
-- =============================================================

-- 1. Add VarChar limits (data truncation prevention)
ALTER TABLE "users"
  ALTER COLUMN "name"     TYPE VARCHAR(100),
  ALTER COLUMN "email"    TYPE VARCHAR(255),
  ALTER COLUMN "password" TYPE VARCHAR(255);

ALTER TABLE "topics"
  ALTER COLUMN "title" TYPE VARCHAR(200);

ALTER TABLE "posts"
  ALTER COLUMN "title" TYPE VARCHAR(300);

ALTER TABLE "audit_logs"
  ALTER COLUMN "action"     TYPE VARCHAR(100),
  ALTER COLUMN "resource"   TYPE VARCHAR(100),
  ALTER COLUMN "ipAddress"  TYPE VARCHAR(45),
  ALTER COLUMN "userAgent"  TYPE VARCHAR(500);

-- 2. Fix TopicScore.score: Float -> Int (formula always returns whole numbers)
ALTER TABLE "topic_scores"
  ALTER COLUMN "score" TYPE INTEGER USING "score"::integer;

-- 3. Add updatedAt to ChatMessage (needed for message editing)
ALTER TABLE "chat_messages"
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW();

-- 4. Remove updatedAt from PostView (view records never change after creation)
ALTER TABLE "post_views"
  DROP COLUMN IF EXISTS "updatedAt";


-- 5. Remove duplicate/redundant indexes
-- Post.meetingId: @unique already creates a B-tree index
DROP INDEX IF EXISTS "posts_meetingId_idx";

-- TopicScore.topicId: @unique already creates a B-tree index
DROP INDEX IF EXISTS "topic_scores_topicId_idx";

-- ChatMessage: standalone topicId/meetingId covered by composites
DROP INDEX IF EXISTS "chat_messages_topicId_idx";
DROP INDEX IF EXISTS "chat_messages_meetingId_idx";

-- Topic: standalone status/createdAt covered by composite (status, createdAt)
DROP INDEX IF EXISTS "topics_status_idx";
DROP INDEX IF EXISTS "topics_createdAt_idx";

-- Session: tokenHash @unique already indexes it
DROP INDEX IF EXISTS "sessions_tokenHash_idx";

-- MeetingAttendee: standalone meetingId/userId covered by new composites
DROP INDEX IF EXISTS "meeting_attendees_meetingId_idx";
DROP INDEX IF EXISTS "meeting_attendees_userId_idx";

-- 6. Add new useful indexes
-- TopicScore by score (for leaderboard queries)
CREATE INDEX IF NOT EXISTS "topic_scores_score_idx" ON "topic_scores"("score");

-- Session by expiresAt (for cleanup job)
CREATE INDEX IF NOT EXISTS "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- ChatMessage by deletedAt (for soft-delete filtering)
CREATE INDEX IF NOT EXISTS "chat_messages_deletedAt_idx" ON "chat_messages"("deletedAt");

-- MeetingAttendee composite (userId, joinedAt) for user attendance history
CREATE INDEX IF NOT EXISTS "meeting_attendees_userId_joinedAt_idx"
  ON "meeting_attendees"("userId", "joinedAt");
