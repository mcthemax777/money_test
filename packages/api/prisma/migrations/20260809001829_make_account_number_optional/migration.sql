-- DropIndex
DROP INDEX "Account_accountNumber_key";

-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "accountNumber" DROP NOT NULL;
