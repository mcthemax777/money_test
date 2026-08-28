-- 필수/변동(isFixed)을 과소비·추가 수입 금액(extraAmount)으로 바꾼다.
--
-- 뜻이 이어지지 않으므로 기존 값은 옮기지 않는다. 모든 거래가 "과소비 0원"인
-- 일반 거래가 되고, 분류의 기본값도 꺼진 상태에서 다시 쌓인다.

-- AlterTable
ALTER TABLE "Posting" DROP COLUMN "isFixed";
ALTER TABLE "Posting" ADD COLUMN "extraAmount" DECIMAL(19,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Category" RENAME COLUMN "defaultIsFixed" TO "defaultIsExtra";
UPDATE "Category" SET "defaultIsExtra" = false;
