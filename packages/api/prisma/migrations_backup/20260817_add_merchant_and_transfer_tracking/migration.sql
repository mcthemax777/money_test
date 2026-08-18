-- Add merchant, detailedNote, toAccountId, and transferFee columns to Transaction
ALTER TABLE "Transaction" ADD COLUMN "merchant" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "detailedNote" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "toAccountId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "transferFee" DOUBLE PRECISION;

-- Create index for toAccountId
CREATE INDEX "Transaction_toAccountId_idx" ON "Transaction"("toAccountId");

-- Add foreign key constraint for toAccountId
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
