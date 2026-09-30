-- 태그 예산을 태그마다 하나로. 지출·수입으로 가르지 않는다.
--
-- 사용액이 "지출 − 수입"이라 한 금액으로 견준다. 앞 판(20261001100000)은 한 태그에
-- 지출 예산과 수입 목표를 따로 두었다.

-- 같은 태그·같은 시작 달에 둘이 있으면 지출 쪽을 남긴다. 둘을 합치면 뜻이 없는 금액이 된다.
DELETE FROM "Budget" b
 WHERE b."tagId" IS NOT NULL
   AND b."type" = 'income'
   AND EXISTS (
     SELECT 1 FROM "Budget" o
      WHERE o."tagId" = b."tagId"
        AND o."type" = 'expense'
        AND o."effectiveFrom" IS NOT DISTINCT FROM b."effectiveFrom"
   );

UPDATE "Budget" SET "type" = NULL WHERE "tagId" IS NOT NULL;

-- 한 태그에 같은 달부터 시작하는 규칙은 하나. 기본 유일 조건은 null 을 서로 다르게 보아
-- (type·effectiveFrom 이 null 이다) 막지 못하므로 따로 건다.
CREATE UNIQUE INDEX "Budget_tag_rule_key"
  ON "Budget"("tagId", COALESCE("effectiveFrom", ''))
  WHERE "tagId" IS NOT NULL;
