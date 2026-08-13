-- CreateTable
CREATE TABLE "uploaded_objects" (
    "id" UUID NOT NULL,
    "sha256" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "refCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uploaded_objects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uploaded_objects_sha256_key" ON "uploaded_objects"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "uploaded_objects_url_key" ON "uploaded_objects"("url");
