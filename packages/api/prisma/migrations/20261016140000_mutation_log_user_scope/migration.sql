-- 명령 기록의 순번 제약을 사람별로 좁힌다 (2026-10-16).
--
-- 예전에는 (clientId, clientSeq) 가 전역 유일이라, 남의 기기 id 를 아는 사람이 그 기기가 아직 쓰지 않은
-- 순번을 먼저 차지할 수 있었다(그 기기의 변경이 CLIENT_SEQ_TAKEN 으로 밀려 늦어진다).

-- 30일 넘은 기록은 지운다. 이 표는 다시 보낸 명령을 막는 데만 쓰고, 그만큼 늦게 다시 보내는 일은
-- 없다 -- 사용자 결정.
DELETE FROM "MutationLog" WHERE "createdAt" < NOW() - INTERVAL '30 days';

ALTER TABLE "MutationLog" ADD COLUMN "userId" TEXT;

-- 남은 행은 혼자 쓰는 가계부(구성원 하나)일 때만 그 사람으로 채운다. 함께 쓰는 가계부는 누가 보냈는지
-- 기록이 없다 -- 소유자로 채우면 다른 구성원의 재전송이 "남의 명령"으로 거절된다. 그래서 비워 둔다.
UPDATE "MutationLog" AS log
SET "userId" = member."userId"
FROM "ProjectMember" AS member
WHERE member."projectId" = log."projectId"
  AND (SELECT COUNT(*) FROM "ProjectMember" AS other WHERE other."projectId" = log."projectId") = 1;

DROP INDEX "MutationLog_clientId_clientSeq_key";
CREATE UNIQUE INDEX "MutationLog_userId_clientId_clientSeq_key" ON "MutationLog"("userId", "clientId", "clientSeq");
