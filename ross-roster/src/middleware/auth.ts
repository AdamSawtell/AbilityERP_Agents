import type { NextFunction, Request, Response } from 'express';
import { env } from '../config';

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match?.[1]?.trim();

  if (!token || token !== env.apiKey) {
    res.status(401).json({ error: 'unauthorized', message: 'Valid Bearer API key required' });
    return;
  }

  next();
}
