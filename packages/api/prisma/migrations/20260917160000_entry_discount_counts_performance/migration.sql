-- 차감·취소 금액을 카드 실적에서도 뺄지.
--
-- 다리에는 이미 깎인 뒤의 금액이 들어가 있어, 지금까지는 차감이 언제나 실적을 함께
-- 깎았다. 카드사가 환불을 실적에서 빼지 않는 경우가 있어 거래마다 고르게 한다.
-- 지금까지의 거래는 모두 차감이 실적에 반영되고 있었으므로 기본값을 true 로 둔다.
ALTER TABLE "JournalEntry" ADD COLUMN "discountCountsPerformance" BOOLEAN NOT NULL DEFAULT true;
