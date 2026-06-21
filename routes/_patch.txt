    const topics = await prisma.topic.findMany({
      where: whereClause,
      orderBy: [
        { topicScore: { score: 'desc' } },
        { createdAt: 'desc' },
      ],
      take: Math.min(Number(limit), 50),
      skip: Number(offset),
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        createdAt: true,
        createdBy: {
          select: { id: true, name: true, anonymousId: true, avatarUrl: true },
        },
        topicScore: {
          select: { score: true, voteCount: true, messageCount: true, meetingJoins: true },
        },
        meeting: {
          select: {
            id: true,
            meetingDate: true,
            status: true,
            _count: { select: { attendees: true } },
          },
        },
        _count: {
          select: { votes: true, chatMessages: true },
        },
      },
    });

    // ── Real-time active attendees: leftAt IS NULL means still in session ──
    const meetingIds = topics.map(t => t.meeting?.id).filter(Boolean);
    const activeCountsRaw = meetingIds.length > 0
      ? await prisma.meetingAttendee.groupBy({
          by: ['meetingId'],
          where: { meetingId: { in: meetingIds }, leftAt: null },
          _count: { id: true },
        })
      : [];
    const activeCountMap = Object.fromEntries(
      activeCountsRaw.map(r => [r.meetingId, r._count.id])
    );

    // If logged in, check which topics user has voted on
    let userVotedTopicIds = new Set();
    if (userId) {
      const userVotes = await prisma.topicVote.findMany({
        where: { userId, topicId: { in: topics.map(t => t.id) } },
        select: { topicId: true },
      });
      userVotedTopicIds = new Set(userVotes.map(v => v.topicId));
    }

    const topicsWithVote = topics.map(t => ({
      ...t,
      hasUserVoted: userVotedTopicIds.has(t.id),
      voteCount: t.topicScore?.voteCount ?? t._count.votes,
      // activeAttendees = real-time users currently in session (leftAt is null)
      activeAttendees: t.meeting?.id ? (activeCountMap[t.meeting.id] ?? 0) : 0,
    }));