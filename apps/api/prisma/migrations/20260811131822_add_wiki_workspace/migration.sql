-- CreateEnum
CREATE TYPE "WikiRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- CreateTable
CREATE TABLE "wikis" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wikis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wiki_members" (
    "id" SERIAL NOT NULL,
    "wikiId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" "WikiRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wiki_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wiki_members_wikiId_userId_key" ON "wiki_members"("wikiId", "userId");

-- AddForeignKey
ALTER TABLE "wikis" ADD CONSTRAINT "wikis_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_members" ADD CONSTRAINT "wiki_members_wikiId_fkey" FOREIGN KEY ("wikiId") REFERENCES "wikis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_members" ADD CONSTRAINT "wiki_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
