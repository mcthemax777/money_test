-- 할부 원거래의 환불이 회차마다 줄인 금액 (PAYBACK_DESIGN.md 7-9).
ALTER TABLE "JournalEntry" ADD COLUMN "installmentAdjust" JSONB;
