'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Proposal } from '@/lib/ross';

type Health = {
  status?: string;
  lastScan?: { emergency?: string | null };
  lastEmergencySummary?: {
    vacantCount?: number;
    proposalsWritten?: number;
    gapsLogged?: number;
  } | null;
};

export function DashboardClient() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [pRes, hRes] = await Promise.all([
        fetch('/api/proposals'),
        fetch('/api/health'),
      ]);
      const pJson = await pRes.json();
      const hJson = await hRes.json();
      if (!pRes.ok) throw new Error(pJson.error || 'Failed to load proposals');
      setProposals(pJson.proposals ?? []);
      setPendingCount(pJson.pendingCount ?? 0);
      setHealth(hJson);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  async function runScan() {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch('/api/scan', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Scan failed');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanning(false);
    }
  }

  async function approve(id: number) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/proposals/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Approve failed');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: number) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/proposals/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Rejected from Ross admin dashboard' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Reject failed');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed');
    } finally {
      setBusyId(null);
    }
  }

  const ok = health?.status === 'ok';

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Today</h1>
          <p>
            {pendingCount} proposal{pendingCount === 1 ? '' : 's'} waiting — Ross proposes, you
            confirm.
          </p>
        </div>
        <div className="actions">
          <span className={`status-pill ${ok ? 'ok' : ''}`}>
            {ok ? 'Ross online' : 'Ross degraded'}
          </span>
          <button className="btn" onClick={() => void refresh()} disabled={loading}>
            Refresh
          </button>
          <button className="btn btn-primary" onClick={() => void runScan()} disabled={scanning}>
            {scanning ? 'Scanning…' : 'Run scan'}
          </button>
        </div>
      </div>

      {error ? <p style={{ color: 'var(--danger)' }}>{error}</p> : null}

      <div className="feed">
        {loading && proposals.length === 0 ? (
          <div className="empty">Loading proposals…</div>
        ) : proposals.length === 0 ? (
          <div className="empty">
            No pending proposals. Run a scan or wait for the next Emergency Rosterer cycle.
          </div>
        ) : (
          proposals.map((p) => {
            const soft = p.rulesPassed?.soft ?? [];
            const hard = p.rulesPassed?.hard ?? [];
            const reason =
              p.rulesPassed?.reason ||
              `${p.workerName} is a ${p.score}/100 match for ${p.shiftName}`;
            return (
              <article key={p.id} className="bubble">
                <div className="bubble-meta">
                  <span>Ross · proposal #{p.id}</span>
                  <span className="score">{p.score}/100</span>
                </div>
                <h2>
                  {p.workerName} → {p.shiftName}
                </h2>
                <p className="reason">{reason}</p>
                <div className="rules">
                  {hard.slice(0, 5).map((r) => (
                    <span key={r.rule} className={`chip ${r.pass ? 'pass' : 'fail'}`}>
                      {r.rule}
                    </span>
                  ))}
                  {soft
                    .filter((r) => r.earned > 0)
                    .slice(0, 4)
                    .map((r) => (
                      <span key={r.rule} className="chip pass">
                        {r.rule} {r.earned}
                      </span>
                    ))}
                </div>
                <div className="card-actions">
                  <button
                    className="btn btn-primary"
                    disabled={busyId === p.id}
                    onClick={() => void approve(p.id)}
                  >
                    Approve & assign
                  </button>
                  <button
                    className="btn btn-danger"
                    disabled={busyId === p.id}
                    onClick={() => void reject(p.id)}
                  >
                    Reject
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </>
  );
}
