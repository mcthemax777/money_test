-- DropIndex
DROP INDEX "CardStatement_cardId_status_idx";

-- AlterTable
ALTER TABLE "CardStatement" DROP COLUMN "status";

-- DropEnum
DROP TYPE "StatementStatus";

