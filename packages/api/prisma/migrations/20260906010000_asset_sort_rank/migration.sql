-- 자산 목록의 순서를 정수에서 분수 색인으로 옮긴다.
--
-- 정수 순번은 한 항목을 옮기면 뒤가 전부 밀린다. 그러면 순서를 바꿀 때마다 목록 전체를
-- 다시 써야 하고, 오프라인에서 두 사람이 각자 옮기면 나중에 도착한 쪽이 상대의 이동까지
-- 통째로 덮는다 (설계 문서의 D5). 분수 색인은 이웃 사이에 값을 끼워 넣어 **한 줄만**
-- 고친다.
--
-- 글자는 0-9A-Za-z 예순둘이고 사전순이 곧 목록 순서다 (@money/types 의 rank).
-- 지금 순서를 그대로 옮기기 위해 한 자리씩 고르게 벌려 넣는다. 예순이 넘는 목록은
-- 두 자리로 이어 붙인다 -- 사전순이 유지되도록 앞자리는 z 로 채운다.
ALTER TABLE "Person" ADD COLUMN "sortRank" TEXT NOT NULL DEFAULT 'V';
ALTER TABLE "Account" ADD COLUMN "sortRank" TEXT NOT NULL DEFAULT 'V';
ALTER TABLE "Card" ADD COLUMN "sortRank" TEXT NOT NULL DEFAULT 'V';

-- 지금의 차례(sortOrder, 같으면 만든 순)를 그대로 옮긴다.
CREATE OR REPLACE FUNCTION rank_at(idx INT) RETURNS TEXT AS $$
DECLARE
  digits TEXT := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
BEGIN
  -- 한 자리로 담을 수 있는 만큼은 사이를 벌려 둔다 (1, 2, 3... 이 아니라 한 칸씩 띄운다).
  IF idx < 30 THEN
    RETURN substr(digits, (idx + 1) * 2 + 1, 1);
  END IF;
  -- 그 뒤는 'z' + 한 자리. 앞자리가 z 라 언제나 위의 값들보다 뒤에 온다.
  RETURN 'z' || substr(digits, ((idx - 30) % 62) + 1, 1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

UPDATE "Person" p SET "sortRank" = rank_at(ordered.rank_index)
  FROM (
    SELECT id, (ROW_NUMBER() OVER (PARTITION BY "projectId" ORDER BY "sortOrder", "createdAt"))::INT - 1 AS rank_index
    FROM "Person"
  ) ordered
 WHERE p.id = ordered.id;

UPDATE "Account" a SET "sortRank" = rank_at(ordered.rank_index)
  FROM (
    SELECT id, (ROW_NUMBER() OVER (PARTITION BY "projectId", "ownerId" ORDER BY "sortOrder", "createdAt"))::INT - 1 AS rank_index
    FROM "Account"
  ) ordered
 WHERE a.id = ordered.id;

UPDATE "Card" c SET "sortRank" = rank_at(ordered.rank_index)
  FROM (
    SELECT id, (ROW_NUMBER() OVER (PARTITION BY "projectId", "paymentAccountId" ORDER BY "sortOrder", "createdAt"))::INT - 1 AS rank_index
    FROM "Card"
  ) ordered
 WHERE c.id = ordered.id;

DROP FUNCTION rank_at(INT);

-- 옛 컬럼과 색인은 지운다. 두 벌을 남기면 어느 쪽이 진짜 순서인지 알 수 없게 된다.
DROP INDEX IF EXISTS "Person_projectId_sortOrder_idx";
DROP INDEX IF EXISTS "Account_projectId_sortOrder_idx";
DROP INDEX IF EXISTS "Card_projectId_sortOrder_idx";
ALTER TABLE "Person" DROP COLUMN "sortOrder";
ALTER TABLE "Account" DROP COLUMN "sortOrder";
ALTER TABLE "Card" DROP COLUMN "sortOrder";

CREATE INDEX "Person_projectId_sortRank_idx" ON "Person"("projectId", "sortRank");
CREATE INDEX "Account_projectId_sortRank_idx" ON "Account"("projectId", "sortRank");
CREATE INDEX "Card_projectId_sortRank_idx" ON "Card"("projectId", "sortRank");
