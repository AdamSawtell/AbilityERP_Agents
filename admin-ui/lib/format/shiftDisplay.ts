/** SAW050 — Human-readable shift / match labels for officer UI. */

const RULE_LABELS: Record<string, string> = {
  not_excluded: 'Cleared for work',
  not_on_leave: 'Not on leave',
  no_time_clash: 'No clash',
  credentials_held: 'Credentials OK',
  gender_preference: 'Gender match',
  continuity_of_care: 'Knows the client',
  location_proximity: 'Same location',
  availability_pattern: 'Available that day',
  contract_capacity: 'Hours available',
  transport_match: 'Can transport',
  response_history: 'Past response',
  min_break_between_shifts: 'Rest between shifts',
  max_weekly_hours: 'Within weekly hours',
  max_consecutive_days: 'Consecutive days',
  max_shift_hours: 'Shift length',
};

export function ruleLabel(rule: string): string {
  return RULE_LABELS[rule] ?? rule.replace(/_/g, ' ');
}

/** Prefer Adelaide wall-clock for roster officers. */
const TZ = 'Australia/Adelaide';

export function formatShiftWhen(
  startIso?: string | null,
  endIso?: string | null,
): { day: string; time: string; relative: string } {
  if (!startIso) {
    return { day: 'Date unknown', time: '—', relative: '' };
  }
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : null;
  if (Number.isNaN(start.getTime())) {
    return { day: 'Date unknown', time: '—', relative: '' };
  }

  const day = new Intl.DateTimeFormat('en-AU', {
    timeZone: TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(start);

  const timeFmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const startLabel = timeFmt.format(start);
  const endLabel = end && !Number.isNaN(end.getTime()) ? timeFmt.format(end) : null;
  const time = endLabel ? `${startLabel} – ${endLabel}` : startLabel;

  const hours = (start.getTime() - Date.now()) / 3_600_000;
  let relative = '';
  if (hours < 0) relative = 'started';
  else if (hours < 4) relative = `in ${Math.max(1, Math.round(hours * 60))}m`;
  else if (hours < 48) relative = `in ${Math.round(hours)}h`;
  else relative = `in ${Math.round(hours / 24)}d`;

  return { day, time, relative };
}

/** Pull a short client-facing title from noisy ERP shift names. */
export function shortShiftTitle(name: string | null | undefined, clients?: string | null): string {
  const client = String(clients ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)[0];
  if (client) return client;

  const raw = String(name ?? '').trim();
  if (!raw) return 'Vacant shift';

  // "… SR Benjamin complete" / "SR Benjamin"
  const sr = raw.match(/\bSR\s+([A-Za-z][A-Za-z0-9' -]{1,40})/i);
  if (sr?.[1]) return sr[1].trim();

  // Drop seed/noise prefixes
  const cleaned = raw
    .replace(/^StaffInfo\s+/i, '')
    .replace(/\bSeed\s+\d+\s*/i, '')
    .replace(/\bcomplete\b/gi, '')
    .replace(/#\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length > 0 && cleaned.length <= 48) return cleaned;
  return cleaned.slice(0, 45).trim() + (cleaned.length > 45 ? '…' : '') || 'Vacant shift';
}

export function staffingLabel(
  assigned?: number | null,
  required?: number | null,
): string {
  const a = assigned ?? 0;
  const r = required ?? 1;
  const open = Math.max(0, r - a);
  if (open <= 0) return `${a}/${r} filled`;
  return `${a}/${r} · ${open} open`;
}
