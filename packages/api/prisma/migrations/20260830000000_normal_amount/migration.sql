-- AlterTable
ALTER TABLE "Posting" ADD COLUMN     "normalAmount" DECIMAL(19,4) NOT NULL DEFAULT 0;

-- 카테고리 다리에만 채운다. 일반 몫은 그 다리 금액에서 과소비를 뺀 나머지다.
UPDATE "Posting"
SET "normalAmount" = ABS("baseAmount") - "extraAmount"
WHERE "categoryId" IS NOT NULL;
