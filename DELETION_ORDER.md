# Duneli — Deletion Order & Cascade Behaviour
*Last updated: 2026-03-20*

---

## Why This Document Exists

**Every foreign key in this database uses `onDelete: RESTRICT`.**

This means PostgreSQL will **refuse** to delete any row that is still referenced
by another table. You cannot delete a User who has topics; you cannot delete a
Topic that has votes; etc.

This is intentional — it prevents accidental data loss. But it means you must
delete (or soft-delete) records in the correct order, or the operation will
throw a foreign key violation error.

---

## Golden Rule

> Always delete children before parents.

---

## Full Deletion Order (deepest children first)

The order below is safe for hard deletes. For soft deletes, just set
`deletedAt = NOW()` on the target row — no child cleanup needed.

```
1.  AuditLog          (references User only)
2.  Session           (references User only)
3.  PostLike          (references Post + User)
4.  PostView          (references Post + User)
5.  Post              (references Meeting)
6.  ChatMessage       (references User + Topic? + Meeting?)
7.  MeetingAttendee   (references Meeting + User)
8.  TopicVote         (references Topic + User)
9.  TopicScore        (references Topic)
10. Meeting           (references Topic)
11. Topic             (references User)
12. User              (root — no parent)
```


---

## Deleting a User (full hard-delete sequence)

```js
await prisma.$transaction(async (tx) => {
  const userId = 'user-uuid-here';

  // 1. Audit logs
  await tx.auditLog.deleteMany({ where: { userId } });

  // 2. Sessions
  await tx.session.deleteMany({ where: { userId } });

  // 3. Post engagement (likes + views on posts written after meetings the user attended)
  await tx.postLike.deleteMany({ where: { userId } });
  await tx.postView.deleteMany({ where: { userId } });

  // 4. Chat messages
  await tx.chatMessage.deleteMany({ where: { userId } });

  // 5. Meeting attendance
  await tx.meetingAttendee.deleteMany({ where: { userId } });

  // 6. Topic votes
  await tx.topicVote.deleteMany({ where: { userId } });

  // 7. Topics created by user (cascade into their children first)
  const userTopics = await tx.topic.findMany({
    where: { createdById: userId },
    select: { id: true },
  });
  const topicIds = userTopics.map((t) => t.id);

  if (topicIds.length > 0) {
    await tx.chatMessage.deleteMany({ where: { topicId: { in: topicIds } } });
    await tx.topicVote.deleteMany({ where: { topicId: { in: topicIds } } });
    await tx.topicScore.deleteMany({ where: { topicId: { in: topicIds } } });

    // Meetings linked to user's topics
    const meetings = await tx.meeting.findMany({
      where: { topicId: { in: topicIds } },
      select: { id: true },
    });
    const meetingIds = meetings.map((m) => m.id);

    if (meetingIds.length > 0) {
      await tx.chatMessage.deleteMany({ where: { meetingId: { in: meetingIds } } });
      await tx.meetingAttendee.deleteMany({ where: { meetingId: { in: meetingIds } } });

      // Posts linked to those meetings
      const posts = await tx.post.findMany({
        where: { meetingId: { in: meetingIds } },
        select: { id: true },
      });
      const postIds = posts.map((p) => p.id);

      if (postIds.length > 0) {
        await tx.postLike.deleteMany({ where: { postId: { in: postIds } } });
        await tx.postView.deleteMany({ where: { postId: { in: postIds } } });
        await tx.post.deleteMany({ where: { id: { in: postIds } } });
      }

      await tx.meeting.deleteMany({ where: { id: { in: meetingIds } } });
    }

    await tx.topic.deleteMany({ where: { id: { in: topicIds } } });
  }

  // 8. Finally delete the user
  await tx.user.delete({ where: { id: userId } });
});
```


---

## Recommended Approach: Soft Delete Instead

For most situations, **prefer soft delete** over hard delete.
It avoids all cascade complexity, preserves audit history, and is reversible.

```js
// Soft-delete a user — no child records touched
await prisma.user.update({
  where: { id: userId },
  data: { deletedAt: new Date(), isActive: false },
});

// Soft-delete a topic
await prisma.topic.update({
  where: { id: topicId },
  data: { deletedAt: new Date() },
});

// Soft-delete a chat message
await prisma.chatMessage.update({
  where: { id: messageId },
  data: { deletedAt: new Date() },
});
```

Always filter soft-deleted records in queries:
```js
where: { deletedAt: null }
```

---

## Deleting a Topic (standalone)

```js
await prisma.$transaction(async (tx) => {
  const topicId = 'topic-uuid-here';

  await tx.chatMessage.deleteMany({ where: { topicId } });
  await tx.topicVote.deleteMany({ where: { topicId } });
  await tx.topicScore.deleteMany({ where: { topicId } });

  // If a meeting exists for this topic, delete it too
  const meeting = await tx.meeting.findUnique({ where: { topicId } });
  if (meeting) {
    await tx.chatMessage.deleteMany({ where: { meetingId: meeting.id } });
    await tx.meetingAttendee.deleteMany({ where: { meetingId: meeting.id } });
    const post = await tx.post.findUnique({ where: { meetingId: meeting.id } });
    if (post) {
      await tx.postLike.deleteMany({ where: { postId: post.id } });
      await tx.postView.deleteMany({ where: { postId: post.id } });
      await tx.post.delete({ where: { id: post.id } });
    }
    await tx.meeting.delete({ where: { id: meeting.id } });
  }

  await tx.topic.delete({ where: { id: topicId } });
});
```

---

## Foreign Key Map (quick reference)

| Child table        | References         | onDelete  |
|--------------------|--------------------|-----------|
| topics             | users              | RESTRICT  |
| topic_votes        | topics, users      | RESTRICT  |
| topic_scores       | topics             | RESTRICT  |
| meetings           | topics             | RESTRICT  |
| meeting_attendees  | meetings, users    | RESTRICT  |
| posts              | meetings           | RESTRICT  |
| post_views         | posts, users       | RESTRICT  |
| post_likes         | posts, users       | RESTRICT  |
| chat_messages      | users, topics?, meetings? | RESTRICT |
| sessions           | users              | RESTRICT  |
| audit_logs         | users              | RESTRICT  |

All `RESTRICT` — no automatic cascade deletions anywhere in this database.
