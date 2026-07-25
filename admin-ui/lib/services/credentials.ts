import { query } from '../db/pool';
import {
  resolveWorkerUserId,
  sendPathwaysMessage,
} from '../pathways';
import { writeAudit } from './audit';

export type ExpiringCredential = {
  assignmentId: number;
  workerId: number;
  workerName: string;
  credentialId: number;
  credentialName: string;
  expiryDate: string;
  daysLeft: number;
  window: '7' | '14' | '30';
  adClientId: number;
};

export type CredentialWatchGroup = {
  credentialId: number;
  credentialName: string;
  within7Days: number;
  within14Days: number;
  within30Days: number;
  workers: ExpiringCredential[];
};

function windowFor(daysLeft: number): '7' | '14' | '30' {
  if (daysLeft <= 7) return '7';
  if (daysLeft <= 14) return '14';
  return '30';
}

export async function listExpiringCredentials(withinDays = 30): Promise<ExpiringCredential[]> {
  const days = Math.min(Math.max(withinDays, 1), 90);
  const { rows } = await query<{
    assignment_id: number;
    worker_id: number;
    worker_name: string;
    credential_id: number;
    credential_name: string;
    expiry: Date;
    days_left: string;
    ad_client_id: number;
  }>(
    `SELECT
       ca.aberp_credentialassignment_id AS assignment_id,
       bp.c_bpartner_id AS worker_id,
       bp.name AS worker_name,
       c.aberp_credentials_id AS credential_id,
       c.name AS credential_name,
       ca.aberp_expirydate AS expiry,
       GREATEST(
         CEIL(EXTRACT(EPOCH FROM (ca.aberp_expirydate - NOW())) / 86400),
         0
       )::text AS days_left,
       COALESCE(bp.ad_client_id, 1000000) AS ad_client_id
     FROM adempiere.aberp_credentialassignment ca
     JOIN adempiere.aberp_credentials c
       ON c.aberp_credentials_id = ca.aberp_credentials_id
     JOIN adempiere.c_bpartner bp ON bp.c_bpartner_id = ca.c_bpartner_staff_id
     WHERE ca.isactive = 'Y'
       AND bp.isactive = 'Y'
       AND ca.aberp_expirydate IS NOT NULL
       AND ca.aberp_expirydate >= NOW()
       AND ca.aberp_expirydate <= NOW() + make_interval(days => $1::int)
     ORDER BY ca.aberp_expirydate ASC, bp.name
     LIMIT 200`,
    [days],
  );

  return rows.map((r) => {
    const daysLeft = Number(r.days_left);
    return {
      assignmentId: Number(r.assignment_id),
      workerId: Number(r.worker_id),
      workerName: r.worker_name,
      credentialId: Number(r.credential_id),
      credentialName: r.credential_name,
      expiryDate: new Date(r.expiry).toISOString().slice(0, 10),
      daysLeft,
      window: windowFor(daysLeft),
      adClientId: Number(r.ad_client_id),
    };
  });
}

export async function getCredentialWatch(withinDays = 30): Promise<{
  withinDays: number;
  totals: { within7Days: number; within14Days: number; within30Days: number };
  groups: CredentialWatchGroup[];
  items: ExpiringCredential[];
}> {
  const items = await listExpiringCredentials(withinDays);
  const totals = {
    within7Days: items.filter((i) => i.daysLeft <= 7).length,
    within14Days: items.filter((i) => i.daysLeft <= 14).length,
    within30Days: items.length,
  };

  const byCred = new Map<number, CredentialWatchGroup>();
  for (const item of items) {
    let g = byCred.get(item.credentialId);
    if (!g) {
      g = {
        credentialId: item.credentialId,
        credentialName: item.credentialName,
        within7Days: 0,
        within14Days: 0,
        within30Days: 0,
        workers: [],
      };
      byCred.set(item.credentialId, g);
    }
    g.workers.push(item);
    g.within30Days += 1;
    if (item.daysLeft <= 14) g.within14Days += 1;
    if (item.daysLeft <= 7) g.within7Days += 1;
  }

  const groups = Array.from(byCred.values()).sort(
    (a, b) => b.within7Days - a.within7Days || b.within30Days - a.within30Days,
  );

  return { withinDays, totals, groups, items };
}

function remindMessage(item: ExpiringCredential): string {
  const first = item.workerName.split(' ')[0] || item.workerName;
  return (
    `Hi ${first} — credential reminder\n` +
    `${item.credentialName} expires on ${item.expiryDate} (${item.daysLeft} day(s) left).\n` +
    `Please renew before it expires so you stay eligible for shifts.`
  );
}

export async function bulkRemindCredentials(opts: {
  withinDays?: number;
  credentialId?: number | null;
  assignmentIds?: number[];
  remindedBy: string;
  limit?: number;
}): Promise<{
  attempted: number;
  sent: number;
  skipped: number;
  errors: string[];
}> {
  const watch = await getCredentialWatch(opts.withinDays ?? 30);
  let targets = watch.items;

  if (opts.credentialId != null) {
    targets = targets.filter((t) => t.credentialId === opts.credentialId);
  }
  if (opts.assignmentIds?.length) {
    const set = new Set(opts.assignmentIds);
    targets = targets.filter((t) => set.has(t.assignmentId));
  }

  const limit = Math.min(opts.limit ?? 50, 100);
  targets = targets.slice(0, limit);

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const item of targets) {
    try {
      const userId = await resolveWorkerUserId(item.workerId);
      if (userId == null) {
        skipped += 1;
        errors.push(`${item.workerName}: no AD_User`);
        continue;
      }

      const shiftRes = await query<{ shift_id: number }>(
        `SELECT ss.aberp_rostered_shift_id AS shift_id
         FROM adempiere.aberp_rostered_shiftstaff ss
         JOIN adempiere.aberp_rostered_shift s
           ON s.aberp_rostered_shift_id = ss.aberp_rostered_shift_id
         WHERE ss.c_bpartner_staff_id = $1
           AND ss.isactive = 'Y'
           AND COALESCE(s.starttime, s.startdate) >= NOW() - interval '30 days'
         ORDER BY COALESCE(s.starttime, s.startdate) DESC
         LIMIT 1`,
        [item.workerId],
      );
      let shiftId = shiftRes.rows[0] ? Number(shiftRes.rows[0].shift_id) : null;
      if (shiftId == null) {
        const anyShift = await query<{ shift_id: number }>(
          `SELECT aberp_rostered_shift_id AS shift_id
           FROM adempiere.aberp_rostered_shift
           WHERE isactive = 'Y' AND ad_client_id = $1
           ORDER BY aberp_rostered_shift_id DESC
           LIMIT 1`,
          [item.adClientId],
        );
        shiftId = anyShift.rows[0] ? Number(anyShift.rows[0].shift_id) : null;
      }
      if (shiftId == null) {
        skipped += 1;
        errors.push(`${item.workerName}: no shift for Pathways`);
        continue;
      }

      const result = await sendPathwaysMessage({
        workerAdUserId: userId,
        workerBPartnerId: item.workerId,
        shiftId,
        message: remindMessage(item),
        adClientId: item.adClientId,
      });
      if (result.sent) sent += 1;
      else {
        skipped += 1;
        errors.push(`${item.workerName}: ${result.message}`);
      }
    } catch (err) {
      skipped += 1;
      errors.push(
        `${item.workerName}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  await writeAudit({
    agentType: 'system',
    action: 'cred_remind',
    approvedBy: opts.remindedBy,
    notes: JSON.stringify({
      attempted: targets.length,
      sent,
      skipped,
      credentialId: opts.credentialId ?? null,
      withinDays: opts.withinDays ?? 30,
      errors: errors.slice(0, 10),
    }),
  });

  return { attempted: targets.length, sent, skipped, errors };
}
