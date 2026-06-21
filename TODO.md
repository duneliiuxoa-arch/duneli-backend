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

## Step 4: [COMPLETE] Generated migration `security_scalability_refactor` (run `npx prisma migrate deploy` in production)

## Step 5: [COMPLETE] Security middleware added to server.js
- helmet (secure HTTP headers)
- cors (origin restriction via ALLOWED_ORIGIN env var)
- express-rate-limit (100 req / 15 min per IP)
- 404 handler and global error handler added
- cors, helmet, express-rate-limit added to package.json dependencies

## Step 6: [COMPLETE] DEPLOYMENT.md secret redacted
- Exposed SESSION_SECRET removed and replaced with generation instructions
- Added ALLOWED_ORIGIN to .env.example

## Step 7: [NEXT] Install new dependencies
Run: npm install
(Installs cors, helmet, express-rate-limit)

## Step 8: [NEXT] Set up restricted DB role in production
- Run prisma/sql/setup_restricted_role.sql as postgres superuser
- Update DATABASE_URL in production env to use duneli_app role (not superuser)

## Step 9: [NEXT] Build API routes
- Create routes/ directory
- Add at minimum: auth routes, topic routes
- Wire into server.js

## Step 10: [LATER] Test background jobs (TopicScore sync, session cleanup cron)
- Verify scheduler.js fires correctly in production
- Check sessionCleanup and topicScoreSync with real data

## Note
Prisma @@check not supported for raw SQL expressions; use raw SQL in migration
or app validation for password length & ChatMessage constraint.
