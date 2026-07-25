'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Swap, SwapCycleSummary } from '@/lib/ross';

export default function SwapsPage() {
  const [rows, setRows] = useState<Swap[]>([]);
  const [lastCycle, setLastCycle] = useState<SwapCycleSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'proposed' | 'all' | 'approved' | 'rejected'>(
    'proposed',
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const path =
        filter === 'proposed' ? '/api/swaps' : `/api/swaps?status=${filter}`;
      const res = await fetch(path);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setRows(json.swaps ?? []);
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
      const res = await fetch('/api/swaps/run', { method: 'POST' });
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

  async function approve(id: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/swaps/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedBy: 'admin-ui' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || 'Approve failed');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setBusy(false);
    }
  }

  async function reject(id: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/swaps/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejectedBy: 'admin-ui' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || 'Reject failed');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Swaps</h1>
          <p>Cross-day assignment exchanges — detect, Pathways notify, approve to rewrite both lines.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            disabled={busy}
          >
            <option value="proposed">Open</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
          <button type="button" className="btn" onClick={() => void runCycle()} disabled={busy}>
            {busy ? 'Working…' : 'Run detect'}
          </button>
        </div>
      </div>

      {lastCycle ? (
        <p style={{ color: 'var(--muted)', marginBottom: 12, fontSize: 14 }}>
          Last cycle: proposed {lastCycle.proposed} · considered {lastCycle.considered} ·
          intents {lastCycle.intentsSeen}
          {lastCycle.errors?.length ? ` · ${lastCycle.errors.length} error(s)` : ''}
        </p>
      ) : null}

      {error ? <p style={{ color: 'var(--danger)' }}>{error}</p> : null}

      {loading ? (
        <div className="empty">Loading swaps…</div>
      ) : rows.length === 0 ? (
        <div className="empty">No swaps in this view. Run detect to propose exchanges.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Requester → Partner</th>
              <th>Gives</th>
              <th>Takes</th>
              <th>Consent</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.requesterName || r.requesterId} ↔ {r.partnerName || r.partnerId}
                </td>
                <td>{r.shiftAName || r.shiftAId}</td>
                <td>{r.shiftBName || r.shiftBId}</td>
                <td style={{ fontSize: 13 }}>
                  {r.requesterResponse}/{r.partnerResponse}
                </td>
                <td>{r.status}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {r.status === 'proposed' ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy}
                        onClick={() => void approve(r.id)}
                      >
                        Approve
                      </button>{' '}
                      <button
                        type="button"
                        className="btn btn-danger"
                        disabled={busy}
                        onClick={() => void reject(r.id)}
                      >
                        Reject
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
