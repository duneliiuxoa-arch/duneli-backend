-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "meetingId" TEXT,
ALTER COLUMN "topicId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "chat_messages_meetingId_idx" ON "chat_messages"("meetingId");

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
