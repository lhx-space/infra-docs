import {Router} from 'express';
import {
  createDocumentHandler,
  deleteDocumentHandler,
  getDocumentHandler,
  listDocumentsHandler,
  updateDocumentHandler
} from '../handlers/document';
import {listVersionsHandler, restoreVersionHandler} from '../handlers/document-version';
import {requireAuth} from '../middlewares/require-auth';
import {requireWikiRole} from '../middlewares/require-wiki-role';

export const documentRouter = Router();

documentRouter.use(requireAuth);

documentRouter.get('/wikis/:wikiId/documents', requireWikiRole('VIEWER'), listDocumentsHandler);
documentRouter.post('/wikis/:wikiId/documents', requireWikiRole('EDITOR'), createDocumentHandler);
documentRouter.get(
  '/wikis/:wikiId/documents/:documentId',
  requireWikiRole('VIEWER'),
  getDocumentHandler
);
documentRouter.patch(
  '/wikis/:wikiId/documents/:documentId',
  requireWikiRole('EDITOR'),
  updateDocumentHandler
);
documentRouter.delete(
  '/wikis/:wikiId/documents/:documentId',
  requireWikiRole('EDITOR'),
  deleteDocumentHandler
);

// 版本历史：EDITOR 及以上可查看，仅 OWNER 可恢复（见 document-versioning spec.md「版本查看与恢复的权限边界」）
documentRouter.get(
  '/wikis/:wikiId/documents/:documentId/versions',
  requireWikiRole('EDITOR'),
  listVersionsHandler
);
documentRouter.post(
  '/wikis/:wikiId/documents/:documentId/versions/:versionId/restore',
  requireWikiRole('OWNER'),
  restoreVersionHandler
);
