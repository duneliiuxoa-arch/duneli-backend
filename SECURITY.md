# Duneli Database Security & Configuration

## 1. Database Security - Restricted Role

**SQL to create restricted app role (run as superuser):**

```sql
-- Create database if not exists
CREATE DATABASE duneli_app;

-- Create restricted role
CREATE ROLE duneli_app WITH 
  LOGIN 
  PASSWORD 'your_secure_password'
  NOSUPERUSER 
  INHERIT 
  NOCREATEDB 
  NOCREATEROLE 
  NOREPLICATION;

-- Grant connect to database
GRANT CONNECT ON DATABASE duneli_app TO duneli_app;

-- Grant usage on schema
GRANT USAGE ON SCHEMA public TO duneli_app;

-- Grant permissions on tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO duneli_app;
GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA public TO duneli_app;

-- Default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO duneli_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO duneli_app;
```

**Update .env:**
```
DATABASE_URL="postgresql://duneli_app:your_secure_password@localhost:5432/duneli_app?schema=public"
```

## 2. Session Cleanup (run periodically)

```sql
DELETE FROM "Session" WHERE expiresAt < NOW();
```

## 3. TopicScore Sync Background Job (Node.js example with node-cron)

Install: `npm i node-cron`

```js
const { PrismaClient } = require('@prisma/client');
const cron = require('node-cron');

const prisma = new PrismaClient();

cron.schedule('0 */6 * * *', async () => {  // Every 6 hours
  const topics = await prisma.topic.findMany({ where: { deletedAt: null } });
  
  for (const topic of topics) {
    const voteCount = await prisma.topicVote.count({ where: { topicId: topic.id } });
    const messageCount = await prisma.chatMessage.count({ 
      where: { topicId: topic.id, deletedAt: null } 
    });
    const meetingJoins = await prisma.meetingAttendee.count({ 
      where: { 
        meeting: { topicId: topic.id },
        leftAt: null 
      } 
    });
    
    const score = (voteCount * 3 + messageCount * 1 + meetingJoins * 5) / 10;
    
    await prisma.topicScore.upsert({
      where: { topicId: topic.id },
      update: { 
        voteCount, messageCount, meetingJoins, score,
        calculatedAt: new Date(),
        updatedAt: new Date()
      },
      create: { 
        topicId: topic.id, voteCount, messageCount, meetingJoins, score 
      }
    });
  }
});
```

## 4. Audit Logging Usage

Log actions in app code:
```js
await prisma.auditLog.create({
  data: {
    userId: user.id,
    action: 'TOPIC_CREATED',
    resource: 'Topic',
    resourceId: topic.id,
    details: { title: topic.title }
  }
});
```

## 5. Prisma Connection Pooling (.env)
```
DATABASE_URL="postgresql://...?connection_limit=20&pool_timeout=10"

