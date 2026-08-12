import type {Request, Response} from 'express';
import * as searchService from '../services/search';

export async function searchHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({error: 'unauthorized'});
    return;
  }

  const keyword = typeof req.query['q'] === 'string' ? req.query['q'] : '';
  const result = await searchService.search(userId, keyword);
  res.json(result);
}
