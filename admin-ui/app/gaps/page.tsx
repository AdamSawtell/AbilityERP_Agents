'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Gap, TrainingGapSummary } from '@/lib/ross';

export default function GapsPage() {
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [summaries, setSummaries] = useState<TrainingGapSummary[]>([]);
  const [filter, setFilter] = useState<'open' | 'resolved'>('open');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const resolved = filter === 'resolved' ? 'true' : 'false';
      const [gRes, sRes] = await Promise.all([
        fetch(`/api/gaps?resolved=${resolved}&limit=50`),
        filter === 'open' ? fetch('/api/gaps/training-summary') : Promise.resolve(null),
      ]);
      const gJson = await gRes.json();
      if (!gRes.ok) throw new Error(gJson.error || 'Failed');
      setGaps(gJson.gaps ?? []);

      if (sRes) {
        const sJson = await sRes.json();
        if (sRes.ok) setSummaries(sJson.summaries ?? []);
      } else {
        setSummaries([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  async function requestTraining(gapId: number, bulk = true) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch(`/api/gaps/${gapId}/training-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bulkSameCredential: bulk }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || 'Request failed');
      setFlash(
        `Training requested for ${json.updatedCount ?? 1} gap(s)` +
          (json.pathwaysSent ? ' · Pathways sent to officer' : ' · Pathways skipped/failed'),
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  async function resolve(gapId: number) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch(`/api/gaps/${gapId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || 'Resolve failed');
      setFlash(`Gap #${gapId} resolved`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resolve failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Gaps</h1>
          <p>Training & coverage gaps — request training via Pathways, or mark resolved.</p>
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          disabled={busy}
        >
          <option value="open">Unresolved</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>

      {error ? <p style={{ color: 'var(--danger)' }}>{error}</p> : null}
      {flash ? <p style={{ color: 'var(--accent)' }}>{flash}</p> : null}

      {filter === 'open' && summaries.length > 0 ? (
        <div className="gap-cards">
          {summaries.map((s) => {
            const sampleId = s.sampleGapIds[0];
            return (
              <section
                key={`${s.credentialId ?? 'x'}-${s.reason}`}
                className={`widget gap-card escalation-${s.highestEscalation}`}
              >
                <h3>
                  {s.credentialName}{' '}
                  <span className={`escalation-${s.highestEscalation}`}>
                    {s.highestEscalation}
                  </span>
                </h3>
                <p className="reason">
                  {s.blockedShifts} blocked · {s.openGaps} open gap(s)
                  {s.trainingRequested > 0 ? ` · ${s.trainingRequested} already requested` : ''}
                </p>
                {s.shiftNames.length > 0 ? (
                  <p className="widget-foot">{s.shiftNames.join(' · ')}</p>
                ) : null}
                {sampleId != null ? (
                  <div className="card-actions" style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => void requestTraining(sampleId, true)}
                    >
                      Request training
                    </button>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : null}

      {loading ? (
        <div className="empty">Loading gaps…</div>
      ) : gaps.length === 0 ? (
        <div className="empty">
          {filter === 'open' ? 'No unresolved gaps.' : 'No resolved gaps yet.'}
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Shift</th>
              <th>Reason / credential</th>
              <th>Level</th>
              <th>Training</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {gaps.map((g) => (
              <tr key={g.id}>
                <td>{new Date(g.detected_at).toLocaleString()}</td>
                <td>
                  {g.shift_id != null ? (
                    <span className="id-tag">#{g.shift_id}</span>
                  ) : null}{' '}
                  {g.shift_name || '—'}
                </td>
                <td>
                  {g.credential_name || g.reason}
                  {g.credential_name && g.reason !== g.credential_name ? (
                    <span style={{ color: 'var(--muted)' }}> · {g.reason}</span>
                  ) : null}
                </td>
                <td className={`escalation-${g.escalation_level}`}>{g.escalation_level}</td>
                <td>{g.training_requested ? 'Requested' : '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {!g.resolved ? (
                    <>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => void requestTraining(g.id, false)}
                      >
                        Request
                      </button>{' '}
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy}
                        onClick={() => void resolve(g.id)}
                      >
                        Resolve
                      </button>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
