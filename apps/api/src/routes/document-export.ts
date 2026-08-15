import {Router} from 'express';
import {
  downloadDocumentExportHandler,
  exportDocumentHandler,
  getDocumentExportStatusHandler
} from '../handlers/document-export';
import {requireAuth} from '../middlewares/require-auth';
import {requireWikiRole} from '../middlewares/require-wiki-role';

export const documentExportRouter = Router();

documentExportRouter.use(requireAuth);

/**
 * 文档导出三件套（见 tasks.md 5.1~5.4）：三个路由统一 `requireWikiRole('VIEWER')`——
 * 跟现有 `GET` 文档路由同一套权限判断，"能看到文档内容就能导出"，不引入单独的导出
 * 权限位（见 design.md 决策 9、spec.md「导出权限跟随文档现有读权限」）。
 */
documentExportRouter.post(
  '/wikis/:wikiId/documents/:documentId/export',
  requireWikiRole('VIEWER'),
  exportDocumentHandler
);

documentExportRouter.get(
  '/wikis/:wikiId/documents/:documentId/exports/:exportId',
  requireWikiRole('VIEWER'),
  getDocumentExportStatusHandler
);

documentExportRouter.get(
  '/wikis/:wikiId/documents/:documentId/exports/:exportId/download',
  requireWikiRole('VIEWER'),
  downloadDocumentExportHandler
);
