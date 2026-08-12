-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "wikiId" UUID NOT NULL,
    "parentId" UUID,
    "title" TEXT NOT NULL DEFAULT '未命名文档',
    "content" JSONB NOT NULL DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}',
    "searchText" TEXT NOT NULL DEFAULT '',
    "coverImage" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_wikiId_fkey" FOREIGN KEY ("wikiId") REFERENCES "wikis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
