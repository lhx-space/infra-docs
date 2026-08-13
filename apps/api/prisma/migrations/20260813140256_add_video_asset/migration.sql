-- CreateEnum
CREATE TYPE "VideoAssetStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "video_assets" (
    "id" UUID NOT NULL,
    "status" "VideoAssetStatus" NOT NULL DEFAULT 'PROCESSING',
    "sourceType" TEXT NOT NULL DEFAULT 'upload',
    "originalObjectKey" TEXT NOT NULL,
    "hlsManifestKey" TEXT,
    "posterKey" TEXT,
    "error" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_assets_pkey" PRIMARY KEY ("id")
);
