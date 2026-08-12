import type {NextFunction, Request, Response} from 'express';
import * as documentService from '../services/document';
import {DocumentVersionError} from '../services/document-version';
import {isValidUuid} from '../utils/uuid';

function respondToVersionError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof DocumentVersionError || err instanceof documentService.DocumentError) {
    res.status(err.status).json({error: err.message});
    return;
  }
  next(err);
}

/** EDITOR 及以上可查看（见 document-versioning spec.md「版本查看与恢复的权限边界」），
 * 权限本身由路由上的 requireWikiRole('EDITOR') 前置校验，这里只需要确认文档归属该 Wiki。 */
export async function listVersionsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const documentId = req.params['documentId'];
  if (!documentId || !isValidUuid(documentId)) {
    res.status(404).json({error: 'not_found'});
    return;
  }

  try {
    await documentService.getDocument(req.params['wikiId'] as string, documentId);
    const versions = await documentService.listVersions(documentId);
    res.json({versions});
  } catch (err) {
    respondToVersionError(err, res, next);
  }
}

/** 仅 OWNER 可执行，权限由路由上的 requireWikiRole('OWNER') 前置校验 */
export async function restoreVersionHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({error: 'unauthorized'});
    return;
  }

  const documentId = req.params['documentId'];
  const versionId = req.params['versionId'];
  if (!documentId || !isValidUuid(documentId) || !versionId || !isValidUuid(versionId)) {
    res.status(404).json({error: 'not_found'});
    return;
  }

  try {
    const document = await documentService.restoreVersion(
      req.params['wikiId'] as string,
      documentId,
      versionId,
      userId
    );
    res.json({document});
  } catch (err) {
    respondToVersionError(err, res, next);
  }
}
