-- 페이백 전표와 그 원거래를 잇는다 (PAYBACK_DESIGN.md).
--
-- 페이백은 계좌 +X 와 원거래 줄의 분류 −X 로 서는 독립된 전표다. 이 링크는 분석이 그
-- 금액을 원거래의 날짜(달)로 옮겨 세는 데만 쓴다. 잔액·원장은 링크 없이 맞는다.
--
-- 원거래를 지우면 링크만 빈다(SET NULL). 이미 들어온 돈의 기록은 남는다. 그 UPDATE 에
-- JournalEntry 의 sync_stamp 트리거가 걸려 페이백 전표의 번호가 오르므로, 기기도 빈
-- 링크를 받아 간다.
--
-- 줄(paybackOfLineKey)에는 외래 키를 걸지 않는다. 원거래를 고치면 다리가 새로 만들어진다.

ALTER TABLE "JournalEntry" ADD COLUMN "paybackOfEntryId" TEXT,
ADD COLUMN "paybackOfLineKey" TEXT;

CREATE INDEX "JournalEntry_paybackOfEntryId_idx" ON "JournalEntry"("paybackOfEntryId");

ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_paybackOfEntryId_fkey" FOREIGN KEY ("paybackOfEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
