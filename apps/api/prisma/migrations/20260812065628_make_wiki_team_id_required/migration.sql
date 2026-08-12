/*
  Warnings:

  - Made the column `teamId` on table `wikis` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "wikis" DROP CONSTRAINT "wikis_teamId_fkey";

-- AlterTable
ALTER TABLE "wikis" ALTER COLUMN "teamId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "wikis" ADD CONSTRAINT "wikis_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
