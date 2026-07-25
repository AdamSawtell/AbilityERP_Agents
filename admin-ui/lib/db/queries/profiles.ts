import { query } from '../pool';
import { rosteredShiftZoomUrl } from '../../idempiere/zoom';
import { loadShiftContext } from './shifts';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export async function getWorkerProfile(workerId: number) {
  const { rows } = await query<{
    worker_id: number;
    name: string;
    gender_id: number | null;
    gender_name: string | null;
    hr_exclude: string | null;
    ad_user_id: number | null;
    contract_hrs: number | null;
    max_contract_hrs: number | null;
    location_id: number | null;
    location_name: string | null;
  }>(
    `SELECT
        bp.c_bpartner_id AS worker_id,
        bp.name,
        bp.aberp_gender_id AS gender_id,
        g.name AS gender_name,
        COALESCE(hr.hr_exclude, 'N') AS hr_exclude,
        au.ad_user_id,
        ec.aberp_contract_hrs AS contract_hrs,
        ec.aberp_max_contract_hrs AS max_contract_hrs,
        ec.aberp_masterlocation_id AS location_id,
        ml.name AS location_name
     FROM adempiere.c_bpartner bp
     LEFT JOIN adempiere.ad_user au
       ON au.c_bpartner_id = bp.c_bpartner_id AND au.isactive = 'Y'
     LEFT JOIN adempiere.hr_employee hr ON hr.c_bpartner_id = bp.c_bpartner_id
     LEFT JOIN adempiere.aberp_gender g ON g.aberp_gender_id = bp.aberp_gender_id
     LEFT JOIN LATERAL (
       SELECT aberp_contract_hrs, aberp_max_contract_hrs, aberp_masterlocation_id
       FROM adempiere.aberp_employee_contract
       WHERE aberp_user_contact_id = au.ad_user_id AND isactive = 'Y'
       ORDER BY updated DESC NULLS LAST
       LIMIT 1
     ) ec ON TRUE
     LEFT JOIN adempiere.aberp_masterlocation ml
       ON ml.aberp_masterlocation_id = ec.aberp_masterlocation_id
     WHERE bp.c_bpartner_id = $1
     LIMIT 1`,
    [workerId],
  );

  const w = rows[0];
  if (!w) return null;

  let credentials: {
    name: string;
    status: string;
    expiryDate: string | null;
  }[] = [];

  try {
    const creds = await query<{
      name: string;
      expiry: Date | null;
    }>(
      `SELECT c.name, ca.aberp_expirydate AS expiry
       FROM adempiere.aberp_credentialassignment ca
       JOIN adempiere.aberp_credentials c
         ON c.aberp_credentials_id = ca.aberp_credentials_id
       WHERE ca.c_bpartner_staff_id = $1
         AND COALESCE(ca.isactive, 'Y') = 'Y'
       ORDER BY c.name
       LIMIT 40`,
      [workerId],
    );
    const now = Date.now();
    credentials = creds.rows.map((c) => {
      const exp = c.expiry ? new Date(c.expiry) : null;
      let status = 'valid';
      if (exp && exp.getTime() < now) status = 'expired';
      else if (exp && exp.getTime() < now + 30 * 86_400_000) status = 'expiring';
      return {
        name: c.name,
        status,
        expiryDate: exp ? exp.toISOString().slice(0, 10) : null,
      };
    });
  } catch {
    credentials = [];
  }

  let thisWeekShifts: {
    date: string;
    shiftName: string;
    time: string;
    status: string;
    shiftId: number;
  }[] = [];

  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const shifts = await query<{
      shift_id: number;
      name: string;
      start_time: Date;
      end_time: Date;
    }>(
      `SELECT
          s.aberp_rostered_shift_id AS shift_id,
          s.name,
          COALESCE(s.starttime, s.startdate) AS start_time,
          COALESCE(s.endtime, s.enddate, s.starttime, s.startdate) AS end_time
       FROM adempiere.aberp_rostered_shiftstaff ss
       JOIN adempiere.aberp_rostered_shift s
         ON s.aberp_rostered_shift_id = ss.aberp_rostered_shift_id
       WHERE ss.c_bpartner_staff_id = $1
         AND ss.isactive = 'Y'
         AND COALESCE(ss.aberp_declineshift, 'N') <> 'Y'
         AND COALESCE(s.starttime, s.startdate) >= $2
         AND COALESCE(s.starttime, s.startdate) < $3
       ORDER BY COALESCE(s.starttime, s.startdate)
       LIMIT 20`,
      [workerId, start, end],
    );
    thisWeekShifts = shifts.rows.map((s) => {
      const st = new Date(s.start_time);
      const en = new Date(s.end_time);
      return {
        shiftId: Number(s.shift_id),
        date: st.toISOString().slice(0, 10),
        shiftName: s.name,
        time: `${st.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}–${en.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`,
        status: 'assigned',
      };
    });
  } catch {
    thisWeekShifts = [];
  }

  let pastAssignments: { client: string; count: number }[] = [];
  try {
    const past = await query<{ client: string; cnt: string }>(
      `SELECT bp.name AS client, COUNT(*)::text AS cnt
       FROM adempiere.aberp_rostered_shiftstaff ss
       JOIN adempiere.aberp_rostered_shift s
         ON s.aberp_rostered_shift_id = ss.aberp_rostered_shift_id
       JOIN adempiere.aberp_rostered_shiftreceiver sr
         ON sr.aberp_rostered_shift_id = s.aberp_rostered_shift_id AND sr.isactive = 'Y'
       JOIN adempiere.c_bpartner bp ON bp.c_bpartner_id = sr.c_bpartner_id
       WHERE ss.c_bpartner_staff_id = $1
         AND ss.isactive = 'Y'
         AND COALESCE(ss.aberp_declineshift, 'N') <> 'Y'
         AND COALESCE(s.starttime, s.startdate) < NOW()
       GROUP BY bp.name
       ORDER BY COUNT(*) DESC
       LIMIT 8`,
      [workerId],
    );
    pastAssignments = past.rows.map((r) => ({
      client: r.client,
      count: Number(r.cnt),
    }));
  } catch {
    pastAssignments = [];
  }

  const status = (w.hr_exclude ?? 'N') === 'Y' ? 'excluded' : 'available';

  return {
    workerId: Number(w.worker_id),
    name: w.name,
    initials: initials(w.name),
    status,
    gender: w.gender_name,
    zone: w.location_name,
    contract: {
      hoursPerWeek: w.contract_hrs != null ? Number(w.contract_hrs) : null,
      maxHoursPerWeek: w.max_contract_hrs != null ? Number(w.max_contract_hrs) : null,
      locationId: w.location_id != null ? Number(w.location_id) : null,
    },
    credentials,
    thisWeekShifts,
    pastAssignments,
  };
}

export async function getShiftDetail(shiftId: number) {
  const ctx = await loadShiftContext(shiftId);
  if (!ctx) return null;

  const staff = await query<{
    staff_id: number | null;
    staff_name: string | null;
    line: number | null;
    request: string | null;
    decline: string | null;
  }>(
    `SELECT
        ss.c_bpartner_staff_id AS staff_id,
        bp.name AS staff_name,
        ss.line,
        ss.aberp_requestshift AS request,
        ss.aberp_declineshift AS decline
     FROM adempiere.aberp_rostered_shiftstaff ss
     LEFT JOIN adempiere.c_bpartner bp ON bp.c_bpartner_id = ss.c_bpartner_staff_id
     WHERE ss.aberp_rostered_shift_id = $1 AND ss.isactive = 'Y'
     ORDER BY ss.line NULLS LAST, ss.aberp_rostered_shiftstaff_id`,
    [shiftId],
  );

  let receivers: { id: number; name: string }[] = [];
  try {
    const rec = await query<{ id: number; name: string }>(
      `SELECT sr.c_bpartner_id AS id, bp.name
       FROM adempiere.aberp_rostered_shiftreceiver sr
       JOIN adempiere.c_bpartner bp ON bp.c_bpartner_id = sr.c_bpartner_id
       WHERE sr.aberp_rostered_shift_id = $1 AND sr.isactive = 'Y'`,
      [shiftId],
    );
    receivers = rec.rows.map((r) => ({ id: Number(r.id), name: r.name }));
  } catch {
    receivers = [];
  }

  const pending = await query<{
    id: number;
    worker_id: number;
    worker_name: string;
    score: number;
  }>(
    `SELECT id, worker_id, worker_name, score
     FROM adempiere.rostering_agent_proposals
     WHERE shift_id = $1 AND status = 'pending'
     ORDER BY score DESC, proposed_at ASC
     LIMIT 10`,
    [shiftId],
  );

  const start = new Date(ctx.startTs);
  const end = new Date(ctx.endTs);
  const hoursUntil = (start.getTime() - Date.now()) / 3_600_000;

  const uuRow = await query<{ shift_uu: string | null }>(
    `SELECT NULLIF(TRIM(aberp_rostered_shift_uu), '') AS shift_uu
     FROM adempiere.aberp_rostered_shift
     WHERE aberp_rostered_shift_id = $1`,
    [shiftId],
  );
  const shiftUu = uuRow.rows[0]?.shift_uu ?? null;

  return {
    shiftId: ctx.shiftId,
    name: ctx.name,
    documentNo: ctx.documentNo,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    shiftDate: ctx.shiftDate,
    startTimeLabel: ctx.startTimeLabel,
    endTimeLabel: ctx.endTimeLabel,
    location: ctx.locationName,
    locationId: ctx.locationId,
    requiredStaff: ctx.requiredStaff,
    assignedStaff: ctx.assignedStaff,
    transportRequired: ctx.transportRequired,
    credentialNames: ctx.credentialNames,
    genderIds: ctx.genderIds,
    hoursUntilShift: Math.round(hoursUntil * 10) / 10,
    shiftUu,
    erpUrl: rosteredShiftZoomUrl({ shiftId: ctx.shiftId, shiftUu }),
    receivers,
    staffLines: staff.rows.map((s) => ({
      workerId: s.staff_id != null ? Number(s.staff_id) : null,
      workerName: s.staff_name,
      line: s.line != null ? Number(s.line) : null,
      vacant: s.staff_id == null,
      request: s.request === 'Y',
      decline: s.decline === 'Y',
    })),
    pendingProposals: pending.rows.map((p) => ({
      id: Number(p.id),
      workerId: Number(p.worker_id),
      workerName: p.worker_name,
      score: Number(p.score),
    })),
  };
}
