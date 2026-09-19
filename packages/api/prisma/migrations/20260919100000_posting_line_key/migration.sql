-- 분할 거래의 줄을 하나의 신원으로 다룬다.
--
-- 지금까지 "줄"은 Posting 행일 뿐이었다. 전표를 고칠 때마다 다리를 통째로 지우고 새로
-- 만들기 때문에(replaceEntry) id 가 매번 바뀌고, 그래서 줄에 무언가를 붙일 수 없었다.
-- 태그와 차감이 전표에 올라가 있던 까닭이 그것이다.
--
-- 이 마이그레이션은 셋을 한다.
--   1. Posting 에 줄 키(lineKey)를 주고 기존 분류 다리에 채운다.
--   2. 전표에 있던 차감·실적 칸을 분류 다리로 내린다.
--   3. 전표에 붙어 있던 태그를 그 전표의 모든 분류 줄에 복사한다.

-- ── 1. 줄 키 ───────────────────────────────────────────────

ALTER TABLE "Posting" ADD COLUMN "lineKey" TEXT;

-- 기존 분류 다리에 키를 발급한다. 계좌 다리는 null 로 둔다.
--
-- 값은 서버가 만든다. 화면이 만드는 것이 규칙이지만, 이미 저장된 줄에는 만들어 줄
-- 화면이 없다. 화면은 다음에 그 거래를 열 때 이 값을 받아 그대로 들고 다닌다.
UPDATE "Posting" SET "lineKey" = gen_random_uuid()::text WHERE "categoryId" IS NOT NULL;

CREATE UNIQUE INDEX "Posting_entryId_lineKey_key" ON "Posting"("entryId", "lineKey");

-- ── 2. 차감과 실적을 줄로 ──────────────────────────────────

ALTER TABLE "Posting" ADD COLUMN "discountAmount" DECIMAL(19,4);
ALTER TABLE "Posting" ADD COLUMN "countsPerformance" BOOLEAN;
ALTER TABLE "Posting" ADD COLUMN "discountCountsPerformance" BOOLEAN;

-- 실적 관련 값은 그대로 복사한다. 전표 하나에 하나뿐이던 선택이라 모든 줄이 같다.
UPDATE "Posting" p
SET "countsPerformance" = e."countsPerformance",
    "discountCountsPerformance" = e."discountCountsPerformance"
FROM "JournalEntry" e
WHERE p."entryId" = e."id" AND p."categoryId" IS NOT NULL;

-- 차감액은 줄 금액에 비례해 나눈다.
--
-- 지금까지도 같은 비율로 나뉘어 다리에 적혀 있었다(withDiscount 의 allocate). 그래서
-- 이 배분은 새 규칙을 과거에 씌우는 것이 아니라, 이미 적용된 배분을 겉으로 꺼내는 일이다.
--
-- 끝수는 첫 줄(id 가 가장 작은 줄)에 몰아 준다. 줄 합계가 전표의 차감액과 정확히 같아야
-- 편집 화면이 정가를 되살릴 때 원래 값이 그대로 나온다.
WITH lines AS (
  SELECT p."id",
         p."entryId",
         abs(p."amount") AS w,
         sum(abs(p."amount")) OVER (PARTITION BY p."entryId") AS total,
         row_number() OVER (PARTITION BY p."entryId" ORDER BY p."id") AS rn,
         count(*) OVER (PARTITION BY p."entryId") AS n
  FROM "Posting" p
  JOIN "JournalEntry" e ON e."id" = p."entryId"
  WHERE p."categoryId" IS NOT NULL
    AND e."discountAmount" IS NOT NULL
    AND e."discountAmount" <> 0
),
shares AS (
  SELECT l."id",
         l."entryId",
         l.rn,
         l.n,
         CASE
           -- 줄이 하나면 나눌 것이 없다. 전표의 차감액이 그대로 그 줄의 값이다.
           WHEN l.n = 1 THEN e."discountAmount"
           -- 합계가 0인 전표(전액 차감)는 비율을 만들 수 없다. 줄 수로 고르게 나눈다.
           WHEN l.total = 0 THEN trunc(e."discountAmount" / l.n, 4)
           ELSE trunc(e."discountAmount" * l.w / l.total, 4)
         END AS share,
         e."discountAmount" AS total_discount
  FROM lines l
  JOIN "JournalEntry" e ON e."id" = l."entryId"
),
fixed AS (
  SELECT s."id",
         s.share
           + CASE WHEN s.rn = 1
                  THEN s.total_discount - sum(s.share) OVER (PARTITION BY s."entryId")
                  ELSE 0 END AS amount
  FROM shares s
)
UPDATE "Posting" p
SET "discountAmount" = f.amount
FROM fixed f
WHERE p."id" = f."id" AND f.amount <> 0;

ALTER TABLE "JournalEntry" DROP COLUMN "discountAmount";
ALTER TABLE "JournalEntry" DROP COLUMN "countsPerformance";
ALTER TABLE "JournalEntry" DROP COLUMN "discountCountsPerformance";

-- ── 3. 태그를 줄로 ─────────────────────────────────────────

-- 복합 기본키를 대리 키로 바꾼다. 줄 키가 null 일 수 있어 기본키에 넣을 수 없다.
ALTER TABLE "EntryTag" DROP CONSTRAINT "EntryTag_pkey";
ALTER TABLE "EntryTag" ADD COLUMN "id" TEXT;
ALTER TABLE "EntryTag" ADD COLUMN "lineKey" TEXT;

-- 전표에 붙어 있던 태그를 그 전표의 **모든 분류 줄**에 복사한다.
--
-- 어느 줄의 태그였는지는 기록이 없다. 사용자가 "이 결제는 여행이었다"로 붙였으므로
-- 한 줄만 골라 남기면 나머지 줄에서 근거 없이 사라진다. 복사해 두면 사용자가 필요 없는
-- 줄에서 떼면 된다.
INSERT INTO "EntryTag" ("id", "entryId", "lineKey", "tagId")
SELECT gen_random_uuid()::text, t."entryId", p."lineKey", t."tagId"
FROM "EntryTag" t
JOIN "Posting" p ON p."entryId" = t."entryId" AND p."lineKey" IS NOT NULL
WHERE t."id" IS NULL;

-- 옛 행(줄 키 없음)은 분류 줄이 없는 전표의 것만 남긴다. 이체와 카드 대금 결제가 그렇다.
DELETE FROM "EntryTag" t
WHERE t."id" IS NULL
  AND EXISTS (SELECT 1 FROM "Posting" p WHERE p."entryId" = t."entryId" AND p."lineKey" IS NOT NULL);

UPDATE "EntryTag" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;

ALTER TABLE "EntryTag" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "EntryTag" ADD CONSTRAINT "EntryTag_pkey" PRIMARY KEY ("id");

CREATE UNIQUE INDEX "EntryTag_entryId_lineKey_tagId_key" ON "EntryTag"("entryId", "lineKey", "tagId");
-- 줄 키가 없는 행은 위 색인이 막지 못한다 (null 은 서로 다른 값이다).
CREATE UNIQUE INDEX "EntryTag_entryId_tagId_entry_level_key" ON "EntryTag"("entryId", "tagId") WHERE "lineKey" IS NULL;
CREATE INDEX "EntryTag_entryId_idx" ON "EntryTag"("entryId");
