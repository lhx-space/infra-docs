import type {NextFunction, Request, Response} from 'express';
import {z} from 'zod';
import {fetchLinkPreview} from '../services/link-preview';

const linkPreviewSchema = z.object({url: z.string().url()});

/**
 * 抓取失败（任意原因）统一返回 `{available: false}`，不暴露具体错误堆栈，也不用非 2xx
 * 状态码——前端据此自动降级为纯文本链接，属于正常业务分支，不是"接口出错"
 * （见 link-preview spec.md「抓取失败时自动降级」）。
 */
export async function linkPreviewHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const parsed = linkPreviewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({error: 'invalid_input', details: parsed.error.flatten()});
    return;
  }

  try {
    const result = await fetchLinkPreview(parsed.data.url);
    if (!result) {
      res.json({available: false});
      return;
    }
    res.json({available: true, ...result});
  } catch (err) {
    next(err);
  }
}
