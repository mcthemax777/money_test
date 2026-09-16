-- 이 거래를 카드 실적에 세는가. 카드로 낸 거래에만 뜻이 있다.
--
-- 실적과 청구액은 다른 값이다. 실적에서 빼도 갚을 대금은 그대로 남는다.
-- 지금까지의 거래는 모두 실적에 세고 있었으므로 기본값을 true 로 둔다.
ALTER TABLE "JournalEntry" ADD COLUMN "countsPerformance" BOOLEAN NOT NULL DEFAULT true;
