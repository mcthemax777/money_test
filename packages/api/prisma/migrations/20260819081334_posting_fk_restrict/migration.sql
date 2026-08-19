-- DropForeignKey
ALTER TABLE "Posting" DROP CONSTRAINT "Posting_accountId_fkey";

-- DropForeignKey
ALTER TABLE "Posting" DROP CONSTRAINT "Posting_categoryId_fkey";

-- AddForeignKey
ALTER TABLE "Posting" ADD CONSTRAINT "Posting_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Posting" ADD CONSTRAINT "Posting_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
