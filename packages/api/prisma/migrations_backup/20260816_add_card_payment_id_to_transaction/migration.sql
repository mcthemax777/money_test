-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "cardPaymentId" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_cardPaymentId_idx" ON "Transaction"("cardPaymentId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_cardPaymentId_fkey" FOREIGN KEY ("cardPaymentId") REFERENCES "CardPayment"(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- 기존 accountId를 선택사항으로 변경
ALTER TABLE "Transaction" ALTER COLUMN "accountId" DROP NOT NULL;

-- 기존 데이터 삭제 (사용자 요청)
DELETE FROM "CardPaymentUsage";
DELETE FROM "CardPayment";
DELETE FROM "CardUsage";
DELETE FROM "Transaction";
