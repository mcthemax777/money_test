/*
  Warnings:

  - You are about to drop the column `personId` on the `Card` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Card" DROP CONSTRAINT "Card_personId_fkey";

-- DropIndex
DROP INDEX "Card_personId_idx";

-- AlterTable
ALTER TABLE "Card" DROP COLUMN "personId";
