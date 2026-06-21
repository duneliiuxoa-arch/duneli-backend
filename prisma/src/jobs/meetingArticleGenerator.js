// prisma/src/jobs/meetingArticleGenerator.js
// Meeting end hone par — chat messages se Claude AI article generate karo
// aur Dunora pe automatically publish karo

import prisma from '../../middleware/prismaClient.js';

const CLAUDE_API_KEY = process.env.ANTHROPIC_API_KEY;
const DUNORA_URL     = process.env.DUNORA_URL || 'http://localhost:3001';
const WEBHOOK_SECRET = process.env.DUNELI_WEBHOOK_SECRET;

// ── Main function — meeting complete hone par call karo ──────
export async function generateAndPublishArticle(meetingId) {
  console.log(`[articleGen] Starting for meeting: ${meetingId}`);

  try {
    // ── 1. Meeting + topic + chat data fetch karo ────────────
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        topic: {
          select: {
            id: true, title: true, description: true,
            topicScore: { select: { voteCount: true, messageCount: true } },
          },
        },
        chatMessages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: {
            message: true, createdAt: true, type: true,
            user: { select: { anonymousId: true, name: true } },
          },
        },
        attendees: {
          select: { userId: true },
        },
        post: { select: { id: true } }, // already published check
      },
    });

    if (!meeting) throw new Error(`Meeting ${meetingId} not found`);
    if (meeting.post) {
      console.log(`[articleGen] Article already published for meeting ${meetingId}`);
      return { skipped: true };
    }

    const topic         = meeting.topic;
    const messages      = meeting.chatMessages;
    const attendeeCount = meeting.attendees.length;

    // ── Transcript aur chat dono alag karo ───────────────────
    const transcriptLines = messages
      .filter(m => m.message.startsWith('[TRANSCRIPT]'))
      .map(m => m.message.replace('[TRANSCRIPT] ', ''));

    const chatLines = messages
      .filter(m => !m.message.startsWith('[TRANSCRIPT]'))
      .map(m => `[${m.user?.anonymousId || 'User'}]: ${m.message}`);

    // Transcript priority — agar available hai toh woh use karo
    const primaryContent = transcriptLines.length > 0
      ? `AUDIO TRANSCRIPT:\n${transcriptLines.join('\n')}`
      : `CHAT MESSAGES:\n${chatLines.join('\n')}`;

    console.log(`[articleGen] Transcript lines: ${transcriptLines.length} | Chat lines: ${chatLines.length}`);

    // ── 2. Claude AI se article generate karo ────────────────
    const article = await generateArticleWithClaude({
      topicTitle:      topic.title,
      topicDesc:       topic.description,
      primaryContent,  // transcript ya chat
      attendees:       attendeeCount,
      votes:           topic.topicScore?.voteCount ?? 0,
      meetingDate:     meeting.meetingDate,
      hasTranscript:   transcriptLines.length > 0,
    });

    console.log(`[articleGen] Article generated: "${article.title}"`);

    // ── 3. Duneli database mein Post save karo ────────────────
    const post = await prisma.post.create({
      data: {
        meetingId,
        title:   article.title,
        content: article.content,
      },
    });

    console.log(`[articleGen] Post saved in Duneli DB: ${post.id}`);

    // ── 4. Dunora pe publish karo ─────────────────────────────
    const dunoraRes = await fetch(`${DUNORA_URL}/api/articles`, {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-duneli-secret': WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        title:     article.title,
        content:   article.content,
        meetingId,
        topicId:   topic.id,
        tags:      article.tags,
        source:    'Duneli Discussion',
      }),
    });

    if (!dunoraRes.ok) {
      const err = await dunoraRes.json().catch(() => ({}));
      throw new Error(`Dunora publish failed: ${err.error || dunoraRes.status}`);
    }

    const { article: dunoraArticle } = await dunoraRes.json();
    console.log(`[articleGen] ✅ Published on Dunora: ${dunoraArticle?.id}`);

    return {
      success:       true,
      postId:        post.id,
      dunoraId:      dunoraArticle?.id,
      title:         article.title,
    };

  } catch (err) {
    console.error(`[articleGen] ❌ Failed for meeting ${meetingId}:`, err.message);
    throw err;
  }
}

// ── Claude AI article generator ───────────────────────────────
async function generateArticleWithClaude({ topicTitle, topicDesc, primaryContent, attendees, votes, meetingDate, hasTranscript }) {

  const dateStr = new Date(meetingDate).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const prompt = `You are an expert journalist for Dunora, an intellectual discussion platform.

A live ${hasTranscript ? 'audio discussion' : 'text discussion'} just ended on Duneli. Summarize it into a compelling article.

**Topic:** ${topicTitle}
${topicDesc ? `**Description:** ${topicDesc}` : ''}
**Date:** ${dateStr}
**Participants:** ${attendees} people
**Interest votes:** ${votes}

**${hasTranscript ? 'Audio Transcript (verbatim spoken words)' : 'Chat Messages'}:**
${primaryContent.slice(0, 6000)}${primaryContent.length > 6000 ? '\n...[truncated]' : ''}

Write a comprehensive article (400-600 words) that:
1. Has a compelling headline
2. Captures the key arguments and perspectives from the ${hasTranscript ? 'spoken discussion' : 'discussion'}
3. Highlights interesting viewpoints and debates
4. Concludes with takeaways

Return ONLY valid JSON (no markdown):
{
  "title": "Headline here",
  "content": "Full article (use \\n\\n for paragraphs)",
  "tags": ["tag1", "tag2", "tag3"]
}`;

  if (!CLAUDE_API_KEY) {
    // Fallback — no API key, generate basic article
    console.warn('[articleGen] No ANTHROPIC_API_KEY — using fallback generator');
    return generateFallbackArticle({ topicTitle, messages, attendees, votes, dateStr });
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 1500,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Claude API error: ${err.error?.message || res.status}`);
  }

  const data    = await res.json();
  const rawText = data.content?.[0]?.text || '';

  try {
    // Clean JSON response
    const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    // JSON parse fail — extract manually
    console.warn('[articleGen] JSON parse failed, using raw text as content');
    return {
      title:   `Discussion Summary: ${topicTitle}`,
      content: rawText,
      tags:    [topicTitle, 'Discussion', 'Duneli'],
    };
  }
}

// ── Fallback article generator (no Claude API) ────────────────
function generateFallbackArticle({ topicTitle, messages, attendees, votes, dateStr }) {
  const keyMessages = messages.slice(0, 5).map(m => `• ${m.message}`).join('\n');

  const content = `A live discussion on "${topicTitle}" was held on ${dateStr} on Duneli, bringing together ${attendees} participants who collectively cast ${votes} interest votes before the session.

The discussion explored various perspectives on the topic, with participants sharing ideas and engaging in thoughtful debate.

${messages.length > 0 ? `Key points from the discussion:\n${keyMessages}` : 'The discussion covered multiple dimensions of the topic.'}

This session was part of Duneli's ongoing mission to create a platform where ideas compete, not people. The discussion format allowed participants to express their views anonymously, fostering open and honest dialogue.

*This article was automatically generated from the Duneli live discussion.*`;

  return {
    title:   `Duneli Discussion: ${topicTitle}`,
    content,
    tags:    [topicTitle, 'Discussion', 'Duneli', 'Live Session'],
  };
}
