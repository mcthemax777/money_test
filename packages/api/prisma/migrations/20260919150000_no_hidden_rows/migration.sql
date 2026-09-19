-- 분류와 태그에 "감춰진 줄"을 두지 않는다.
--
-- `isActive` 는 지우기를 대신하던 칸이었다. 지운 것을 남겨 두면 되살릴 수 있고, 지난
-- 거래가 가리키는 이름도 지킬 수 있다는 생각이었다. 그런데 **되살릴 일이 생기지
-- 않는다.**
--
--   - 분류는 거래가 하나라도 있으면 애초에 지워지지 않는다(CATEGORY_IN_USE). 지울 수
--     있는 분류는 가리키는 것이 없는 분류뿐이라, 감춰 두어 지킬 것이 없다.
--   - 태그는 지울 때 붙어 있던 자리를 전부 뗀다. 떼고 나면 그 행을 가리키는 것이 없다.
--
-- 남은 것은 값이 아니라 **문제**였다. 목록에 보이지 않는 줄이 이름을 붙들고 있어 같은
-- 이름을 다시 만들 수 없었고("같은 이름이 이미 있습니다"), 무엇이 막는지 화면에서 볼
-- 수도 없었다. 그래서 칸을 없애고 지우기가 행을 정말 지우게 한다. 기기에는 자리표
-- (Tombstone)가 나가고, 그 트리거는 두 표에 이미 걸려 있다.

-- ── 1. 이미 감춰 둔 줄 정리 ──────────────────────────────────────────────
--
-- 감춘 분류에 거래가 달려 있으면 **지우지 않고 되살린다.** `Posting.categoryId` 는
-- cascade 라, 그런 줄을 지우면 그 거래의 다리가 함께 사라져 장부가 어긋난다. 옛
-- 데이터에 그런 줄이 남아 있을 수 있어(지금의 규칙보다 앞선 시절) 먼저 갈라낸다.
-- 되살아난 분류는 목록에 다시 나타나고, 사람이 옮기기로 정리하면 된다.
--
-- 예산도 마찬가지다. `Budget.categoryId` 는 SetNull 이라, 분류를 지우면 그 예산이
-- 조용히 "전체 예산"으로 둔갑한다. 그런 줄도 되살린다.
DELETE FROM "Category" c
 WHERE NOT c."isActive"
   AND NOT EXISTS (SELECT 1 FROM "Posting" p WHERE p."categoryId" = c.id)
   AND NOT EXISTS (SELECT 1 FROM "Budget"  b WHERE b."categoryId" = c.id);

-- 감춘 태그는 그냥 지운다. 연결(EntryTag 등)은 cascade 로 함께 가고, 그 자리의 전표는
-- `sync_stamp_dead_tag` 트리거가 도장을 찍어 기기까지 닿는다.
DELETE FROM "Tag" WHERE NOT "isActive";

-- ── 2. 칸 없애기 ────────────────────────────────────────────────────────
--
-- 색인이 그 칸을 물고 있어 먼저 걷어낸다. 이름 유일 조건은 조건 없는 것으로 되돌린다 --
-- 감춘 줄이 없으니 "살아 있는 줄만"을 따질 까닭이 사라졌다.
DROP INDEX IF EXISTS "Category_projectId_type_isActive_idx";
DROP INDEX IF EXISTS "Category_projectId_name_parentId_key";
DROP INDEX IF EXISTS "Category_project_root_type_name_key";
DROP INDEX IF EXISTS "Tag_projectId_isActive_idx";
DROP INDEX IF EXISTS "Tag_projectId_name_key";

ALTER TABLE "Category" DROP COLUMN "isActive";
ALTER TABLE "Tag" DROP COLUMN "isActive";

CREATE INDEX "Category_projectId_type_idx" ON "Category"("projectId", "type");
CREATE UNIQUE INDEX "Category_projectId_name_parentId_key"
    ON "Category"("projectId", "name", "parentId");
-- 대분류는 parentId 가 NULL 이라 위 색인을 그냥 지나간다. 이름에 type 을 묶어
-- 지출 "기타"와 수입 "기타"는 공존하게 한다.
CREATE UNIQUE INDEX "Category_project_root_type_name_key"
    ON "Category"("projectId", "type", "name")
    WHERE "parentId" IS NULL;
CREATE UNIQUE INDEX "Tag_projectId_name_key" ON "Tag"("projectId", "name");
