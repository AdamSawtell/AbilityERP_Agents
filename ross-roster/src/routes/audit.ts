import { Router } from 'express';
import { errorMessage } from '../db/pool';
import { auditRowsToCsv, listAudit } from '../services/audit';

export const auditRouter = Router();

function parseAuditQuery(req: { query: Record<string, unknown> }) {
  return {
    limit: Math.min(Number(req.query.limit) || 50, 500),
    offset: Math.max(Number(req.query.offset) || 0, 0),
    agentType: typeof req.query.agent_type === 'string' ? req.query.agent_type : undefined,
    action: typeof req.query.action === 'string' ? req.query.action : undefined,
    since: typeof req.query.since === 'string' ? req.query.since : undefined,
    until: typeof req.query.until === 'string' ? req.query.until : undefined,
  };
}

auditRouter.get('/audit', async (req, res) => {
  try {
    const opts = parseAuditQuery(req);
    const rows = await listAudit(opts);
    res.json({ entries: rows, ...opts });
  } catch (err) {
    res.status(503).json({ error: 'db_unavailable', message: errorMessage(err) });
  }
});

auditRouter.get('/audit/export', async (req, res) => {
  try {
    const opts = parseAuditQuery(req);
    opts.limit = Math.min(Number(req.query.limit) || 500, 2000);
    opts.offset = 0;
    const rows = await listAudit(opts);
    const csv = auditRowsToCsv(rows as Array<Record<string, unknown>>);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ross-audit-${stamp}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(503).json({ error: 'export_failed', message: errorMessage(err) });
  }
});
