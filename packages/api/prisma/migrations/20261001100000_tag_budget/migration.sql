-- 태그 예산. 예산 한 줄이 분류 대신 태그를 가리킬 수 있다.
--
-- 태그에는 지출·수입의 갈래가 없어 type 으로 가른다. 태그를 지우면 예산도 함께
-- 지운다(Cascade). SetNull 이면 categoryId 도 tagId 도 없는 줄, 곧 "전체 예산"이 된다.
-- 지워진 예산의 자리표는 기존 sync_tombstone 트리거가 남긴다 (연쇄 삭제에도 걸린다).

ALTER TABLE "Budget" ADD COLUMN "tagId" TEXT;

ALTER TABLE "Budget" ADD CONSTRAINT "Budget_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Budget_tagId_idx" ON "Budget"("tagId");

-- 유일 조건에 태그를 더한다. 없으면 같은 달부터 시작하는 두 태그의 지출 예산이 부딪힌다.
DROP INDEX "Budget_projectId_categoryId_type_effectiveFrom_key";
CREATE UNIQUE INDEX "Budget_projectId_categoryId_tagId_type_effectiveFrom_key"
  ON "Budget"("projectId", "categoryId", "tagId", "type", "effectiveFrom");
