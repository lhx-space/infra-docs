/*
  Warnings:

  - The primary key for the `user_profiles` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `users` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `wiki_members` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `wikis` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Changed the type of `id` on the `user_profiles` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `userId` on the `user_profiles` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `users` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `wiki_members` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `wikiId` on the `wiki_members` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `userId` on the `wiki_members` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `wikis` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `ownerId` on the `wikis` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- DropForeignKey
ALTER TABLE "user_profiles" DROP CONSTRAINT "user_profiles_userId_fkey";

-- DropForeignKey
ALTER TABLE "wiki_members" DROP CONSTRAINT "wiki_members_userId_fkey";

-- DropForeignKey
ALTER TABLE "wiki_members" DROP CONSTRAINT "wiki_members_wikiId_fkey";

-- DropForeignKey
ALTER TABLE "wikis" DROP CONSTRAINT "wikis_ownerId_fkey";

-- AlterTable
ALTER TABLE "user_profiles" DROP CONSTRAINT "user_profiles_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "userId",
ADD COLUMN     "userId" UUID NOT NULL,
ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "users" DROP CONSTRAINT "users_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "wiki_members" DROP CONSTRAINT "wiki_members_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "wikiId",
ADD COLUMN     "wikiId" UUID NOT NULL,
DROP COLUMN "userId",
ADD COLUMN     "userId" UUID NOT NULL,
ADD CONSTRAINT "wiki_members_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "wikis" DROP CONSTRAINT "wikis_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "ownerId",
ADD COLUMN     "ownerId" UUID NOT NULL,
ADD CONSTRAINT "wikis_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_userId_key" ON "user_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "wiki_members_wikiId_userId_key" ON "wiki_members"("wikiId", "userId");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wikis" ADD CONSTRAINT "wikis_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_members" ADD CONSTRAINT "wiki_members_wikiId_fkey" FOREIGN KEY ("wikiId") REFERENCES "wikis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_members" ADD CONSTRAINT "wiki_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
