-- DropForeignKey
ALTER TABLE "Card" DROP CONSTRAINT "Card_accountId_fkey";

-- DropIndex
DROP INDEX "Card_accountId_idx";

-- AlterTable
ALTER TABLE "Card" DROP COLUMN "accountId",
ADD COLUMN     "liabilityAccountId" TEXT,
ADD COLUMN     "paymentAccountId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Card_liabilityAccountId_key" ON "Card"("liabilityAccountId");

-- CreateIndex
CREATE INDEX "Card_paymentAccountId_idx" ON "Card"("paymentAccountId");

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_liabilityAccountId_fkey" FOREIGN KEY ("liabilityAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

