import { query } from '../db/pool';

export type CoverageBand = 'morning' | 'afternoon' | 'evening';

export type CoverageCell = {
  day: string;
  band: CoverageBand;
  shifts: number;
  required: number;
  assigned: number;
  vacant: number;
  fillRate: number;
  level: 'full' | 'ok' | 'thin' | 'gap' | 'empty';
};

export type CoverageResult = {
  horizon: string;
  period: { start: string; end: string };
  days: { date: string; label: string }[];
  bands: CoverageBand[];
  cells: CoverageCell[];
  totals: {
    shifts: number;
    required: number;
    assigned: number;
    vacant: number;
    fillRate: number;
  };
};

function horizonWindow(horizon: string): { start: Date; end: Date } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  if (horizon === 'today') {
    end.setDate(end.getDate() + 2);
  } else if (horizon === 'next') {
    start.setDate(start.getDate() + 14);
    end.setDate(end.getDate() + 28);
  } else {
    end.setDate(end.getDate() + 14);
  }
  return { start, end };
}

function levelFor(fillRate: number, vacant: number, shifts: number): CoverageCell['level'] {
  if (shifts === 0) return 'empty';
  if (vacant === 0 && fillRate >= 100) return 'full';
  if (fillRate >= 80) return 'ok';
  if (fillRate >= 40) return 'thin';
  return 'gap';
}

function dayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return dt.toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export async function getCoverageHeatmap(horizon = 'period'): Promise<CoverageResult> {
  const { start, end } = horizonWindow(horizon);
  const bands: CoverageBand[] = ['morning', 'afternoon', 'evening'];

  const { rows } = await query<{
    day: string;
    band: CoverageBand;
    shifts: string;
    required: string;
    assigned: string;
  }>(
    `WITH shift_rows AS (
       SELECT
         s.aberp_rostered_shift_id AS shift_id,
         to_char(
           timezone('Australia/Adelaide', COALESCE(s.starttime, s.startdate)),
           'YYYY-MM-DD'
         ) AS day,
         CASE
           WHEN EXTRACT(HOUR FROM timezone('Australia/Adelaide', COALESCE(s.starttime, s.startdate))) < 12
             THEN 'morning'
           WHEN EXTRACT(HOUR FROM timezone('Australia/Adelaide', COALESCE(s.starttime, s.startdate))) < 17
             THEN 'afternoon'
           ELSE 'evening'
         END AS band,
         GREATEST(COALESCE(s.aberp_no_of_staff, 1), 1)::int AS required,
         COALESCE((
           SELECT COUNT(*)::int
           FROM adempiere.aberp_rostered_shiftstaff ss
           WHERE ss.aberp_rostered_shift_id = s.aberp_rostered_shift_id
             AND ss.isactive = 'Y'
             AND ss.c_bpartner_staff_id IS NOT NULL
             AND COALESCE(ss.aberp_requestshift, 'N') <> 'Y'
             AND COALESCE(ss.aberp_declineshift, 'N') <> 'Y'
         ), 0) AS assigned
       FROM adempiere.aberp_rostered_shift s
       WHERE s.isactive = 'Y'
         AND COALESCE(s.iscancelled, 'N') = 'N'
         AND COALESCE(s.aberp_isshiftrosteredtemplate, 'N') = 'N'
         AND COALESCE(s.starttime, s.startdate) >= $1::timestamp
         AND COALESCE(s.starttime, s.startdate) <= $2::timestamp
     )
     SELECT
       day,
       band::text AS band,
       COUNT(*)::text AS shifts,
       SUM(required)::text AS required,
       SUM(LEAST(assigned, required))::text AS assigned
     FROM shift_rows
     GROUP BY day, band
     ORDER BY day, band`,
    [start, end],
  );

  const byKey = new Map<string, CoverageCell>();
  const daySet = new Set<string>();

  for (const r of rows) {
    daySet.add(r.day);
    const shifts = Number(r.shifts);
    const required = Number(r.required);
    const assigned = Number(r.assigned);
    const vacant = Math.max(required - assigned, 0);
    const fillRate = required > 0 ? Math.round((assigned / required) * 100) : 100;
    byKey.set(`${r.day}|${r.band}`, {
      day: r.day,
      band: r.band,
      shifts,
      required,
      assigned,
      vacant,
      fillRate,
      level: levelFor(fillRate, vacant, shifts),
    });
  }

  // Fill continuous day range for the horizon window (Adelaide calendar days)
  const days: { date: string; label: string }[] = [];
  const cursor = new Date(start);
  const endDay = new Date(end);
  while (cursor <= endDay) {
    const key = cursor.toLocaleDateString('en-CA', { timeZone: 'Australia/Adelaide' });
    // en-CA → YYYY-MM-DD
    days.push({ date: key, label: dayLabel(key) });
    cursor.setDate(cursor.getDate() + 1);
    if (days.length > 28) break;
  }

  // Prefer SQL days if locale mapping drifts
  for (const d of daySet) {
    if (!days.some((x) => x.date === d)) {
      days.push({ date: d, label: dayLabel(d) });
    }
  }
  days.sort((a, b) => a.date.localeCompare(b.date));

  const cells: CoverageCell[] = [];
  for (const d of days) {
    for (const band of bands) {
      cells.push(
        byKey.get(`${d.date}|${band}`) ?? {
          day: d.date,
          band,
          shifts: 0,
          required: 0,
          assigned: 0,
          vacant: 0,
          fillRate: 100,
          level: 'empty',
        },
      );
    }
  }

  const totals = cells.reduce(
    (acc, c) => {
      acc.shifts += c.shifts;
      acc.required += c.required;
      acc.assigned += c.assigned;
      acc.vacant += c.vacant;
      return acc;
    },
    { shifts: 0, required: 0, assigned: 0, vacant: 0, fillRate: 100 },
  );
  totals.fillRate =
    totals.required > 0 ? Math.round((totals.assigned / totals.required) * 100) : 100;

  return {
    horizon,
    period: {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    },
    days,
    bands,
    cells,
    totals,
  };
}
