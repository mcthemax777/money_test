-- 실적 여부는 전표에 되돌린다. 깎인 금액만 줄에 남는다.
--
-- 바로 앞 마이그레이션(20260919100000)이 셋을 한꺼번에 줄로 내렸다. 그중 둘은 줄에
-- 있을 값이 아니었다.
--
--   실적에 세는가        카드사가 보는 것은 승인 한 건이다. 한 결제를 분류로 나눴다고
--                        절반만 실적에 드는 일은 없다.
--   차감을 실적에서 뺄지 깎인 금액은 줄마다 다르지만, 그것을 실적에서 뺄지는 카드사의
--                        방침 하나다. 줄마다 갈릴 값이 아니다.
--
-- 깎인 금액(Posting.discountAmount)은 그대로 줄에 남는다. 여행경비만 환불받는 일은
-- 실제로 있고, 그것이 이 바꿈의 출발점이었다.

ALTER TABLE "JournalEntry" ADD COLUMN "countsPerformance" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "JournalEntry" ADD COLUMN "discountCountsPerformance" BOOLEAN NOT NULL DEFAULT true;

-- 첫 분류 줄의 값을 그 전표의 값으로 삼는다.
--
-- 앞 마이그레이션이 전표의 값을 모든 줄에 그대로 복사했으므로, 그 사이에 손으로 고친
-- 것이 없으면 어느 줄을 골라도 같다. 골라야 한다면 첫 줄이 가장 설명하기 쉽다.
UPDATE "JournalEntry" e
SET "countsPerformance" = COALESCE(p."countsPerformance", true),
    "discountCountsPerformance" = COALESCE(p."discountCountsPerformance", true)
FROM (
  SELECT DISTINCT ON ("entryId") "entryId", "countsPerformance", "discountCountsPerformance"
  FROM "Posting"
  WHERE "categoryId" IS NOT NULL
  ORDER BY "entryId", "id"
) p
WHERE p."entryId" = e."id";

ALTER TABLE "Posting" DROP COLUMN "countsPerformance";
ALTER TABLE "Posting" DROP COLUMN "discountCountsPerformance";
