import { getCoverageHeatmap } from './coverage';

export type ForecastDay = {
  date: string;
  label: string;
  required: number;
  assigned: number;
  vacant: number;
  fillRate: number;
  byBand: { band: string; required: number; assigned: number; vacant: number; fillRate: number }[];
};

export type PeriodForecast = {
  generatedAt: string;
  horizon: 'next';
  period: { start: string; end: string; label: string };
  comparePeriod: { start: string; end: string; label: string };
  fillRate: number;
  compareFillRate: number;
  delta: number;
  requiredSlots: number;
  assignedSlots: number;
  vacantSlots: number;
  days: ForecastDay[];
  thinDays: ForecastDay[];
  summaryText: string;
};

function aggregateDays(
  coverage: Awaited<ReturnType<typeof getCoverageHeatmap>>,
): ForecastDay[] {
  const byDay = new Map<string, ForecastDay>();
  for (const d of coverage.days) {
    byDay.set(d.date, {
      date: d.date,
      label: d.label,
      required: 0,
      assigned: 0,
      vacant: 0,
      fillRate: 100,
      byBand: [],
    });
  }
  for (const c of coverage.cells) {
    const day = byDay.get(c.day);
    if (!day) continue;
    day.required += c.required;
    day.assigned += c.assigned;
    day.vacant += c.vacant;
    day.byBand.push({
      band: c.band,
      required: c.required,
      assigned: c.assigned,
      vacant: c.vacant,
      fillRate: c.fillRate,
    });
  }
  for (const day of byDay.values()) {
    day.fillRate =
      day.required > 0 ? Math.round((day.assigned / day.required) * 100) : 100;
  }
  return Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export async function buildNextPeriodForecast(): Promise<PeriodForecast> {
  const [nextCov, periodCov] = await Promise.all([
    getCoverageHeatmap('next'),
    getCoverageHeatmap('period'),
  ]);

  const days = aggregateDays(nextCov);
  const activeDays = days.filter((d) => d.required > 0);
  const thinDays = activeDays.filter((d) => d.fillRate < 80).slice(0, 10);

  const fillRate = nextCov.totals.fillRate;
  const compareFillRate = periodCov.totals.fillRate;
  const delta = fillRate - compareFillRate;

  const summaryText =
    `Next Period Forecast (${nextCov.period.start} → ${nextCov.period.end})\n` +
    `Fill rate: ${fillRate}% (${nextCov.totals.vacant} vacant / ${nextCov.totals.required} required)\n` +
    `vs this period: ${compareFillRate}% (${delta >= 0 ? '+' : ''}${delta} pts)\n` +
    `Thin days (<80%): ${thinDays.length ? thinDays.map((d) => `${d.label} ${d.fillRate}%`).join(', ') : 'none'}`;

  return {
    generatedAt: new Date().toISOString(),
    horizon: 'next',
    period: {
      start: nextCov.period.start,
      end: nextCov.period.end,
      label: 'Next period (14d)',
    },
    comparePeriod: {
      start: periodCov.period.start,
      end: periodCov.period.end,
      label: 'This period (14d)',
    },
    fillRate,
    compareFillRate,
    delta,
    requiredSlots: nextCov.totals.required,
    assignedSlots: nextCov.totals.assigned,
    vacantSlots: nextCov.totals.vacant,
    days: activeDays.length > 0 ? activeDays : days.slice(0, 14),
    thinDays,
    summaryText,
  };
}
