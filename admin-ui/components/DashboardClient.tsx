'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuditEntry, Gap, Proposal } from '@/lib/ross';

type Health = {
  status?: string;
  lastScan?: { emergency?: string | null };
  lastEmergencySummary?: {
    vacantCount?: number;
    proposalsWritten?: number;
    gapsLogged?: number;
  } | null;
  config?: {
    auto_approve_threshold?: number;
    scan_interval_minutes?: number;
  };
};

type FeedItem =
  | { kind: 'proposal'; at: number; proposal: Proposal }
  | { kind: 'gap'; at: number; gap: Gap };

export function DashboardClient() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [activity, setActivity] = useState<AuditEntry[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [pRes, gRes, hRes, aRes] = await Promise.all([
        fetch('/api/proposals'),
        fetch('/api/gaps'),
        fetch('/api/health'),
        fetch('/api/audit'),
      ]);
      const [pJson, gJson, hJson, aJson] = await Promise.all([
        pRes.json(),
        gRes.json(),
        hRes.json(),
        aRes.json(),
      ]);
      if (!pRes.ok) throw new Error(pJson.error || 'Failed to load proposals');
      if (!gRes.ok) throw new Error(gJson.error || 'Failed to load gaps');
      setProposals(pJson.proposals ?? []);
      setPendingCount(pJson.pendingCount ?? 0);
      setGaps(gJson.gaps ?? []);
      setHealth(hJson);
      setActivity((aJson.entries ?? []).slice(0, 8));
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

  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [
      ...proposals.map((proposal) => ({
        kind: 'proposal' as const,
        at: new Date(proposal.proposedAt).getTime() || 0,
        proposal,
      })),
      ...gaps.map((gap) => ({
        kind: 'gap' as const,
        at: new Date(gap.detected_at).getTime() || 0,
        gap,
      })),
    ];
    items.sort((a, b) => b.at - a.at);
    return items;
  }, [proposals, gaps]);

  const ok = health?.status === 'ok';
  const summary = health?.lastEmergencySummary;

  return (
    <div className="dash">
      <div className="dash-main">
        <div className="topbar">
          <div>
            <h1>Today</h1>
            <p>
              {`${pendingCount} proposal${pendingCount === 1 ? '' : 's'} waiting — Ross proposes, you confirm.`}
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
          {loading && feed.length === 0 ? (
            <div className="empty">Loading proposals…</div>
          ) : feed.length === 0 ? (
            <div className="empty">
              No pending proposals or gaps. Run a scan or wait for the next Emergency Rosterer
              cycle.
            </div>
          ) : (
            feed.map((item) => {
              if (item.kind === 'gap') {
                const g = item.gap;
                return (
                  <article key={`gap-${g.id}`} className="bubble bubble-gap">
                    <div className="bubble-meta">
                      <span>Ross · no match</span>
                      <span className={`escalation-${g.escalation_level}`}>
                        {g.escalation_level}
                      </span>
                    </div>
                    <h2>{g.shift_name || `Shift ${g.shift_id}`}</h2>
                    <p className="reason">{g.reason}</p>
                    <div className="rules">
                      <span className="chip fail">gap</span>
                      {g.blocked_count != null ? (
                        <span className="chip">{g.blocked_count} blocked</span>
                      ) : null}
                    </div>
                  </article>
                );
              }

              const p = item.proposal;
              const soft = p.rulesPassed?.soft ?? [];
              const hard = p.rulesPassed?.hard ?? [];
              const reason =
                p.rulesPassed?.reason ||
                `${p.workerName} is a ${p.score}/100 match for ${p.shiftName}`;
              return (
                <article key={`p-${p.id}`} className="bubble">
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
      </div>

      <aside className="dash-rail">
        <section className="widget">
          <h3>Last scan</h3>
          <dl className="stat-grid">
            <div>
              <dt>Vacant</dt>
              <dd>{summary?.vacantCount ?? '—'}</dd>
            </div>
            <div>
              <dt>Proposed</dt>
              <dd>{summary?.proposalsWritten ?? '—'}</dd>
            </div>
            <div>
              <dt>Gaps</dt>
              <dd>{summary?.gapsLogged ?? gaps.length}</dd>
            </div>
            <div>
              <dt>Pending</dt>
              <dd>{pendingCount}</dd>
            </div>
          </dl>
          <p className="widget-foot">
            {health?.lastScan?.emergency
              ? `Emergency · ${new Date(health.lastScan.emergency).toLocaleString()}`
              : 'No emergency scan yet'}
          </p>
        </section>

        <section className="widget">
          <h3>Config</h3>
          <dl className="stat-list">
            <div>
              <dt>Scan interval</dt>
              <dd>{health?.config?.scan_interval_minutes ?? '—'} min</dd>
            </div>
            <div>
              <dt>Auto-approve</dt>
              <dd>{health?.config?.auto_approve_threshold ?? '—'}%</dd>
            </div>
          </dl>
          <p className="widget-foot">Phase 1: auto-assign writes stay off.</p>
        </section>

        <section className="widget">
          <h3>Activity</h3>
          {activity.length === 0 ? (
            <p className="widget-foot">No recent audit entries.</p>
          ) : (
            <ul className="activity">
              {activity.map((e) => (
                <li key={e.id}>
                  <span className="activity-action">{e.action}</span>
                  <span className="activity-time">
                    {new Date(e.timestamp).toLocaleTimeString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
