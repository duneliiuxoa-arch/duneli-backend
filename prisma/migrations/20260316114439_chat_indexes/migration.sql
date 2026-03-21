-- CreateIndex
CREATE INDEX "chat_messages_topicId_createdAt_idx" ON "chat_messages"("topicId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_messages_meetingId_createdAt_idx" ON "chat_messages"("meetingId", "createdAt");
