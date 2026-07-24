'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PlannerBriefing } from '@/lib/ross';

export default function PlannerPage() {
  const [briefing, setBriefing] = useState<PlannerBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/planner');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setBriefing(json.briefing ?? null);
      setCached(Boolean(json.cached));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runNow() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/planner/run', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || 'Run failed');
      setBriefing(json.briefing ?? null);
      setCached(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Run failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Planner</h1>
          <p>Workforce briefing — fill rates, training gaps, credentials, hiring signals.</p>
        </div>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void runNow()}>
          {busy ? 'Running…' : 'Run briefing'}
        </button>
      </div>

      {error ? <p style={{ color: 'var(--danger)' }}>{error}</p> : null}

      {loading ? (
        <div className="empty">Loading briefing…</div>
      ) : !briefing ? (
        <div className="empty">No briefing yet. Run briefing to generate.</div>
      ) : (
        <div className="planner-layout">
          <section className="widget">
            <h3>Fill rate · {briefing.period.label}</h3>
            <dl className="stat-grid">
              <div>
                <dt>This period</dt>
                <dd>{briefing.fillRate.thisPeriod}%</dd>
              </div>
              <div>
                <dt>Last period</dt>
                <dd>{briefing.fillRate.lastPeriod}%</dd>
              </div>
              <div>
                <dt>Delta</dt>
                <dd>
                  {briefing.fillRate.delta >= 0 ? '+' : ''}
                  {briefing.fillRate.delta}
                </dd>
              </div>
              <div>
                <dt>Vacant</dt>
                <dd>{briefing.fillRate.vacantSlots}</dd>
              </div>
              <div>
                <dt>Urgent (&lt;24h)</dt>
                <dd>{briefing.fillRate.urgentVacant}</dd>
              </div>
              <div>
                <dt>Next 14d</dt>
                <dd>{briefing.forecastNext.fillRate}%</dd>
              </div>
            </dl>
            <p className="widget-foot">
              {briefing.period.start} → {briefing.period.end}
              {cached ? ' · cached from last run' : ''}
              {' · '}
              {new Date(briefing.generatedAt).toLocaleString()}
            </p>
          </section>

          <section className="widget">
            <h3>Recommendations</h3>
            <ol className="planner-recs">
              {briefing.recommendations.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ol>
          </section>

          <section className="widget">
            <h3>Training gaps</h3>
            {briefing.trainingGaps.length === 0 ? (
              <p className="widget-foot">No open training gaps logged.</p>
            ) : (
              <ul className="activity">
                {briefing.trainingGaps.map((g) => (
                  <li key={`${g.credentialId ?? g.credentialName}`}>
                    <span className="activity-action">
                      {g.credentialName} · {g.blockedShifts} blocked · {g.openGaps} open
                    </span>
                    <span className="activity-time">
                      {g.trainingRequested > 0 ? `${g.trainingRequested} requested` : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="widget">
            <h3>Credential expiry</h3>
            <dl className="stat-grid">
              <div>
                <dt>7 days</dt>
                <dd>{briefing.credentialExpiry.within7Days}</dd>
              </div>
              <div>
                <dt>14 days</dt>
                <dd>{briefing.credentialExpiry.within14Days}</dd>
              </div>
              <div>
                <dt>30 days</dt>
                <dd>{briefing.credentialExpiry.within30Days}</dd>
              </div>
            </dl>
            {briefing.credentialExpiry.workers.length > 0 ? (
              <ul className="activity" style={{ marginTop: 12 }}>
                {briefing.credentialExpiry.workers.slice(0, 8).map((w) => (
                  <li key={`${w.workerId}-${w.credentialName}-${w.expiryDate}`}>
                    <span className="activity-action">
                      {w.workerName} · {w.credentialName}
                    </span>
                    <span className="activity-time">{w.expiryDate}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="widget-foot">No credentials expiring in 30 days.</p>
            )}
          </section>

          <section className="widget">
            <h3>Hiring signals</h3>
            {briefing.hiringSignals.length === 0 ? (
              <p className="widget-foot">No recurring vacancy patterns detected.</p>
            ) : (
              <ul className="activity">
                {briefing.hiringSignals.map((s) => (
                  <li key={`${s.dayOfWeek}-${s.band}`}>
                    <span className="activity-action">{s.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="widget">
            <h3>Utilisation (next 14d)</h3>
            <p className="widget-foot" style={{ marginTop: 0 }}>
              Busiest
            </p>
            <ul className="activity">
              {briefing.utilisation.busiest.map((u) => (
                <li key={`b-${u.workerId}`}>
                  <span className="activity-action">{u.workerName}</span>
                  <span className="activity-time">
                    {u.assignedShifts} sh · {u.hoursApprox}h
                  </span>
                </li>
              ))}
            </ul>
            <p className="widget-foot">Lightest</p>
            <ul className="activity">
              {briefing.utilisation.lightest.map((u) => (
                <li key={`l-${u.workerId}`}>
                  <span className="activity-action">{u.workerName}</span>
                  <span className="activity-time">
                    {u.assignedShifts} sh · {u.hoursApprox}h
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="widget planner-summary">
            <h3>Briefing text</h3>
            <pre className="planner-pre">{briefing.summaryText}</pre>
          </section>
        </div>
      )}
    </>
  );
}
