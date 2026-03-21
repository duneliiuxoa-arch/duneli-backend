# Duneli Database Refactor TODO

## Step 1: [COMPLETE] Update prisma/schema.prisma
- Add deletedAt to User, Topic
- User: CHECK password length >=60
- Session: token -> tokenHash, add updatedAt
- ChatMessage: CHECK (topicId OR meetingId)
- PostView: @@unique([postId, userId])
- Add updatedAt to PostView, PostLike, TopicVote, MeetingAttendee, TopicScore, Session
- Fix cascades: Topic->ChatMessage Restrict, Meeting->Post Restrict
- Add indexes: Topic@@index([status,createdAt]), MeetingAttendee@@index([meetingId,joinedAt]), ChatMessage@@index([userId,createdAt])
- Add AuditLog model

## Step 2: [COMPLETE] Create .gitignore

## Step 3: [COMPLETE] Create SECURITY.md (DB role SQL, job examples)

Note: Prisma @@check not supported for raw SQL expressions; use raw SQL in migration or app validation for password length & ChatMessage constraint.

## Step 4: [COMPLETE] Generated migration `security_scalability_refactor` (run `npx prisma migrate deploy` in production)

## Step 5: [LATER] Implement background jobs (TopicScore sync, session cleanup cron)

## Step 6: [LATER] Test constraints/indexes, update .env for restricted role
