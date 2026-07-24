import { Router } from 'express';
import { errorMessage } from '../db/pool';
import {
  bulkRemindCredentials,
  getCredentialWatch,
} from '../services/credentials';

export const credentialsRouter = Router();

credentialsRouter.get('/credentials/expiring', async (req, res) => {
  try {
    const withinDays = Math.min(Number(req.query.withinDays) || 30, 90);
    const data = await getCredentialWatch(withinDays);
    res.json(data);
  } catch (err) {
    res.status(503).json({ error: 'credentials_failed', message: errorMessage(err) });
  }
});

credentialsRouter.post('/credentials/bulk-remind', async (req, res) => {
  try {
    const remindedBy = String(req.body?.remindedBy ?? '').trim();
    if (!remindedBy) {
      res.status(400).json({ error: 'invalid_body', message: 'remindedBy required' });
      return;
    }

    const credentialId =
      req.body?.credentialId != null && req.body.credentialId !== ''
        ? Number(req.body.credentialId)
        : null;
    const assignmentIds = Array.isArray(req.body?.assignmentIds)
      ? req.body.assignmentIds.map(Number).filter(Number.isFinite)
      : undefined;

    const result = await bulkRemindCredentials({
      remindedBy,
      withinDays: Number(req.body?.withinDays) || 30,
      credentialId: Number.isFinite(credentialId as number) ? credentialId : null,
      assignmentIds,
      limit: Number(req.body?.limit) || 50,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(503).json({ error: 'bulk_remind_failed', message: errorMessage(err) });
  }
});
