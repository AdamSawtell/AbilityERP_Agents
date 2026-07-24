import { Router } from 'express';
import { errorMessage } from '../db/pool';
import {
  approveSwap,
  createManualSwap,
  getSwap,
  listSwaps,
  rejectSwap,
  respondSwap,
} from '../services/swaps';
import { getLastSwapCycle, runSwapCycle } from '../worker/swap';

export const swapsRouter = Router();

swapsRouter.get('/swaps', async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const swaps = await listSwaps({ status, limit });
    res.json({ swaps, lastCycle: getLastSwapCycle() });
  } catch (err) {
    res.status(503).json({ error: 'db_unavailable', message: errorMessage(err) });
  }
});

swapsRouter.get('/swaps/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }
    const row = await getSwap(id);
    if (!row) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const swap = (await listSwaps({ status: 'all', limit: 200 })).find((s) => s.id === id);
    res.json({ swap: swap ?? null });
  } catch (err) {
    res.status(503).json({ error: 'db_unavailable', message: errorMessage(err) });
  }
});

swapsRouter.post('/swaps/run', async (_req, res) => {
  try {
    const summary = await runSwapCycle('manual');
    res.json({ success: true, summary });
  } catch (err) {
    const message = errorMessage(err);
    const status = message === 'swap_cycle_busy' ? 409 : 503;
    res.status(status).json({ error: 'swap_run_failed', message });
  }
});

swapsRouter.post('/swaps', async (req, res) => {
  try {
    const shiftAId = Number(req.body?.shiftAId);
    const shiftBId = Number(req.body?.shiftBId);
    if (!Number.isFinite(shiftAId) || !Number.isFinite(shiftBId)) {
      res.status(400).json({ error: 'invalid_body', message: 'shiftAId and shiftBId required' });
      return;
    }
    const id = await createManualSwap({
      shiftAId,
      shiftBId,
      source: 'manual',
      notify: req.body?.notify !== false,
    });
    const swaps = await listSwaps({ status: 'proposed', limit: 50 });
    res.status(201).json({ success: true, id, swap: swaps.find((s) => s.id === id) });
  } catch (err) {
    res.status(400).json({ error: 'create_failed', message: errorMessage(err) });
  }
});

swapsRouter.post('/swaps/:id/approve', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const by = String(req.body?.approvedBy ?? '').trim();
    if (!Number.isFinite(id) || !by) {
      res.status(400).json({ error: 'invalid_body', message: 'approvedBy required' });
      return;
    }
    const row = await approveSwap(id, by, req.body?.notes);
    if (!row) {
      res.status(404).json({ error: 'not_found_or_not_open' });
      return;
    }
    res.json({
      success: true,
      swap: {
        id: Number(row.id),
        status: row.status,
        requesterId: Number(row.requester_id),
        partnerId: Number(row.partner_id),
      },
    });
  } catch (err) {
    res.status(503).json({ error: 'approve_failed', message: errorMessage(err) });
  }
});

swapsRouter.post('/swaps/:id/reject', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const by = String(req.body?.rejectedBy ?? req.body?.approvedBy ?? '').trim();
    if (!Number.isFinite(id) || !by) {
      res.status(400).json({ error: 'invalid_body', message: 'rejectedBy required' });
      return;
    }
    const row = await rejectSwap(id, by, req.body?.notes);
    if (!row) {
      res.status(404).json({ error: 'not_found_or_not_open' });
      return;
    }
    res.json({ success: true, id: Number(row.id), status: row.status });
  } catch (err) {
    res.status(503).json({ error: 'reject_failed', message: errorMessage(err) });
  }
});

swapsRouter.post('/swaps/:id/respond', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const party = String(req.body?.party ?? '').toLowerCase();
    const response = String(req.body?.response ?? '').toLowerCase();
    const by = String(req.body?.respondedBy ?? req.body?.approvedBy ?? '').trim();
    if (!Number.isFinite(id) || !by) {
      res.status(400).json({ error: 'invalid_body', message: 'respondedBy required' });
      return;
    }
    if (party !== 'requester' && party !== 'partner') {
      res.status(400).json({ error: 'invalid_body', message: "party must be 'requester' or 'partner'" });
      return;
    }
    if (response !== 'accepted' && response !== 'declined') {
      res.status(400).json({
        error: 'invalid_body',
        message: "response must be 'accepted' or 'declined'",
      });
      return;
    }

    const result = await respondSwap(id, party, response, by);
    if (!result) {
      res.status(404).json({ error: 'not_found_or_not_open' });
      return;
    }
    res.json({
      success: true,
      executed: result.executed,
      swap: {
        id: Number(result.swap.id),
        status: result.swap.status,
        requesterResponse: result.swap.requester_response,
        partnerResponse: result.swap.partner_response,
      },
    });
  } catch (err) {
    res.status(503).json({ error: 'respond_failed', message: errorMessage(err) });
  }
});
