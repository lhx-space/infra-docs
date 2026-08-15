-- CreateEnum
CREATE TYPE "DocumentExportFormat" AS ENUM ('PDF');

-- CreateEnum
CREATE TYPE "DocumentExportStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "document_exports" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "format" "DocumentExportFormat" NOT NULL DEFAULT 'PDF',
    "status" "DocumentExportStatus" NOT NULL DEFAULT 'PENDING',
    "objectKey" TEXT,
    "errorMessage" TEXT,
    "requestedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_exports_documentId_idx" ON "document_exports"("documentId");
