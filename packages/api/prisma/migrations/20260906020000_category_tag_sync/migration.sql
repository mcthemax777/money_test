-- 분류와 태그도 오프라인에서 고칠 수 있게 한다 (3단계).
--
-- 자산 셋과 같은 두 가지를 더한다.
--   1. `fieldHlc` -- 필드별 병합의 시계 (이름과 색은 서로 얽힌 불변식이 없다).
--   2. `sortRank` -- 정수 순번 대신 분수 색인. 한 항목을 옮길 때 그 줄만 고친다.
--
-- 분류의 순서는 **같은 부모 안에서만** 뜻이 있어 부모별로 다시 매긴다. 태그는 프로젝트
-- 안에서 하나의 목록이다.
ALTER TABLE "Category" ADD COLUMN "fieldHlc" JSONB;
ALTER TABLE "Tag" ADD COLUMN "fieldHlc" JSONB;

ALTER TABLE "Category" ADD COLUMN "sortRank" TEXT NOT NULL DEFAULT 'V';
ALTER TABLE "Tag" ADD COLUMN "sortRank" TEXT NOT NULL DEFAULT 'V';

CREATE OR REPLACE FUNCTION rank_at(idx INT) RETURNS TEXT AS $$
DECLARE
  digits TEXT := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
BEGIN
  IF idx < 30 THEN
    RETURN substr(digits, (idx + 1) * 2 + 1, 1);
  END IF;
  RETURN 'z' || substr(digits, ((idx - 30) % 62) + 1, 1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

UPDATE "Category" c SET "sortRank" = rank_at(ordered.rank_index)
  FROM (
    SELECT id,
           (ROW_NUMBER() OVER (PARTITION BY "projectId", "parentId", "type"
                               ORDER BY "sortOrder", "createdAt"))::INT - 1 AS rank_index
    FROM "Category"
  ) ordered
 WHERE c.id = ordered.id;

UPDATE "Tag" t SET "sortRank" = rank_at(ordered.rank_index)
  FROM (
    SELECT id,
           (ROW_NUMBER() OVER (PARTITION BY "projectId" ORDER BY "sortOrder", "name"))::INT - 1 AS rank_index
    FROM "Tag"
  ) ordered
 WHERE t.id = ordered.id;

DROP FUNCTION rank_at(INT);

-- 옛 컬럼은 지운다. 두 벌을 남기면 어느 쪽이 진짜 순서인지 알 수 없게 된다.
ALTER TABLE "Category" DROP COLUMN "sortOrder";
ALTER TABLE "Tag" DROP COLUMN "sortOrder";

CREATE INDEX "Category_projectId_sortRank_idx" ON "Category"("projectId", "sortRank");
CREATE INDEX "Tag_projectId_sortRank_idx" ON "Tag"("projectId", "sortRank");
