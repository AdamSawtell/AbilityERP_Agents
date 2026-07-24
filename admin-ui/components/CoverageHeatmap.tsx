'use client';

import type { CoverageHeatmap as CoverageData, Horizon } from '@/lib/ross';

const BAND_LABEL: Record<string, string> = {
  morning: 'AM',
  afternoon: 'PM',
  evening: 'Eve',
};

type Props = {
  data: CoverageData | null;
  horizon: Horizon;
  loading?: boolean;
};

export function CoverageHeatmap({ data, horizon, loading }: Props) {
  if (loading && !data) {
    return <p className="widget-foot">Loading coverage…</p>;
  }
  if (!data || data.days.length === 0) {
    return <p className="widget-foot">No coverage data for this horizon.</p>;
  }

  const visibleDays = data.days.slice(0, horizon === 'today' ? 3 : 7);
  const cellMap = new Map(data.cells.map((c) => [`${c.day}|${c.band}`, c]));

  return (
    <div className="heatmap">
      <div
        className="heatmap-grid"
        style={{ gridTemplateColumns: `36px repeat(${visibleDays.length}, minmax(0, 1fr))` }}
      >
        <div className="heatmap-corner" />
        {visibleDays.map((d) => (
          <div key={d.date} className="heatmap-day" title={d.date}>
            {d.label.split(' ')[0]}
            <span>{d.label.split(' ').slice(1).join(' ')}</span>
          </div>
        ))}
        {data.bands.map((band) => (
          <div key={band} className="heatmap-band-row" style={{ display: 'contents' }}>
            <div className="heatmap-band">{BAND_LABEL[band] ?? band}</div>
            {visibleDays.map((d) => {
              const cell = cellMap.get(`${d.date}|${band}`);
              const level = cell?.level ?? 'empty';
              const title = cell
                ? `${d.label} ${band}: ${cell.assigned}/${cell.required} filled (${cell.fillRate}%) · ${cell.vacant} vacant · ${cell.shifts} shift(s)`
                : `${d.label} ${band}: no shifts`;
              return (
                <div
                  key={`${d.date}-${band}`}
                  className={`heatmap-cell level-${level}`}
                  title={title}
                >
                  {cell && cell.shifts > 0 ? (
                    <span>{cell.fillRate < 100 ? cell.vacant : '✓'}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="heatmap-legend">
        <span className="level-full">Full</span>
        <span className="level-ok">OK</span>
        <span className="level-thin">Thin</span>
        <span className="level-gap">Gap</span>
      </div>
      <p className="widget-foot">
        {data.totals.fillRate}% filled · {data.totals.vacant} vacant slots · {visibleDays.length}d
        view
      </p>
    </div>
  );
}
