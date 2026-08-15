-- AlterTable
ALTER TABLE "Budget" ADD COLUMN "type" TEXT;

-- DropIndex
DROP INDEX IF EXISTS "Budget_projectId_userId_categoryId_effectiveFrom_key";

-- CreateIndex
CREATE UNIQUE INDEX "Budget_projectId_userId_categoryId_type_effectiveFrom_key" ON "Budget"("projectId", "userId", "categoryId", "type", "effectiveFrom");
