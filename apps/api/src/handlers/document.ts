import type {NextFunction, Request, Response} from 'express';
import {z} from 'zod';
import * as documentService from '../services/document';
import {validateDocumentContent} from '../utils/document-schema';
import {isValidUuid} from '../utils/uuid';

const createDocumentSchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(200).optional(),
  coverImage: z.string().url().optional()
});

const updateDocumentSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.unknown().optional(),
  coverImage: z.string().url().optional(),
  parentId: z.string().uuid().nullable().optional(),
  order: z.number().int().min(0).optional()
});

/** 统一把 service 层的 DocumentError 映射为对应的 HTTP 状态码，未知错误交给全局错误中间件（对齐 handlers/wiki.ts） */
function respondToServiceError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof documentService.DocumentError) {
    res.status(err.status).json({error: err.message});
    return;
  }
  next(err);
}

/** wikiId 的存在性与角色已由 requireWikiRole 中间件校验过 */
export async function listDocumentsHandler(req: Request, res: Response): Promise<void> {
  const documents = await documentService.listDocuments(req.params['wikiId'] as string);
  res.json({documents});
}

export async function getDocumentHandler(
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
    const document = await documentService.getDocument(req.params['wikiId'] as string, documentId);
    res.json({document});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}

export async function createDocumentHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const parsed = createDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({error: 'invalid_input', details: parsed.error.flatten()});
    return;
  }

  try {
    const document = await documentService.createDocument(
      req.params['wikiId'] as string,
      parsed.data
    );
    res.status(201).json({document});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}

export async function updateDocumentHandler(
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
  if (!documentId || !isValidUuid(documentId)) {
    res.status(404).json({error: 'not_found'});
    return;
  }

  const parsed = updateDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({error: 'invalid_input', details: parsed.error.flatten()});
    return;
  }

  // 内容结构校验必须在写入数据库前完成，且校验规则与编辑器实际支持的块类型同源
  // （见 wiki-document spec.md「拒绝未识别的节点类型」、design.md 决策 3）
  if (parsed.data.content !== undefined && !validateDocumentContent(parsed.data.content)) {
    res.status(400).json({error: 'invalid_content'});
    return;
  }

  try {
    const document = await documentService.updateDocument(
      req.params['wikiId'] as string,
      documentId,
      parsed.data,
      userId
    );
    res.json({document});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}

export async function deleteDocumentHandler(
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
    await documentService.deleteDocument(req.params['wikiId'] as string, documentId);
    res.json({status: 'ok'});
  } catch (err) {
    respondToServiceError(err, res, next);
  }
}
