// prisma/src/jobs/meetingSummarizer.js
// Meeting end hone pe → AI summary → Dunora pe auto-publish

import prisma from '../../middleware/prismaClient.js';

const DUNORA_URL      = process.env.DUNORA_URL || 'https://dunora.vercel.app';
const WEBHOOK_SECRET  = process.env.DUNELI_WEBHOOK_SECRET;
const CLAUDE_API_KEY  = process.env.CLAUDE_API_KEY;

// ── Main function — meeting summarize + publish ───────────────
export async function summarizeAndPublish(meetingId) {
  console.log(`[summarizer] Starting for meeting: ${meetingId}`);

  try {
    // ── 1. Meeting + topic + chat messages fetch karo ────────
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      select: {
        id: true,
        meetingDate: true,
        topic: {
          select: { id: true, title: true, description: true },
        },
        attendees: {
          select: { userId: true, joinedAt: true, leftAt: true },
        },
        chatMessages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: {
            message: true,
            createdAt: true,
            sender: { select: { anonymousId: true, name: true } },
          },
        },
        _count: { select: { attendees: true, chatMessages: true } },
      },
    });

    if (!meeting) throw new Error(`Meeting ${meetingId} not found`);
    if (!meeting.topic) throw new Error('Meeting has no topic');

    const topic       = meeting.topic;
    const messages    = meeting.chatMessages;
    const attendees   = meeting._count.attendees;
    const msgCount    = meeting._count.chatMessages;
    const duration    = meeting.attendees.length > 0
      ? Math.round((new Date() - new Date(meeting.meetingDate)) / 60000)
      : 60;

    console.log(`[summarizer] Topic: "${topic.title}" | Messages: ${msgCount} | Attendees: ${attendees}`);

    // ── 2. AI se article generate karo ───────────────────────
    const article = await generateAIArticle({
      topicTitle:       topic.title,
      topicDescription: topic.description,
      messages,
      attendees,
      duration,
      meetingDate:      meeting.meetingDate,
    });

    // ── 3. Duneli DB mein Post save karo ─────────────────────
    const post = await prisma.post.create({
      data: {
        meetingId: meeting.id,
        title:     article.title,
        content:   article.content,
      },
      select: { id: true },
    });

    console.log(`[summarizer] Post saved: ${post.id}`);

    // ── 4. Dunora pe webhook bhejo → article publish ──────────
    await publishToDunora({
      title:     article.title,
      content:   article.content,
      tags:      article.tags,
      meetingId: meeting.id,
      topicId:   topic.id,
    });

    console.log(`[summarizer] ✅ Article published to Dunora for "${topic.title}"`);
    return { success: true, postId: post.id, title: article.title };

  } catch (err) {
    console.error(`[summarizer] ❌ Failed for meeting ${meetingId}:`, err.message);
    throw err;
  }
}

// ── AI Article Generator (Claude API) ────────────────────────
async function generateAIArticle({ topicTitle, topicDescription, messages, attendees, duration, meetingDate }) {

  // Chat transcript banao
  const transcript = messages.length > 0
    ? messages
        .map(m => `[${m.sender?.anonymousId || 'User'}]: ${m.message}`)
        .join('\n')
    : 'No messages recorded during this discussion.';

  // Claude API call
  if (CLAUDE_API_KEY) {
    try {
      const prompt = `You are an expert journalist summarizing a live discussion for an intellectual platform called Dunora.

DISCUSSION TOPIC: "${topicTitle}"
${topicDescription ? `DESCRIPTION: ${topicDescription}` : ''}
DATE: ${new Date(meetingDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
DURATION: ~${duration} minutes
PARTICIPANTS: ${attendees} people

CHAT TRANSCRIPT:
${transcript.slice(0, 8000)}

Write a well-structured article (400-600 words) summarizing this discussion. Include:
1. An engaging title
2. Key points and arguments raised
3. Different perspectives shared
4. Overall sentiment and conclusion
5. 3-5 relevant tags

Respond in this EXACT JSON format (no markdown, no backticks):
{
  "title": "Article title here",
  "content": "Full article content here (use paragraphs, no markdown)",
  "tags": ["tag1", "tag2", "tag3"]
}`;

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      'claude-sonnet-4-6',
          max_tokens: 2000,
          messages:   [{ role: 'user', content: prompt }],
        }),
      });

      const data = await res.json();
      const text = data.content?.[0]?.text || '';

      const parsed = JSON.parse(text.trim());
      if (parsed.title && parsed.content) {
        console.log('[summarizer] AI article generated ✅');
        return {
          title:   parsed.title,
          content: parsed.content,
          tags:    parsed.tags || [topicTitle, 'Discussion', 'Duneli'],
        };
      }
    } catch (err) {
      console.error('[summarizer] Claude API failed, using fallback:', err.message);
    }
  }

  // ── Fallback — template article (no API key) ─────────────
  console.log('[summarizer] Using fallback article template');
  const keyPoints = messages.slice(0, 5).map(m => `• ${m.message}`).join('\n');

  return {
    title:   `Discussion Summary: ${topicTitle}`,
    content: `A live discussion on "${topicTitle}" was held on Duneli with ${attendees} participants over approximately ${duration} minutes.

The conversation brought together diverse perspectives on this important topic. Participants engaged actively, sharing their thoughts and experiences.

${messages.length > 0 ? `Key points from the discussion:\n${keyPoints}` : 'The discussion covered various aspects of the topic in depth.'}

This session demonstrated the power of open dialogue in exploring complex ideas. The participants' varied backgrounds enriched the conversation, leading to a well-rounded exploration of the subject.

The discussion concluded with participants having gained new insights and perspectives on ${topicTitle}.`,
    tags: [topicTitle, 'Discussion', 'Duneli', 'Community'],
  };
}

// ── Publish to Dunora via webhook ─────────────────────────────
async function publishToDunora({ title, content, tags, meetingId, topicId }) {
  const DUNORA_API = `${DUNORA_URL}/api/articles`;

  const res = await fetch(DUNORA_API, {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      'x-duneli-secret': WEBHOOK_SECRET,
    },
    body: JSON.stringify({
      title,
      content,
      tags,
      meetingId,
      topicId,
      source: 'Duneli Live Discussion',
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Dunora publish failed: ${err.error || res.status}`);
  }

  return res.json();
}
