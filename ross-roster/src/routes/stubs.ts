import { Router } from 'express';

/**
 * Phase 1a stubs — implemented in 1b/1c/1d.
 * Keep routes discoverable so clients and health checks can see the surface early.
 */
export const stubRouter = Router();

stubRouter.get('/shifts/vacant', (_req, res) => {
  res.status(501).json({
    error: 'not_implemented',
    session: '1b',
    message: 'Vacant shift query lands in Phase 1b',
  });
});

stubRouter.get('/shifts/vacant/:shiftId/matches', (_req, res) => {
  res.status(501).json({
    error: 'not_implemented',
    session: '1b',
    message: 'Matching engine lands in Phase 1b',
  });
});

stubRouter.post('/assign', (_req, res) => {
  res.status(501).json({
    error: 'not_implemented',
    session: '1b',
    message: 'Assign path lands in Phase 1b/1d',
  });
});

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
