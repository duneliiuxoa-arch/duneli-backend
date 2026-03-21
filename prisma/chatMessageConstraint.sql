ALTER TABLE chat_messages
ADD CONSTRAINT chat_message_parent_check
CHECK (
  "topicId" IS NOT NULL
  OR
  "meetingId" IS NOT NULL
);