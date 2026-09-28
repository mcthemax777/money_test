-- 반복 등록과 보관함 후보에 이체의 받는 통장을 둔다.
--
-- 보내는 통장은 전처럼 accountId 다. 옛 행은 이체가 없었으므로 비어 있다.
ALTER TABLE "RecurringRule" ADD COLUMN "toAccountId" TEXT;
ALTER TABLE "EntryDraft" ADD COLUMN "toAccountId" TEXT;
