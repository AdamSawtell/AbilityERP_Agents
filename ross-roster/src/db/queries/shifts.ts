import { query } from '../pool';
import type { ShiftContext } from '../../engine/types';

export type VacantShiftRow = {
  id: number;
  name: string;
  document_no: string | null;
  start_time: Date;
  end_time: Date;
  shift_type: string | null;
  location: string | null;
  location_id: number | null;
  required_staff: number | null;
  assigned_staff: number;
  transport_required: string | null;
};

function hoursUntil(start: Date): number {
  return (start.getTime() - Date.now()) / 3_600_000;
}

function urgency(hours: number): 'critical' | 'high' | 'normal' {
  if (hours < 4) return 'critical';
  if (hours < 24) return 'high';
  return 'normal';
}

export async function listVacantShifts(opts: {
  start: Date;
  end: Date;
  limit: number;
}): Promise<VacantShiftRow[]> {
  const { rows } = await query<VacantShiftRow>(
    `SELECT
        s.aberp_rostered_shift_id AS id,
        s.name,
        s.documentno AS document_no,
        COALESCE(s.starttime, s.startdate) AS start_time,
        COALESCE(s.endtime, s.enddate, s.starttime, s.startdate) AS end_time,
        st.name AS shift_type,
        ml.name AS location,
        s.aberp_masterlocation_id AS location_id,
        s.aberp_no_of_staff AS required_staff,
        COALESCE(staff_counts.cnt, 0)::int AS assigned_staff,
        COALESCE(s.aberp_transport_required, 'N') AS transport_required
     FROM adempiere.aberp_rostered_shift s
     LEFT JOIN adempiere.aberp_shift_type st
       ON st.aberp_shift_type_id = s.aberp_shift_type_id
     LEFT JOIN adempiere.aberp_masterlocation ml
       ON ml.aberp_masterlocation_id = s.aberp_masterlocation_id
     LEFT JOIN (
       SELECT aberp_rostered_shift_id, COUNT(*) AS cnt
       FROM adempiere.aberp_rostered_shiftstaff
       WHERE isactive = 'Y'
         AND c_bpartner_staff_id IS NOT NULL
         AND COALESCE(aberp_requestshift, 'N') <> 'Y'
         AND COALESCE(aberp_declineshift, 'N') <> 'Y'
       GROUP BY aberp_rostered_shift_id
     ) staff_counts ON staff_counts.aberp_rostered_shift_id = s.aberp_rostered_shift_id
     WHERE s.isactive = 'Y'
       AND COALESCE(s.iscancelled, 'N') = 'N'
       AND COALESCE(s.aberp_isshiftrosteredtemplate, 'N') = 'N'
       AND COALESCE(s.starttime, s.startdate) >= $1::timestamp
       AND COALESCE(s.starttime, s.startdate) <= $2::timestamp
       AND (
         s.aberp_no_of_staff IS NULL
         OR COALESCE(staff_counts.cnt, 0) < s.aberp_no_of_staff
       )
     ORDER BY COALESCE(s.starttime, s.startdate) ASC
     LIMIT $3`,
    [opts.start, opts.end, opts.limit],
  );
  return rows;
}

export function mapVacantShift(row: VacantShiftRow) {
  const start = new Date(row.start_time);
  const end = new Date(row.end_time);
  const hours = hoursUntil(start);
  return {
    id: Number(row.id),
    name: row.name,
    documentNo: row.document_no,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    shiftType: row.shift_type,
    location: row.location,
    requiredStaff: row.required_staff != null ? Number(row.required_staff) : null,
    assignedStaff: Number(row.assigned_staff),
    requirements: {
      transport: row.transport_required === 'Y',
    },
    status: 'vacant' as const,
    hoursUntilShift: Math.round(hours * 10) / 10,
    urgency: urgency(hours),
  };
}

export async function loadShiftContext(shiftId: number): Promise<ShiftContext | null> {
  const { rows } = await query<{
    id: number;
    name: string;
    document_no: string | null;
    start_time: Date;
    end_time: Date;
    location_id: number | null;
    location_name: string | null;
    required_staff: number | null;
    assigned_staff: number;
    transport_required: string | null;
  }>(
    `SELECT
        s.aberp_rostered_shift_id AS id,
        s.name,
        s.documentno AS document_no,
        COALESCE(s.starttime, s.startdate) AS start_time,
        COALESCE(s.endtime, s.enddate, s.starttime, s.startdate) AS end_time,
        s.aberp_masterlocation_id AS location_id,
        ml.name AS location_name,
        s.aberp_no_of_staff AS required_staff,
        COALESCE((
          SELECT COUNT(*)::int
          FROM adempiere.aberp_rostered_shiftstaff ss
          WHERE ss.aberp_rostered_shift_id = s.aberp_rostered_shift_id
            AND ss.isactive = 'Y'
            AND ss.c_bpartner_staff_id IS NOT NULL
            AND COALESCE(ss.aberp_requestshift, 'N') <> 'Y'
            AND COALESCE(ss.aberp_declineshift, 'N') <> 'Y'
        ), 0) AS assigned_staff,
        COALESCE(s.aberp_transport_required, 'N') AS transport_required
     FROM adempiere.aberp_rostered_shift s
     LEFT JOIN adempiere.aberp_masterlocation ml
       ON ml.aberp_masterlocation_id = s.aberp_masterlocation_id
     WHERE s.aberp_rostered_shift_id = $1
       AND s.isactive = 'Y'`,
    [shiftId],
  );

  const shift = rows[0];
  if (!shift) return null;

  const startTs = new Date(shift.start_time);
  const endTs = new Date(shift.end_time);

  const receivers = await query<{ id: number }>(
    `SELECT c_bpartner_id AS id
     FROM adempiere.aberp_rostered_shiftreceiver
     WHERE aberp_rostered_shift_id = $1 AND isactive = 'Y'`,
    [shiftId],
  );

  let credentialIds: number[] = [];
  let credentialNames: string[] = [];
  let genderIds: number[] = [];

  try {
    const needs = await query<{
      aberp_credentials_id: number | null;
      credential_name: string | null;
      aberp_gender_id: number | null;
      aberp_needtype: string | null;
    }>(
      `SELECT DISTINCT
          rv.aberp_credentials_id,
          c.name AS credential_name,
          rv.aberp_gender_id,
          rv.aberp_needtype
       FROM adempiere.aberp_related_rostering_needs_v rv
       LEFT JOIN adempiere.aberp_credentials c
         ON c.aberp_credentials_id = rv.aberp_credentials_id
       WHERE rv.aberp_rostered_shift_id = $1
         AND rv.isactive = 'Y'`,
      [shiftId],
    );

    for (const n of needs.rows) {
      if (n.aberp_needtype === 'CRD' && n.aberp_credentials_id) {
        credentialIds.push(Number(n.aberp_credentials_id));
        if (n.credential_name) credentialNames.push(n.credential_name);
      }
      if (n.aberp_needtype === 'GDR' && n.aberp_gender_id) {
        genderIds.push(Number(n.aberp_gender_id));
      }
    }
  } catch {
    // View may be missing on some builds — fall back to base table RS/SR only
    const needs = await query<{
      aberp_credentials_id: number | null;
      credential_name: string | null;
      aberp_gender_id: number | null;
      aberp_needtype: string | null;
    }>(
      `SELECT DISTINCT
          rn.aberp_credentials_id,
          c.name AS credential_name,
          rn.aberp_gender_id,
          rn.aberp_needtype
       FROM adempiere.aberp_sr_needs_rules rn
       LEFT JOIN adempiere.aberp_credentials c
         ON c.aberp_credentials_id = rn.aberp_credentials_id
       WHERE rn.isactive = 'Y'
         AND (
           (rn.aberp_needsassociation = 'RS' AND rn.aberp_rostered_shift_id = $1)
           OR (
             rn.aberp_needsassociation = 'SR'
             AND rn.c_bpartner_id IN (
               SELECT sr.c_bpartner_id
               FROM adempiere.aberp_rostered_shiftreceiver sr
               WHERE sr.aberp_rostered_shift_id = $1 AND sr.isactive = 'Y'
             )
           )
         )`,
      [shiftId],
    );
    for (const n of needs.rows) {
      if ((n.aberp_needtype === 'CRD' || !n.aberp_needtype) && n.aberp_credentials_id) {
        credentialIds.push(Number(n.aberp_credentials_id));
        if (n.credential_name) credentialNames.push(n.credential_name);
      }
      if ((n.aberp_needtype === 'GDR' || !n.aberp_needtype) && n.aberp_gender_id) {
        genderIds.push(Number(n.aberp_gender_id));
      }
    }
  }

  credentialIds = [...new Set(credentialIds)];
  genderIds = [...new Set(genderIds)];
  credentialNames = [...new Set(credentialNames)];

  const pad = (n: number) => String(n).padStart(2, '0');
  const startTimeLabel = `${pad(startTs.getHours())}:${pad(startTs.getMinutes())}`;
  const endTimeLabel = `${pad(endTs.getHours())}:${pad(endTs.getMinutes())}`;

  return {
    shiftId: Number(shift.id),
    name: shift.name,
    documentNo: shift.document_no,
    startTs,
    endTs,
    shiftDate: startTs.toISOString().slice(0, 10),
    startTimeLabel,
    endTimeLabel,
    locationId: shift.location_id != null ? Number(shift.location_id) : null,
    locationName: shift.location_name,
    requiredStaff: shift.required_staff != null ? Number(shift.required_staff) : null,
    assignedStaff: Number(shift.assigned_staff),
    transportRequired: shift.transport_required === 'Y',
    receiverIds: receivers.rows.map((r) => Number(r.id)),
    credentialIds,
    credentialNames,
    genderIds,
  };
}
