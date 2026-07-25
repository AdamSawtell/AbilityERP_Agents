/**
 * SAW051 — iDempiere WebUI Zoom deep links.
 * Prefers Record_UU; falls back to Record_ID when UU is blank.
 * @see https://wiki.idempiere.org/en/NF2.1_Zoom_From_URL
 */

const DEFAULT_WEBUI = 'http://54.206.8.250/webui';
const ROSTERED_SHIFT_TABLE = 'AbERP_Rostered_Shift';

export function getIdempiereWebuiBase(): string {
  const raw =
    process.env.NEXT_PUBLIC_IDEMPIERE_WEBUI_URL ||
    process.env.IDEMPIERE_WEBUI_URL ||
    DEFAULT_WEBUI;
  return String(raw).trim().replace(/\/+$/, '');
}

export function rosteredShiftZoomUrl(opts: {
  shiftId: number;
  shiftUu?: string | null;
}): string | null {
  if (!Number.isFinite(opts.shiftId) || opts.shiftId <= 0) return null;
  const base = getIdempiereWebuiBase();
  if (!base) return null;

  const params = new URLSearchParams({
    Action: 'Zoom',
    TableName: ROSTERED_SHIFT_TABLE,
  });
  const uu = String(opts.shiftUu ?? '').trim();
  if (uu) {
    params.set('Record_UU', uu);
  } else {
    params.set('Record_ID', String(Math.trunc(opts.shiftId)));
  }
  return `${base}/?${params.toString()}`;
}
