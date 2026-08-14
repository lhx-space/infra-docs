-- CreateTable
CREATE TABLE "document_contributors" (
    "documentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "firstEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_contributors_pkey" PRIMARY KEY ("documentId","userId")
);

-- AddForeignKey
ALTER TABLE "document_contributors" ADD CONSTRAINT "document_contributors_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
