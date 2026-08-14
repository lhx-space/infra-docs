import {Router} from 'express';
import {
  createDocumentHandler,
  deleteDocumentHandler,
  getDocumentHandler,
  listDocumentsHandler,
  updateDocumentHandler
} from '../handlers/document';
import {
  listEditorsHandler,
  listVersionsHandler,
  restoreVersionHandler
} from '../handlers/document-version';
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

// 历史编辑人列表（见 packages/tiptap-editor 「标题旁展示历史编辑人」的体验优化）：
// 比查看完整版本历史的门槛更低，VIEWER 也能看到"这篇文档大致被谁编辑过"
documentRouter.get(
  '/wikis/:wikiId/documents/:documentId/editors',
  requireWikiRole('VIEWER'),
  listEditorsHandler
);
