# Duneli Database Design
*Last updated: 2026-03-20 — fully synced with Prisma schema (12 models)*

---

## Overview

Duneli is a discussion-and-voting platform on **PostgreSQL** via **Prisma ORM**.
Users create topics, vote on them, and the top-scored topic becomes a scheduled
Meeting. After the meeting a Post (summary article) is published. Engagement is
tracked through likes, views, chat messages, and attendance records.

**Stack:** PostgreSQL 16 · Prisma ORM · Node.js · bcrypt · node-cron

---

## Data Lifecycle Policy

| Category  | Tables                                                              | Retention              |
|-----------|---------------------------------------------------------------------|------------------------|
| Permanent | User, Meeting, Post, PostView, PostLike, MeetingAttendee, AuditLog | Never deleted          |
| Temporary | Topic, TopicVote, TopicScore, ChatMessage                           | Clearable daily/weekly |
| Utility   | Session                                                             | Purged when expired    |

---

## Enumerations

| Enum          | Values                          | Notes                                |
|---------------|---------------------------------|--------------------------------------|
| UserRole      | USER, ADMIN                     | ADMIN can manage topics and meetings |
| TopicStatus   | ACTIVE, CLOSED, SELECTED        | SELECTED triggers Meeting creation   |
| MeetingStatus | SCHEDULED, COMPLETED, CANCELLED |                                      |


---

## Entity Relationship Diagram

```
┌──────────┐     creates      ┌──────────┐   1:1   ┌─────────────┐
│   User   │ ───────────────► │  Topic   │ ──────► │ TopicScore  │
└──────────┘                  └──────────┘         └─────────────┘
     │  │                          │
     │  │  votes                   │ 1:1  (SELECTED only)
     │  └──────────► TopicVote     │
     │               (unique per   ▼
     │                user+topic) ┌──────────┐   1:1   ┌──────┐
     │                            │ Meeting  │ ──────► │ Post │
     │  attends                   └──────────┘         └──────┘
     └──────────► MeetingAttendee      │                  │  │
                  (unique per          │ chat        views│  │likes
                   user+meeting)       ▼                  ▼  ▼
                                  ChatMessage        PostView PostLike
                                  (topicId OR        (unique) (unique)
                                   meetingId)

AuditLog ──► User
Session  ──► User
```

**ChatMessage constraint (enforced via SQL CHECK):**
Every message must set exactly one parent — either `topicId` (discussion) or
`meetingId` (live meeting chat). Both null is rejected. Both set is rejected.

---

## Table Reference

### User
Stores permanent user accounts.

| Column    | Type      | Notes                                          |
|-----------|-----------|------------------------------------------------|
| id        | String    | UUID, primary key                              |
| name      | String    | Display name                                   |
| email     | String    | Unique — used for login                        |
| password  | String    | bcrypt hash (min 60 chars)                     |
| role      | UserRole  | USER or ADMIN, default USER                    |
| isActive  | Boolean   | false = account disabled (not deleted)         |
| createdAt | DateTime  |                                                |
| updatedAt | DateTime  |                                                |
| deletedAt | DateTime? | Soft delete — null means active                |

**Indexes:** email, role, deletedAt


### Topic
Temporary — discussion topics created by users or admin.

| Column      | Type        | Notes                                         |
|-------------|-------------|-----------------------------------------------|
| id          | String      | UUID, primary key                             |
| title       | String      |                                               |
| description | String?     | Optional long text                            |
| status      | TopicStatus | ACTIVE → CLOSED or SELECTED                   |
| createdById | String      | FK → User (RESTRICT)                          |
| createdAt   | DateTime    |                                               |
| updatedAt   | DateTime    |                                               |

**Indexes:** createdById, status, createdAt, (status + createdAt) composite

---

### TopicVote
One vote per user per topic. Temporary — cleared with topics.

| Column    | Type     | Notes                      |
|-----------|----------|----------------------------|
| id        | String   | CUID, primary key          |
| topicId   | String   | FK → Topic (RESTRICT)      |
| userId    | String   | FK → User (RESTRICT)       |
| createdAt | DateTime |                            |
| updatedAt | DateTime |                            |

**Unique constraint:** (topicId, userId) — prevents duplicate votes
**Indexes:** topicId, userId

---

### TopicScore
Computed score per topic — auto-updated by SQL triggers.

| Column       | Type     | Notes                                          |
|--------------|----------|------------------------------------------------|
| id           | String   | UUID, primary key                              |
| topicId      | String   | Unique FK → Topic (RESTRICT)                   |
| score        | Float    | = voteCount×3 + messageCount×1 + joins×5       |
| voteCount    | Int      | Updated by vote_count_trigger                  |
| messageCount | Int      | Updated by message_count_trigger               |
| meetingJoins | Int      | Updated by meeting_join_trigger                |
| calculatedAt | DateTime |                                                |
| updatedAt    | DateTime |                                                |

**Triggers defined in:** `prisma/migrations/20260320000002_topic_score_triggers/`
**Sync job (drift correction):** `prisma/src/jobs/topicScoreSync.js` (every 6h)


### Meeting
Permanent record created when a Topic reaches SELECTED status.

| Column      | Type          | Notes                         |
|-------------|---------------|-------------------------------|
| id          | String        | UUID, primary key             |
| topicId     | String        | Unique FK → Topic (RESTRICT)  |
| meetingDate | DateTime      | Scheduled date/time           |
| status      | MeetingStatus | SCHEDULED / COMPLETED / CANCELLED |
| createdAt   | DateTime      |                               |
| updatedAt   | DateTime      |                               |

**Indexes:** topicId, meetingDate, status, createdAt

---

### MeetingAttendee
Tracks which users joined which meeting and when they left.

| Column    | Type      | Notes                              |
|-----------|-----------|------------------------------------|
| id        | String    | CUID, primary key                  |
| meetingId | String    | FK → Meeting (RESTRICT)            |
| userId    | String    | FK → User (RESTRICT)               |
| joinedAt  | DateTime  | Auto-set on creation               |
| leftAt    | DateTime? | Null while still in the meeting    |
| updatedAt | DateTime  |                                    |

**Unique constraint:** (meetingId, userId)
**Indexes:** meetingId, userId, (meetingId + joinedAt) composite

---

### Post
Summary article published after a meeting. One-to-one with Meeting.

| Column    | Type      | Notes                         |
|-----------|-----------|-------------------------------|
| id        | String    | UUID, primary key             |
| title     | String    |                               |
| content   | String    | Long text                     |
| meetingId | String    | Unique FK → Meeting (RESTRICT)|
| createdAt | DateTime  |                               |
| updatedAt | DateTime  |                               |
| deletedAt | DateTime? | Soft delete                   |

**Indexes:** meetingId


### PostView
Tracks unique post views per user.

| Column    | Type     | Notes                              |
|-----------|----------|------------------------------------|
| id        | String   | CUID, primary key                  |
| postId    | String   | FK → Post (RESTRICT)               |
| userId    | String   | FK → User (RESTRICT)               |
| viewedAt  | DateTime |                                    |
| updatedAt | DateTime |                                    |

**Unique constraint:** (postId, userId)
**Indexes:** postId, userId

---

### PostLike
Tracks unique post likes per user.

| Column    | Type     | Notes                              |
|-----------|----------|------------------------------------|
| id        | String   | CUID, primary key                  |
| postId    | String   | FK → Post (RESTRICT)               |
| userId    | String   | FK → User (RESTRICT)               |
| createdAt | DateTime |                                    |
| updatedAt | DateTime |                                    |

**Unique constraint:** (postId, userId)
**Indexes:** postId, userId

---

### ChatMessage
Messages in topic discussions or live meeting chats. Soft-deletable.

| Column    | Type      | Notes                                               |
|-----------|-----------|-----------------------------------------------------|
| id        | String    | CUID, primary key                                   |
| userId    | String    | FK → User (RESTRICT)                                |
| topicId   | String?   | FK → Topic (RESTRICT) — set for discussion chat     |
| meetingId | String?   | FK → Meeting (RESTRICT) — set for meeting chat      |
| message   | String    | Long text                                           |
| createdAt | DateTime  |                                                     |
| deletedAt | DateTime? | Soft delete — null means visible                    |

**CHECK constraint (SQL):** `topicId IS NOT NULL OR meetingId IS NOT NULL`
Applied in migration `20260320000001_chat_message_constraint`.
**Indexes:** userId, topicId, meetingId, createdAt, (userId+createdAt), (topicId+createdAt), (meetingId+createdAt)


### Session
Auth sessions — stores only the bcrypt hash of the token, never the raw value.

| Column    | Type     | Notes                                     |
|-----------|----------|-------------------------------------------|
| id        | String   | CUID, primary key                         |
| userId    | String   | FK → User (RESTRICT)                      |
| tokenHash | String   | Unique bcrypt hash of the session token   |
| expiresAt | DateTime | Cleanup job runs weekly (Sunday 02:00 AM) |
| createdAt | DateTime |                                           |
| updatedAt | DateTime |                                           |

**Indexes:** userId, tokenHash
**Cleanup job:** `prisma/src/jobs/sessionCleanup.js`

---

### AuditLog
Permanent security trail of all significant actions.

| Column     | Type     | Notes                                          |
|------------|----------|------------------------------------------------|
| id         | String   | UUID, primary key                              |
| userId     | String   | FK → User (RESTRICT)                           |
| action     | String   | e.g. TOPIC_CREATED, USER_LOGIN, POST_DELETED   |
| resource   | String   | Table/model name, e.g. "Topic"                 |
| resourceId | String?  | ID of the affected record                      |
| details    | Json?    | Extra context (title, old values, etc.)        |
| ipAddress  | String?  |                                                |
| userAgent  | String?  |                                                |
| createdAt  | DateTime |                                                |
| updatedAt  | DateTime |                                                |

**Indexes:** userId, createdAt, action

---

## All Indexes Summary

| Table             | Index / Constraint                           | Purpose                          |
|-------------------|----------------------------------------------|----------------------------------|
| users             | email (unique)                               | Login lookup                     |
| users             | role                                         | Admin filtering                  |
| users             | deletedAt                                    | Exclude soft-deleted             |
| topics            | createdById                                  | User's topics                    |
| topics            | status                                       | Filter ACTIVE/CLOSED             |
| topics            | createdAt                                    | Sort by date                     |
| topics            | (status, createdAt)                          | Paginated active topic list      |
| topic_votes       | topicId, userId                              | Lookup votes                     |
| topic_votes       | UNIQUE(topicId, userId)                      | Prevent duplicate votes          |
| topic_scores      | topicId (unique), calculatedAt               | Score lookup                     |
| meetings          | topicId, meetingDate, status, createdAt      | Meeting queries                  |
| meeting_attendees | meetingId, userId                            | Attendance lookup                |
| meeting_attendees | UNIQUE(meetingId, userId)                    | Prevent duplicate attendance     |
| meeting_attendees | (meetingId, joinedAt)                        | Attendance timeline              |
| posts             | meetingId (unique)                           | Post lookup from meeting         |
| post_views        | postId, userId                               | View lookup                      |
| post_views        | UNIQUE(postId, userId)                       | Prevent duplicate views          |
| post_likes        | postId, userId                               | Like lookup                      |
| post_likes        | UNIQUE(postId, userId)                       | Prevent duplicate likes          |
| chat_messages     | userId, topicId, meetingId, createdAt        | Message queries                  |
| chat_messages     | (userId, createdAt)                          | User message history             |
| chat_messages     | (topicId, createdAt)                         | Topic chat timeline              |
| chat_messages     | (meetingId, createdAt)                       | Meeting chat timeline            |
| chat_messages     | CHECK topicId OR meetingId not null          | Data integrity                   |
| sessions          | tokenHash (unique), userId                   | Auth token lookup                |
| audit_logs        | userId, createdAt, action                    | Audit queries                    |


---

## Background Jobs

| Job               | File                              | Schedule         | Purpose                          |
|-------------------|-----------------------------------|------------------|----------------------------------|
| Session cleanup   | prisma/src/jobs/sessionCleanup.js | Weekly Sun 02:00 | Delete expired sessions          |
| TopicScore sync   | prisma/src/jobs/topicScoreSync.js | Every 6 hours    | Full score recalculation         |
| Scheduler (entry) | prisma/src/jobs/scheduler.js      | Import at startup| Registers both cron jobs         |

Import the scheduler in your server entry point:
```js
import './prisma/src/jobs/scheduler.js';
```

---

## Security Setup

See `prisma/sql/setup_restricted_role.sql` for the one-time setup SQL.

Steps:
1. Run `setup_restricted_role.sql` as the `postgres` superuser
2. Set `PGPASSWORD` as a Windows environment variable (not in any file)
3. Update `DATABASE_URL` in `.env` to use `duneli_app` role
4. For production, move secrets to Railway / AWS Secrets Manager (see `.env.example`)

---

## Useful Prisma Queries

### Get active topics ordered by score
```js
const topics = await prisma.topic.findMany({
  where: { status: 'ACTIVE', deletedAt: null },
  include: { topicScore: true, _count: { select: { votes: true } } },
  orderBy: { topicScore: { score: 'desc' } },
});
```

### Create meeting from selected topic (transaction)
```js
const meeting = await prisma.$transaction(async (tx) => {
  await tx.topic.update({
    where: { id: topicId },
    data: { status: 'SELECTED' },
  });
  return tx.meeting.create({
    data: { topicId, meetingDate: new Date(), status: 'SCHEDULED' },
  });
});
```

### Write an audit log entry
```js
await prisma.auditLog.create({
  data: {
    userId: user.id,
    action: 'TOPIC_CREATED',
    resource: 'Topic',
    resourceId: topic.id,
    details: { title: topic.title },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  },
});
```

### Soft-delete a user
```js
await prisma.user.update({
  where: { id: userId },
  data: { deletedAt: new Date(), isActive: false },
});
```

