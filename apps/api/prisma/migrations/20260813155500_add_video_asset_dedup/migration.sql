-- AlterTable
ALTER TABLE "video_assets" ADD COLUMN     "sha256" TEXT,
ADD COLUMN     "refCount" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE UNIQUE INDEX "video_assets_sha256_key" ON "video_assets"("sha256");
