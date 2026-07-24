'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CredentialWatch, CredentialWatchGroup } from '@/lib/ross';

export default function CredentialsPage() {
  const [data, setData] = useState<CredentialWatch | null>(null);
  const [withinDays, setWithinDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/credentials/expiring?withinDays=${withinDays}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [withinDays]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  async function bulkRemind(group?: CredentialWatchGroup) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch('/api/credentials/bulk-remind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          withinDays,
          credentialId: group?.credentialId,
          limit: 50,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || 'Remind failed');
      setFlash(
        `Reminded ${json.sent ?? 0}/${json.attempted ?? 0}` +
          (json.skipped ? ` · ${json.skipped} skipped` : '') +
          (group ? ` · ${group.credentialName}` : ''),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remind failed');
    } finally {
      setBusy(false);
    }
  }

  const totals = data?.totals;

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Credentials</h1>
          <p>Expiry radar — Pathways bulk remind workers before credentials lapse.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={withinDays}
            onChange={(e) => setWithinDays(Number(e.target.value))}
            disabled={busy}
          >
            <option value={7}>Next 7 days</option>
            <option value={14}>Next 14 days</option>
            <option value={30}>Next 30 days</option>
            <option value={60}>Next 60 days</option>
          </select>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !data?.items.length}
            onClick={() => void bulkRemind()}
          >
            {busy ? 'Sending…' : 'Bulk remind all'}
          </button>
        </div>
      </div>

      {error ? <p style={{ color: 'var(--danger)' }}>{error}</p> : null}
      {flash ? <p style={{ color: 'var(--accent)' }}>{flash}</p> : null}

      {totals ? (
        <dl className="stat-grid" style={{ maxWidth: 480, marginBottom: 20 }}>
          <div>
            <dt>7 days</dt>
            <dd>{totals.within7Days}</dd>
          </div>
          <div>
            <dt>14 days</dt>
            <dd>{totals.within14Days}</dd>
          </div>
          <div>
            <dt>{withinDays} days</dt>
            <dd>{totals.within30Days}</dd>
          </div>
        </dl>
      ) : null}

      {loading ? (
        <div className="empty">Loading credential watch…</div>
      ) : !data || data.groups.length === 0 ? (
        <div className="empty">No credentials expiring in this window.</div>
      ) : (
        <>
          <div className="gap-cards">
            {data.groups.map((g) => {
              const level =
                g.within7Days > 0 ? 'critical' : g.within14Days > 0 ? 'warning' : 'info';
              return (
                <section key={g.credentialId} className={`widget gap-card escalation-${level}`}>
                  <h3>
                    {g.credentialName}{' '}
                    <span className={`escalation-${level}`}>{level}</span>
                  </h3>
                  <p className="reason">
                    {g.within30Days} worker(s) due · {g.within7Days} in 7d · {g.within14Days} in
                    14d
                  </p>
                  <p className="widget-foot">
                    {g.workers
                      .slice(0, 4)
                      .map((w) => `${w.workerName} (${w.expiryDate})`)
                      .join(' · ')}
                    {g.workers.length > 4 ? ` · +${g.workers.length - 4}` : ''}
                  </p>
                  <div className="card-actions" style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => void bulkRemind(g)}
                    >
                      Bulk remind
                    </button>
                  </div>
                </section>
              );
            })}
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Worker</th>
                <th>Credential</th>
                <th>Expires</th>
                <th>Days left</th>
                <th>Window</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.assignmentId}>
                  <td>{i.workerName}</td>
                  <td>{i.credentialName}</td>
                  <td>{i.expiryDate}</td>
                  <td>{i.daysLeft}</td>
                  <td className={i.window === '7' ? 'escalation-critical' : undefined}>
                    {i.window}d
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
