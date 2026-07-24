import { Router } from 'express';

/**
 * Remaining Phase 1 stubs — implemented in 1c.
 */
export const stubRouter = Router();

stubRouter.get('/proposals/pending', (_req, res) => {
  res.status(501).json({
    error: 'not_implemented',
    session: '1c',
    message: 'Proposals API lands in Phase 1c',
  });
});

stubRouter.post('/worker/run', (_req, res) => {
  res.status(501).json({
    error: 'not_implemented',
    session: '1c',
    message: 'Emergency Rosterer trigger lands in Phase 1c',
  });
});
