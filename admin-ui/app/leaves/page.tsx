'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LeaveCycleSummary, LeavePending, LeaveReplacement } from '@/lib/ross';

export default function LeavesPage() {
  const [rows, setRows] = useState<LeaveReplacement[]>([]);
  const [pending, setPending] = useState<LeavePending[]>([]);
  const [lastCycle, setLastCycle] = useState<LeaveCycleSummary | null>(null);
  const [filter, setFilter] = useState<'all' | 'proposed' | 'assigned' | 'failed' | 'vacated'>(
    'all',
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = filter === 'all' ? '' : `?status=${filter}`;
      const res = await fetch(`/api/leave${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setRows(json.replacements ?? []);
      setPending(json.pending ?? []);
      setLastCycle(json.lastCycle ?? null);
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

  async function runCycle() {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch('/api/leave/run', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || 'Run failed');
      const s = json.summary as LeaveCycleSummary;
      setLastCycle(s);
      setFlash(
        `Cycle done — overlaps ${s.overlapsFound}, vacated ${s.vacated}, assigned ${s.assigned}, proposed ${s.proposed}, failed ${s.failed}`,
      );
      await load();
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
          <h1>Leaves</h1>
          <p>Approved leave overlapping rostered shifts — vacate and find replacements.</p>
        </div>
        <div className="actions">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            disabled={busy}
          >
            <option value="all">All results</option>
            <option value="proposed">Proposed</option>
            <option value="assigned">Assigned</option>
            <option value="failed">Failed</option>
            <option value="vacated">Vacated only</option>
          </select>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void runCycle()}>
            Run leave cycle
          </button>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {flash ? <p className="flash">{flash}</p> : null}

      {lastCycle ? (
        <p className="muted" style={{ marginBottom: 12 }}>
          Last cycle: vacated {lastCycle.vacated} · assigned {lastCycle.assigned} · proposed{' '}
          {lastCycle.proposed} · failed {lastCycle.failed}
          {lastCycle.finishedAt
            ? ` · ${new Date(lastCycle.finishedAt).toLocaleString()}`
            : ''}
        </p>
      ) : null}

      {pending.length > 0 ? (
        <section className="widget" style={{ marginBottom: 16 }}>
          <h3>Pending overlaps ({pending.length})</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Worker</th>
                <th>Leave</th>
                <th>Shift</th>
                <th>Starts</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((p) => (
                <tr key={`${p.leave_id}-${p.shift_id}`}>
                  <td>{p.worker_name}</td>
                  <td className="muted">
                    #{p.leave_id} · {new Date(p.leave_start).toLocaleDateString()}–
                    {new Date(p.leave_end).toLocaleDateString()}
                  </td>
                  <td>{p.shift_name}</td>
                  <td className="muted">{new Date(p.shift_start).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <p className="muted" style={{ marginBottom: 16 }}>
          No pending leave overlaps waiting to process.
        </p>
      )}

      {loading ? <p className="empty">Loading…</p> : null}

      {!loading && rows.length === 0 ? (
        <p className="empty">No leave replacements logged yet.</p>
      ) : null}

      {!loading && rows.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Original</th>
              <th>Shift</th>
              <th>Replacement</th>
              <th>Score</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="muted">{new Date(r.processed_at).toLocaleString()}</td>
                <td>{r.original_worker_name ?? r.original_worker_id ?? '—'}</td>
                <td>
                  #{r.shift_id}
                  <div className="muted" style={{ fontSize: '0.85em' }}>
                    leave #{r.leave_id}
                  </div>
                </td>
                <td>{r.replacement_worker_name ?? '—'}</td>
                <td>{r.score ?? '—'}</td>
                <td>
                  <span className={`skill-status ${r.status === 'assigned' ? 'on' : r.status === 'failed' ? 'off' : 'paused'}`}>
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
