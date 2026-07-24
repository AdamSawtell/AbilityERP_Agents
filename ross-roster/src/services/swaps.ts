import { query, withClient } from '../db/pool';
import {
  buildSwapProposeMessage,
  resolveWorkerUserId,
  sendPathwaysMessage,
} from '../pathways';
import { writeAudit } from './audit';

export type SwapRow = {
  id: number;
  requester_id: number;
  requester_name: string | null;
  partner_id: number;
  partner_name: string | null;
  shift_a_id: number;
  shift_a_name: string | null;
  shift_b_id: number;
  shift_b_name: string | null;
  staff_line_a_id: number | null;
  staff_line_b_id: number | null;
  requester_response: string;
  partner_response: string;
  status: string;
  pathways_request_a_id: number | null;
  pathways_request_b_id: number | null;
  score: number | null;
  source: string | null;
  notes: string | null;
  proposed_at: Date;
  reviewed_by: string | null;
  reviewed_at: Date | null;
};

export type AssignedShift = {
  staff_line_id: number;
  shift_id: number;
  shift_name: string;
  worker_id: number;
  worker_name: string;
  ad_client_id: number;
  start_ts: Date;
  end_ts: Date;
  day_key: string;
};

function mapSwap(r: SwapRow) {
  return {
    id: Number(r.id),
    requesterId: Number(r.requester_id),
    requesterName: r.requester_name,
    partnerId: Number(r.partner_id),
    partnerName: r.partner_name,
    shiftAId: Number(r.shift_a_id),
    shiftAName: r.shift_a_name,
    shiftBId: Number(r.shift_b_id),
    shiftBName: r.shift_b_name,
    staffLineAId: r.staff_line_a_id != null ? Number(r.staff_line_a_id) : null,
    staffLineBId: r.staff_line_b_id != null ? Number(r.staff_line_b_id) : null,
    requesterResponse: r.requester_response,
    partnerResponse: r.partner_response,
    status: r.status,
    score: r.score != null ? Number(r.score) : null,
    source: r.source,
    notes: r.notes,
    proposedAt: r.proposed_at,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
  };
}

export async function listSwaps(opts: {
  status?: string;
  limit?: number;
}): Promise<ReturnType<typeof mapSwap>[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  if (opts.status === 'all') {
    const { rows } = await query<SwapRow>(
      `SELECT * FROM adempiere.rostering_agent_swaps
       ORDER BY proposed_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map(mapSwap);
  }
  if (opts.status) {
    const { rows } = await query<SwapRow>(
      `SELECT * FROM adempiere.rostering_agent_swaps
       WHERE status = $1::varchar
       ORDER BY proposed_at DESC LIMIT $2`,
      [opts.status, limit],
    );
    return rows.map(mapSwap);
  }
  const { rows } = await query<SwapRow>(
    `SELECT * FROM adempiere.rostering_agent_swaps
     WHERE status = 'proposed'
     ORDER BY proposed_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map(mapSwap);
}

export async function getSwap(id: number): Promise<SwapRow | null> {
  const { rows } = await query<SwapRow>(
    `SELECT * FROM adempiere.rostering_agent_swaps WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function listUpcomingAssignments(withinDays = 7): Promise<AssignedShift[]> {
  const { rows } = await query<{
    staff_line_id: number;
    shift_id: number;
    shift_name: string;
    worker_id: number;
    worker_name: string;
    ad_client_id: number;
    start_ts: Date;
    end_ts: Date;
    day_key: string;
  }>(
    `SELECT
        ss.aberp_rostered_shiftstaff_id AS staff_line_id,
        s.aberp_rostered_shift_id AS shift_id,
        s.name AS shift_name,
        ss.c_bpartner_staff_id AS worker_id,
        bp.name AS worker_name,
        s.ad_client_id,
        COALESCE(s.starttime, s.startdate) AS start_ts,
        COALESCE(s.endtime, s.enddate, s.starttime, s.startdate) AS end_ts,
        to_char(
          timezone('Australia/Adelaide', COALESCE(s.starttime, s.startdate)),
          'YYYY-MM-DD'
        ) AS day_key
     FROM adempiere.aberp_rostered_shiftstaff ss
     JOIN adempiere.aberp_rostered_shift s
       ON s.aberp_rostered_shift_id = ss.aberp_rostered_shift_id
     JOIN adempiere.c_bpartner bp ON bp.c_bpartner_id = ss.c_bpartner_staff_id
     WHERE ss.isactive = 'Y'
       AND ss.c_bpartner_staff_id IS NOT NULL
       AND COALESCE(ss.aberp_declineshift, 'N') <> 'Y'
       AND COALESCE(ss.aberp_requestshift, 'N') <> 'Y'
       AND COALESCE(s.iscancelled, 'N') = 'N'
       AND COALESCE(s.starttime, s.startdate) > NOW() + interval '1 hour'
       AND COALESCE(s.starttime, s.startdate) <= NOW() + make_interval(days => $1::int)
     ORDER BY COALESCE(s.starttime, s.startdate)
     LIMIT 80`,
    [withinDays],
  );

  return rows.map((r) => ({
    staff_line_id: Number(r.staff_line_id),
    shift_id: Number(r.shift_id),
    shift_name: r.shift_name,
    worker_id: Number(r.worker_id),
    worker_name: r.worker_name,
    ad_client_id: Number(r.ad_client_id),
    start_ts: new Date(r.start_ts),
    end_ts: new Date(r.end_ts),
    day_key: r.day_key,
  }));
}

/** Worker free for target shift window, ignoring a staff line they are giving up. */
async function isFreeForShift(opts: {
  workerId: number;
  start: Date;
  end: Date;
  ignoreStaffLineId: number;
}): Promise<boolean> {
  const { rows } = await query<{ ok: number }>(
    `SELECT 1 AS ok
     WHERE NOT EXISTS (
       SELECT 1
       FROM adempiere.aberp_rostered_shiftstaff ss
       JOIN adempiere.aberp_rostered_shift s
         ON s.aberp_rostered_shift_id = ss.aberp_rostered_shift_id
       WHERE ss.isactive = 'Y'
         AND ss.c_bpartner_staff_id = $1
         AND ss.aberp_rostered_shiftstaff_id <> $2
         AND COALESCE(ss.aberp_declineshift, 'N') <> 'Y'
         AND COALESCE(s.starttime, s.startdate) < $4
         AND COALESCE(s.endtime, s.enddate, s.starttime, s.startdate) > $3
     )
     AND NOT EXISTS (
       SELECT 1
       FROM adempiere.aberp_unavailability_leave ul
       JOIN adempiere.ad_user au
         ON au.c_bpartner_id = $1 AND au.isactive = 'Y'
       WHERE ul.isactive = 'Y'
         AND ul.aberp_approverstatus = 'AP'
         AND (
           ul.aberp_user_contact_id = au.ad_user_id
           OR ul.c_bpartner_staff_id = $1
         )
         AND ul.startdate <= $4
         AND ul.enddate >= $3
     )`,
    [opts.workerId, opts.ignoreStaffLineId, opts.start, opts.end],
  );
  return rows.length > 0;
}

async function openSwapExists(shiftAId: number, shiftBId: number): Promise<boolean> {
  const { rows } = await query<{ id: number }>(
    `SELECT id FROM adempiere.rostering_agent_swaps
     WHERE status = 'proposed'
       AND (
         (shift_a_id = $1 AND shift_b_id = $2)
         OR (shift_a_id = $2 AND shift_b_id = $1)
       )
     LIMIT 1`,
    [shiftAId, shiftBId],
  );
  return rows.length > 0;
}

export async function createSwapProposal(opts: {
  shiftA: AssignedShift;
  shiftB: AssignedShift;
  source: string;
  notify?: boolean;
}): Promise<number> {
  const a = opts.shiftA;
  const b = opts.shiftB;

  const { rows } = await query<{ id: number }>(
    `INSERT INTO adempiere.rostering_agent_swaps (
        requester_id, requester_name, partner_id, partner_name,
        shift_a_id, shift_a_name, shift_b_id, shift_b_name,
        staff_line_a_id, staff_line_b_id,
        status, score, source, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'proposed',50,$11,$12)
     RETURNING id`,
    [
      a.worker_id,
      a.worker_name,
      b.worker_id,
      b.worker_name,
      a.shift_id,
      a.shift_name,
      b.shift_id,
      b.shift_name,
      a.staff_line_id,
      b.staff_line_id,
      opts.source,
      `Swap ${a.day_key} ↔ ${b.day_key}`,
    ],
  );
  const id = Number(rows[0].id);

  let requestA: number | null = null;
  let requestB: number | null = null;

  if (opts.notify !== false) {
    const userA = await resolveWorkerUserId(a.worker_id);
    const userB = await resolveWorkerUserId(b.worker_id);

    if (userA != null) {
      const msgA = await buildSwapProposeMessage({
        toName: a.worker_name,
        otherName: b.worker_name,
        giveShiftName: a.shift_name,
        giveStart: a.start_ts,
        takeShiftName: b.shift_name,
        takeStart: b.start_ts,
        perspective: 'requester',
      });
      const sent = await sendPathwaysMessage({
        workerAdUserId: userA,
        workerBPartnerId: a.worker_id,
        shiftId: a.shift_id,
        message: msgA,
        adClientId: a.ad_client_id,
      });
      requestA = sent.requestId;
    }

    if (userB != null) {
      const msgB = await buildSwapProposeMessage({
        toName: b.worker_name,
        otherName: a.worker_name,
        giveShiftName: b.shift_name,
        giveStart: b.start_ts,
        takeShiftName: a.shift_name,
        takeStart: a.start_ts,
        perspective: 'partner',
      });
      const sent = await sendPathwaysMessage({
        workerAdUserId: userB,
        workerBPartnerId: b.worker_id,
        shiftId: b.shift_id,
        message: msgB,
        adClientId: b.ad_client_id,
      });
      requestB = sent.requestId;
    }

    if (requestA != null || requestB != null) {
      await query(
        `UPDATE adempiere.rostering_agent_swaps
         SET pathways_request_a_id = $2, pathways_request_b_id = $3
         WHERE id = $1`,
        [id, requestA, requestB],
      );
    }
  }

  await writeAudit({
    agentType: 'system',
    action: 'swap_proposed',
    shiftId: a.shift_id,
    workerId: a.worker_id,
    notes: `swap #${id}: ${a.worker_name}↔${b.worker_name}; shifts ${a.shift_id}/${b.shift_id}; source=${opts.source}`,
  });

  return id;
}

/** Detect cross-day assignment pairs that can exchange without clash/leave. */
export async function detectAndProposeSwaps(limit = 5): Promise<{
  proposed: number;
  considered: number;
  errors: string[];
}> {
  const assignments = await listUpcomingAssignments(7);
  let proposed = 0;
  let considered = 0;
  const errors: string[] = [];
  const usedShifts = new Set<number>();

  for (let i = 0; i < assignments.length && proposed < limit; i += 1) {
    for (let j = i + 1; j < assignments.length && proposed < limit; j += 1) {
      const a = assignments[i];
      const b = assignments[j];
      if (a.worker_id === b.worker_id) continue;
      if (a.day_key === b.day_key) continue;
      if (usedShifts.has(a.shift_id) || usedShifts.has(b.shift_id)) continue;

      considered += 1;

      try {
        if (await openSwapExists(a.shift_id, b.shift_id)) continue;

        const partnerOk = await isFreeForShift({
          workerId: b.worker_id,
          start: a.start_ts,
          end: a.end_ts,
          ignoreStaffLineId: b.staff_line_id,
        });
        const requesterOk = await isFreeForShift({
          workerId: a.worker_id,
          start: b.start_ts,
          end: b.end_ts,
          ignoreStaffLineId: a.staff_line_id,
        });
        if (!partnerOk || !requesterOk) continue;

        const id = await createSwapProposal({
          shiftA: a,
          shiftB: b,
          source: 'detect',
        });
        usedShifts.add(a.shift_id);
        usedShifts.add(b.shift_id);
        proposed += 1;
        console.log(`[ross] swap proposed #${id}: ${a.worker_name}↔${b.worker_name}`);
      } catch (err) {
        errors.push(
          `${a.shift_id}/${b.shift_id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return { proposed, considered, errors };
}

/** Scan Pathways chats for "swap" keyword (intent signal; pairs still via detect). */
export async function scanSwapIntents(): Promise<number> {
  const { rows } = await query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM adempiere.r_request r
     JOIN adempiere.r_requesttype rt ON rt.r_requesttype_id = r.r_requesttype_id
     WHERE rt.name = 'Rostering Chat'
       AND r.isactive = 'Y'
       AND r.updated > NOW() - interval '48 hours'
       AND (
         COALESCE(r.lastresult, '') ILIKE '%swap%'
         OR EXISTS (
           SELECT 1 FROM adempiere.r_requestupdate u
           WHERE u.r_request_id = r.r_request_id
             AND COALESCE(u.result, '') ILIKE '%swap%'
             AND u.created > NOW() - interval '48 hours'
         )
       )`,
  );
  return Number(rows[0]?.cnt ?? 0);
}

async function executeSwapRewrite(swap: SwapRow): Promise<void> {
  const lineA = Number(swap.staff_line_a_id);
  const lineB = Number(swap.staff_line_b_id);
  const requesterId = Number(swap.requester_id);
  const partnerId = Number(swap.partner_id);

  if (!Number.isFinite(lineA) || !Number.isFinite(lineB)) {
    throw new Error('missing_staff_lines');
  }

  const userA = await resolveWorkerUserId(requesterId);
  const userB = await resolveWorkerUserId(partnerId);

  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      // Partner takes shift A (requester's line)
      await client.query(
        `UPDATE adempiere.aberp_rostered_shiftstaff
         SET c_bpartner_staff_id = $2,
             aberp_user_contact_id = $3,
             aberp_declineshift = 'N',
             aberp_requestshift = 'N',
             updated = NOW(),
             updatedby = 100
         WHERE aberp_rostered_shiftstaff_id = $1
           AND c_bpartner_staff_id = $4`,
        [lineA, partnerId, userB, requesterId],
      );

      // Requester takes shift B (partner's line)
      await client.query(
        `UPDATE adempiere.aberp_rostered_shiftstaff
         SET c_bpartner_staff_id = $2,
             aberp_user_contact_id = $3,
             aberp_declineshift = 'N',
             aberp_requestshift = 'N',
             updated = NOW(),
             updatedby = 100
         WHERE aberp_rostered_shiftstaff_id = $1
           AND c_bpartner_staff_id = $4`,
        [lineB, requesterId, userA, partnerId],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

export async function approveSwap(
  id: number,
  by: string,
  notes?: string,
): Promise<SwapRow | null> {
  const swap = await getSwap(id);
  if (!swap || swap.status !== 'proposed') return null;

  await executeSwapRewrite(swap);

  const { rows } = await query<SwapRow>(
    `UPDATE adempiere.rostering_agent_swaps
     SET status = 'approved',
         requester_response = 'accepted',
         partner_response = 'accepted',
         reviewed_by = $2,
         reviewed_at = NOW(),
         notes = CASE
           WHEN $3::text IS NULL OR $3::text = '' THEN notes
           WHEN notes IS NULL OR notes = '' THEN $3::text
           ELSE notes || ' | ' || $3::text
         END
     WHERE id = $1
     RETURNING *`,
    [id, by, notes ?? 'Admin approved'],
  );

  await writeAudit({
    agentType: 'system',
    action: 'swap_approved',
    shiftId: Number(swap.shift_a_id),
    workerId: Number(swap.requester_id),
    approvedBy: by,
    notes: `swap #${id} approved; ${swap.requester_name}↔${swap.partner_name}`,
  });

  // Notify both of completion
  try {
    const userA = await resolveWorkerUserId(Number(swap.requester_id));
    const userB = await resolveWorkerUserId(Number(swap.partner_id));
    const { rows: clientRows } = await query<{ ad_client_id: number }>(
      `SELECT ad_client_id FROM adempiere.aberp_rostered_shift WHERE aberp_rostered_shift_id = $1`,
      [swap.shift_a_id],
    );
    const adClientId = Number(clientRows[0]?.ad_client_id ?? 1000000);
    const done =
      `Swap confirmed: you now have each other's shifts.\n` +
      `${swap.shift_a_name} ↔ ${swap.shift_b_name}`;
    if (userA != null) {
      await sendPathwaysMessage({
        workerAdUserId: userA,
        workerBPartnerId: Number(swap.requester_id),
        shiftId: Number(swap.shift_b_id),
        message: done,
        adClientId,
      });
    }
    if (userB != null) {
      await sendPathwaysMessage({
        workerAdUserId: userB,
        workerBPartnerId: Number(swap.partner_id),
        shiftId: Number(swap.shift_a_id),
        message: done,
        adClientId,
      });
    }
  } catch (err) {
    console.error('[ross] swap notify after approve failed', err);
  }

  return rows[0] ?? null;
}

export async function rejectSwap(
  id: number,
  by: string,
  notes?: string,
): Promise<SwapRow | null> {
  const { rows } = await query<SwapRow>(
    `UPDATE adempiere.rostering_agent_swaps
     SET status = 'rejected',
         reviewed_by = $2,
         reviewed_at = NOW(),
         notes = CASE
           WHEN $3::text IS NULL OR $3::text = '' THEN notes
           WHEN notes IS NULL OR notes = '' THEN $3::text
           ELSE notes || ' | ' || $3::text
         END
     WHERE id = $1 AND status = 'proposed'
     RETURNING *`,
    [id, by, notes ?? 'Rejected'],
  );
  if (!rows[0]) return null;

  await writeAudit({
    agentType: 'system',
    action: 'swap_proposed',
    shiftId: Number(rows[0].shift_a_id),
    workerId: Number(rows[0].requester_id),
    approvedBy: by,
    notes: `swap #${id} rejected: ${notes ?? ''}`,
  });
  return rows[0];
}

export async function respondSwap(
  id: number,
  party: 'requester' | 'partner',
  response: 'accepted' | 'declined',
  by: string,
): Promise<{ swap: SwapRow; executed: boolean } | null> {
  const swap = await getSwap(id);
  if (!swap || swap.status !== 'proposed') return null;

  const note = `${party} ${response} by ${by}`;
  const sql =
    party === 'requester'
      ? `UPDATE adempiere.rostering_agent_swaps
         SET requester_response = $2::varchar,
             notes = CASE
               WHEN notes IS NULL OR notes = '' THEN $3::text
               ELSE notes || ' | ' || $3::text
             END
         WHERE id = $1 AND status = 'proposed'
         RETURNING *`
      : `UPDATE adempiere.rostering_agent_swaps
         SET partner_response = $2::varchar,
             notes = CASE
               WHEN notes IS NULL OR notes = '' THEN $3::text
               ELSE notes || ' | ' || $3::text
             END
         WHERE id = $1 AND status = 'proposed'
         RETURNING *`;
  const { rows } = await query<SwapRow>(sql, [id, response, note]);
  const updated = rows[0];
  if (!updated) return null;

  if (response === 'declined') {
    const rejected = await rejectSwap(id, by, `${party} declined`);
    return rejected ? { swap: rejected, executed: false } : null;
  }

  if (
    updated.requester_response === 'accepted' &&
    updated.partner_response === 'accepted'
  ) {
    const approved = await approveSwap(id, by, 'Both parties accepted');
    return approved ? { swap: approved, executed: true } : null;
  }

  return { swap: updated, executed: false };
}

export async function createManualSwap(opts: {
  shiftAId: number;
  shiftBId: number;
  source?: string;
  notify?: boolean;
}): Promise<number> {
  const assignments = await listUpcomingAssignments(14);
  const a = assignments.find((x) => x.shift_id === opts.shiftAId);
  const b = assignments.find((x) => x.shift_id === opts.shiftBId);
  if (!a || !b) throw new Error('shift_not_assigned_or_out_of_window');
  if (a.worker_id === b.worker_id) throw new Error('same_worker');
  if (await openSwapExists(a.shift_id, b.shift_id)) throw new Error('swap_already_open');

  return createSwapProposal({
    shiftA: a,
    shiftB: b,
    source: opts.source ?? 'manual',
    notify: opts.notify,
  });
}
