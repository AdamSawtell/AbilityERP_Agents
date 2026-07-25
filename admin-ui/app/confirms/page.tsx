'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Confirmation, ConfirmCycleSummary } from '@/lib/ross';

export default function ConfirmsPage() {
  const [rows, setRows] = useState<Confirmation[]>([]);
  const [lastCycle, setLastCycle] = useState<ConfirmCycleSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'all' | 'pending' | 'escalated'>('open');

  const load = useCallback(async () => {
    setError(null);
    try {
      const path =
        filter === 'open'
          ? '/api/confirmations'
          : `/api/confirmations?status=${filter}`;
      const res = await fetch(path);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setRows(json.confirmations ?? []);
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
    try {
      const res = await fetch('/api/confirmations/run', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || 'Run failed');
      setLastCycle(json.summary ?? null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Run failed');
    } finally {
      setBusy(false);
    }
  }

  async function respond(id: number, response: 'confirmed' | 'declined') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/confirmations/${id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || 'Respond failed');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Respond failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Confirms</h1>
          <p>Pre-shift Pathways check-ins — REQ confirms, DEC vacates the staff line.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            disabled={busy}
          >
            <option value="open">Open (pending + escalated)</option>
            <option value="pending">Pending</option>
            <option value="escalated">Escalated</option>
            <option value="all">Recent (all statuses)</option>
          </select>
          <button type="button" className="btn" onClick={() => void runCycle()} disabled={busy}>
            {busy ? 'Working…' : 'Run cycle'}
          </button>
        </div>
      </div>

      {lastCycle ? (
        <p style={{ color: 'var(--muted)', marginBottom: 12, fontSize: 14 }}>
          Last cycle: sent {lastCycle.sent} · confirmed {lastCycle.confirmed} · declined{' '}
          {lastCycle.declined} · escalated {lastCycle.escalated}
          {lastCycle.errors?.length ? ` · ${lastCycle.errors.length} error(s)` : ''}
        </p>
      ) : null}

      {error ? <p style={{ color: 'var(--danger)' }}>{error}</p> : null}

      {loading ? (
        <div className="empty">Loading confirmations…</div>
      ) : rows.length === 0 ? (
        <div className="empty">No confirmations in this view. Run a cycle to send reminders.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Shift start</th>
              <th>Worker</th>
              <th>Shift</th>
              <th>Status</th>
              <th>Requested</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const open = r.status === 'pending' || r.status === 'escalated';
              return (
                <tr key={r.id}>
                  <td>
                    {r.shiftStart ? new Date(r.shiftStart).toLocaleString() : '—'}
                  </td>
                  <td>{r.workerName || r.workerId}</td>
                  <td>
                    <span className="id-tag">#{r.shiftId}</span> {r.shiftName || '—'}
                  </td>
                  <td>
                    <span className={r.status === 'escalated' ? 'escalation-high' : undefined}>
                      {r.status}
                    </span>
                  </td>
                  <td>{new Date(r.requestedAt).toLocaleString()}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {open ? (
                      <>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => void respond(r.id, 'confirmed')}
                        >
                          Confirm
                        </button>{' '}
                        <button
                          type="button"
                          className="btn btn-danger"
                          disabled={busy}
                          onClick={() => void respond(r.id, 'declined')}
                        >
                          Decline
                        </button>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
