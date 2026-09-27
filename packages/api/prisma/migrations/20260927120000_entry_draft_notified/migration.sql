-- 후보의 푸시를 보냈는가 (알림 후보와 서버가 만든 반복 회차).
--
-- 푸시는 후보가 담기자마자 보내지 않고, 그 가계부가 조용해진 뒤 남은 후보만 한 번
-- 보낸다. 모으는 자리가 DB 여야 서버가 여럿이거나 다시 떠도 한 번만 나간다 -- 먼저
-- 이 칸을 채운 서버가 보낸다.
ALTER TABLE "EntryDraft" ADD COLUMN "notifiedAt" TIMESTAMP(3);

-- 이미 있는 후보는 보낸 것으로 친다. 비워 두면 배포하자마자 옛 후보가 한꺼번에 울린다.
UPDATE "EntryDraft" SET "notifiedAt" = "createdAt" WHERE "source" IN ('notification', 'recurring');

CREATE INDEX "EntryDraft_source_notifiedAt_idx" ON "EntryDraft"("source", "notifiedAt");
