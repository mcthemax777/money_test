-- 오래된 명령 기록을 하루에 한 번 지울 때 쓰는 색인 (2026-10-25, MutationLogCleanupService 의 createdAt < 기준).
CREATE INDEX "MutationLog_createdAt_idx" ON "MutationLog"("createdAt");
