-- CreateTable
CREATE TABLE "topic_votes" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topic_votes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "topic_votes_topicId_idx" ON "topic_votes"("topicId");

-- CreateIndex
CREATE INDEX "topic_votes_userId_idx" ON "topic_votes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "topic_votes_topicId_userId_key" ON "topic_votes"("topicId", "userId");

-- AddForeignKey
ALTER TABLE "topic_votes" ADD CONSTRAINT "topic_votes_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_votes" ADD CONSTRAINT "topic_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
