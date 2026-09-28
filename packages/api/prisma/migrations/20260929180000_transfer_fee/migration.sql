-- 반복 등록과 보관함 후보에 이체 수수료를 둔다.
--
-- 거래의 수수료처럼 금액과 그 분류(지출 분류) 한 짝이다. 이체에만 있고 옛 행은 비어 있다.
ALTER TABLE "RecurringRule" ADD COLUMN "feeAmount" DECIMAL(18,4);
ALTER TABLE "RecurringRule" ADD COLUMN "feeCategoryId" TEXT;
ALTER TABLE "EntryDraft" ADD COLUMN "feeAmount" DECIMAL(18,4);
ALTER TABLE "EntryDraft" ADD COLUMN "feeCategoryId" TEXT;
