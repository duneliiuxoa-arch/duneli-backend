-- =============================================================
-- Duneli TopicScore SQL Triggers (corrected)
-- Applied via: prisma/migrations/20260320000002_topic_score_triggers
-- Key fix: use COALESCE(NEW.x, OLD.x) so DELETE triggers work
--          correctly (NEW is NULL on DELETE, only OLD is set).
-- =============================================================

-- -----------------------------------------------
-- 1. VOTE COUNT TRIGGER
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION update_vote_count()
RETURNS TRIGGER AS $$
DECLARE
  t_id TEXT;
BEGIN
  t_id := COALESCE(NEW."topicId", OLD."topicId");

  UPDATE topic_scores
  SET
    "voteCount" = (SELECT COUNT(*) FROM topic_votes WHERE "topicId" = t_id),
    "score" = (
      (SELECT COUNT(*) FROM topic_votes   WHERE "topicId" = t_id) * 3 +
      (SELECT COUNT(*) FROM chat_messages WHERE "topicId" = t_id AND "deletedAt" IS NULL) +
      (SELECT COUNT(*) FROM meeting_attendees ma
        JOIN meetings m ON ma."meetingId" = m.id
        WHERE m."topicId" = t_id) * 5
    ),
    "updatedAt" = NOW()
  WHERE "topicId" = t_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS vote_count_trigger ON topic_votes;
CREATE TRIGGER vote_count_trigger
AFTER INSERT OR DELETE ON topic_votes
FOR EACH ROW EXECUTE FUNCTION update_vote_count();

-- -----------------------------------------------
-- 2. MESSAGE COUNT TRIGGER
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION update_message_count()
RETURNS TRIGGER AS $$
DECLARE
  t_id TEXT;
BEGIN
  t_id := COALESCE(NEW."topicId", OLD."topicId");
  IF t_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  UPDATE topic_scores
  SET
    "messageCount" = (
      SELECT COUNT(*) FROM chat_messages WHERE "topicId" = t_id AND "deletedAt" IS NULL
    ),
    "score" = (
      (SELECT COUNT(*) FROM topic_votes   WHERE "topicId" = t_id) * 3 +
      (SELECT COUNT(*) FROM chat_messages WHERE "topicId" = t_id AND "deletedAt" IS NULL) +
      (SELECT COUNT(*) FROM meeting_attendees ma
        JOIN meetings m ON ma."meetingId" = m.id
        WHERE m."topicId" = t_id) * 5
    ),
    "updatedAt" = NOW()
  WHERE "topicId" = t_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS message_count_trigger ON chat_messages;
CREATE TRIGGER message_count_trigger
AFTER INSERT OR DELETE ON chat_messages
FOR EACH ROW EXECUTE FUNCTION update_message_count();

-- -----------------------------------------------
-- 3. MEETING JOINS TRIGGER
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION update_meeting_joins()
RETURNS TRIGGER AS $$
DECLARE
  topic_id TEXT;
  m_id TEXT;
BEGIN
  m_id := COALESCE(NEW."meetingId", OLD."meetingId");
  SELECT "topicId" INTO topic_id FROM meetings WHERE id = m_id;
  IF topic_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  UPDATE topic_scores
  SET
    "meetingJoins" = (
      SELECT COUNT(*) FROM meeting_attendees ma
      JOIN meetings m ON ma."meetingId" = m.id
      WHERE m."topicId" = topic_id
    ),
    "score" = (
      (SELECT COUNT(*) FROM topic_votes   WHERE "topicId" = topic_id) * 3 +
      (SELECT COUNT(*) FROM chat_messages WHERE "topicId" = topic_id AND "deletedAt" IS NULL) +
      (SELECT COUNT(*) FROM meeting_attendees ma
        JOIN meetings m ON ma."meetingId" = m.id
        WHERE m."topicId" = topic_id) * 5
    ),
    "updatedAt" = NOW()
  WHERE "topicId" = topic_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS meeting_join_trigger ON meeting_attendees;
CREATE TRIGGER meeting_join_trigger
AFTER INSERT OR DELETE ON meeting_attendees
FOR EACH ROW EXECUTE FUNCTION update_meeting_joins();
