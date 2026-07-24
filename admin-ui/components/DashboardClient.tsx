'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { AuditEntry, Gap, Horizon, Proposal, VacantShift } from '@/lib/ross';
import { RecordPanel, type RecordTarget } from '@/components/RecordPanel';

type Health = {
  status?: string;
  lastScan?: { emergency?: string | null };
  lastEmergencySummary?: {
    vacantCount?: number;
    proposalsWritten?: number;
    gapsLogged?: number;
    autoAssigned?: number;
    autoAssignEnabled?: boolean;
  } | null;
  config?: {
    auto_approve_threshold?: number;
    scan_interval_minutes?: number;
    auto_assign_enabled?: boolean;
  };
};

type FeedItem =
  | { kind: 'proposal'; at: number; proposal: Proposal }
  | { kind: 'gap'; at: number; gap: Gap };

type ChatLine = {
  id: string;
  role: 'officer' | 'ross';
  text: string;
  at: number;
};

const HORIZONS: { id: Horizon; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'period', label: 'This Period' },
  { id: 'next', label: 'Next Period' },
];

const HELP_TEXT = [
  'Commands:',
  '• scan — run Emergency Rosterer now',
  '• bulk — approve all pending ≥ auto-approve threshold (one per shift)',
  '• status — Ross health + last scan',
  '• vacant — list vacant shifts for current horizon',
  '• gaps — unresolved gap count',
  '• help — this list',
].join('\n');

export function DashboardClient() {
  const [horizon, setHorizon] = useState<Horizon>('today');
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [vacant, setVacant] = useState<VacantShift[]>([]);
  const [activity, setActivity] = useState<AuditEntry[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [safeCount, setSafeCount] = useState(0);
  const [exceptionCount, setExceptionCount] = useState(0);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [command, setCommand] = useState('');
  const [record, setRecord] = useState<RecordTarget | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([
    {
      id: 'welcome',
      role: 'ross',
      text: 'Ross online. Type help for commands, or approve proposals below.',
      at: Date.now(),
    },
  ]);

  const pushChat = useCallback((role: ChatLine['role'], text: string) => {
    setChat((prev) => [
      ...prev.slice(-40),
      { id: `${Date.now()}-${Math.random()}`, role, text, at: Date.now() },
    ]);
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const settled = await Promise.allSettled([
        fetch('/api/proposals').then(async (res) => ({ res, json: await res.json() })),
        fetch('/api/gaps').then(async (res) => ({ res, json: await res.json() })),
        fetch('/api/health').then(async (res) => ({ res, json: await res.json() })),
        fetch('/api/audit').then(async (res) => ({ res, json: await res.json() })),
        fetch(`/api/vacant?horizon=${horizon}`).then(async (res) => ({
          res,
          json: await res.json(),
        })),
      ]);

      const [p, g, h, a, v] = settled;
      const errors: string[] = [];

      if (p.status === 'fulfilled' && p.value.res.ok) {
        setProposals(p.value.json.proposals ?? []);
        setPendingCount(p.value.json.pendingCount ?? 0);
        setSafeCount(p.value.json.autoApprovedFlaggedToday ?? 0);
        setExceptionCount(p.value.json.exceptionCount ?? 0);
      } else {
        errors.push('proposals');
      }

      if (g.status === 'fulfilled' && g.value.res.ok) {
        setGaps(g.value.json.gaps ?? []);
      } else {
        errors.push('gaps');
      }

      if (h.status === 'fulfilled' && h.value.res.ok) {
        setHealth(h.value.json);
      } else {
        errors.push('health');
      }

      if (a.status === 'fulfilled' && a.value.res.ok) {
        setActivity((a.value.json.entries ?? []).slice(0, 8));
      }

      if (v.status === 'fulfilled' && v.value.res.ok) {
        setVacant(v.value.json.shifts ?? []);
      }

      if (errors.length) {
        setError(`Failed to load: ${errors.join(', ')}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [horizon]);

  useEffect(() => {
    setLoading(true);
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
      const s = json.summary;
      pushChat(
        'ross',
        s
          ? `Scan complete — ${s.vacantCount ?? 0} vacant, ${s.proposalsWritten ?? 0} proposals, ${s.gapsLogged ?? 0} gaps.`
          : 'Scan complete.',
      );
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Scan failed';
      setError(msg);
      pushChat('ross', `Scan failed: ${msg}`);
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
      pushChat(
        'ross',
        `Approved #${id}` +
          (json.pathwaysMessageSent ? ' — Pathways notified.' : ' — assigned (no Pathways).'),
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setBusyId(null);
    }
  }

  async function bulkApprove() {
    setBulkBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/proposals/bulk-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Bulk approve failed');
      pushChat(
        'ross',
        `Bulk approve: ${json.approved ?? 0} assigned (min score ${json.minScore ?? '—'}), ${json.failed ?? 0} failed.`,
      );
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Bulk approve failed';
      setError(msg);
      pushChat('ross', `Bulk approve failed: ${msg}`);
    } finally {
      setBulkBusy(false);
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
      pushChat('ross', `Rejected proposal #${id}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed');
    } finally {
      setBusyId(null);
    }
  }

  async function handleCommand(raw: string) {
    const text = raw.trim();
    if (!text) return;
    pushChat('officer', text);
    setCommand('');

    const cmd = text.toLowerCase().replace(/^\//, '');
    if (cmd === 'help' || cmd === '?') {
      pushChat('ross', HELP_TEXT);
      return;
    }
    if (cmd === 'scan' || cmd === 'run scan' || cmd === 'run') {
      await runScan();
      return;
    }
    if (cmd === 'bulk' || cmd === 'bulk approve' || cmd === 'approve safe') {
      await bulkApprove();
      return;
    }
    if (cmd === 'status') {
      const online = health?.status === 'ok' ? 'online' : 'degraded';
      const last = health?.lastScan?.emergency
        ? new Date(health.lastScan.emergency).toLocaleString()
        : 'never';
      pushChat(
        'ross',
        `Ross ${online}. Pending ${pendingCount}. Vacant (${horizon}) ${vacant.length}. Last emergency scan: ${last}.`,
      );
      return;
    }
    if (cmd === 'vacant' || cmd === 'vacancies') {
      if (vacant.length === 0) {
        pushChat('ross', `No vacant shifts in ${horizon}.`);
        return;
      }
      const lines = vacant
        .slice(0, 8)
        .map((s) => `• ${s.name || s.id}${s.urgency ? ` [${s.urgency}]` : ''}`)
        .join('\n');
      pushChat('ross', `Vacant (${horizon}): ${vacant.length}\n${lines}`);
      return;
    }
    if (cmd === 'gaps') {
      pushChat(
        'ross',
        gaps.length === 0
          ? 'No unresolved gaps.'
          : `${gaps.length} unresolved gap(s). Open Gaps in the sidebar for detail.`,
      );
      return;
    }
    if (cmd === 'refresh') {
      await refresh();
      pushChat('ross', 'Feed refreshed.');
      return;
    }

    pushChat('ross', `Unknown command "${text}". Type help.`);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void handleCommand(command);
  }

  const alternatesByShift = useMemo(() => {
    const map = new Map<number, Proposal[]>();
    for (const p of proposals) {
      const list = map.get(p.shiftId) ?? [];
      list.push(p);
      map.set(p.shiftId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.score - a.score);
    }
    return map;
  }, [proposals]);

  const vacantIds = useMemo(() => new Set(vacant.map((s) => Number(s.id))), [vacant]);

  const feed = useMemo<FeedItem[]>(() => {
    const filteredProposals =
      horizon === 'today'
        ? proposals
        : proposals.filter((p) => vacantIds.has(Number(p.shiftId)));

    const items: FeedItem[] = [
      ...filteredProposals.map((proposal) => ({
        kind: 'proposal' as const,
        at: new Date(proposal.proposedAt).getTime() || 0,
        proposal,
      })),
      ...(horizon === 'today'
        ? gaps.map((gap) => ({
            kind: 'gap' as const,
            at: new Date(gap.detected_at).getTime() || 0,
            gap,
          }))
        : []),
    ];
    items.sort((a, b) => b.at - a.at);
    return items;
  }, [proposals, gaps, horizon, vacantIds]);

  const ok = health?.status === 'ok';
  const summary = health?.lastEmergencySummary;
  const horizonLabel = HORIZONS.find((h) => h.id === horizon)?.label ?? 'Today';

  return (
    <div className="dash">
      <div className="dash-main">
        <div className="topbar">
          <div>
            <h1>{horizonLabel}</h1>
            <p>
              {`${pendingCount} proposal${pendingCount === 1 ? '' : 's'} waiting — Ross proposes, you confirm.`}
            </p>
          </div>
          <div className="actions">
            <span className={`status-pill ${ok ? 'ok' : ''}`}>
              {ok ? 'Ross online' : 'Ross degraded'}
            </span>
            <span
              className={`status-pill ${health?.config?.auto_assign_enabled ? 'ok' : ''}`}
              title="Auto-assign writes during scan"
            >
              {health?.config?.auto_assign_enabled ? 'Auto-pilot ON' : 'Auto-pilot OFF'}
            </span>
            <button className="btn" onClick={() => void refresh()}>
              Refresh
            </button>
            <button
              className="btn"
              onClick={() => void bulkApprove()}
              disabled={bulkBusy || safeCount === 0}
              title="Approve pending proposals at/above threshold (one per shift)"
            >
              {bulkBusy ? 'Bulk…' : `Bulk approve (${safeCount})`}
            </button>
            <button className="btn btn-primary" onClick={() => void runScan()} disabled={scanning}>
              {scanning ? 'Scanning…' : 'Run scan'}
            </button>
          </div>
        </div>

        <div className="horizon-tabs" role="tablist" aria-label="Time horizon">
          {HORIZONS.map((h) => (
            <button
              key={h.id}
              type="button"
              role="tab"
              aria-selected={horizon === h.id}
              className={`horizon-tab ${horizon === h.id ? 'active' : ''}`}
              onClick={() => setHorizon(h.id)}
            >
              {h.label}
              {horizon === h.id && vacant.length > 0 ? (
                <span className="horizon-count">{vacant.length}</span>
              ) : null}
            </button>
          ))}
        </div>

        {error ? <p style={{ color: 'var(--danger)' }}>{error}</p> : null}

        <div className="chat-panel">
          <div className="chat-log" aria-live="polite">
            {chat.map((line) => (
              <div key={line.id} className={`chat-line ${line.role}`}>
                <span className="chat-who">{line.role === 'ross' ? 'Ross' : 'You'}</span>
                <pre>{line.text}</pre>
              </div>
            ))}
          </div>
          <form className="chat-input" onSubmit={onSubmit}>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="Type a command — try help or scan"
              aria-label="Ross command"
              autoComplete="off"
            />
            <button className="btn btn-primary" type="submit" disabled={!command.trim()}>
              Send
            </button>
          </form>
        </div>

        <div className="feed">
          {loading && feed.length === 0 ? (
            <div className="empty">Loading proposals…</div>
          ) : feed.length === 0 ? (
            <div className="empty">
              {horizon === 'today'
                ? 'No pending proposals or gaps. Run a scan or type scan in the command bar.'
                : `No proposals tied to vacant shifts in ${horizonLabel}. Vacant count: ${vacant.length}.`}
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
                    <h2>
                      <button
                        type="button"
                        className="linkish title"
                        onClick={() =>
                          setRecord({
                            kind: 'shift',
                            id: Number(g.shift_id),
                            label: g.shift_name || undefined,
                          })
                        }
                      >
                        {g.shift_name || `Shift ${g.shift_id}`}
                      </button>
                    </h2>
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
              const alts = (alternatesByShift.get(p.shiftId) ?? []).filter((a) => a.id !== p.id);
              return (
                <article key={`p-${p.id}`} className="bubble">
                  <div className="bubble-meta">
                    <span>Ross · proposal #{p.id}</span>
                    <span className="score">{p.score}/100</span>
                  </div>
                  <h2>
                    <button
                      type="button"
                      className="linkish title"
                      onClick={() =>
                        setRecord({ kind: 'worker', id: p.workerId, label: p.workerName })
                      }
                    >
                      {p.workerName}
                    </button>
                    <span className="arrow"> → </span>
                    <button
                      type="button"
                      className="linkish title"
                      onClick={() =>
                        setRecord({ kind: 'shift', id: p.shiftId, label: p.shiftName })
                      }
                    >
                      {p.shiftName}
                    </button>
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
                  {alts.length > 0 ? (
                    <div className="alts">
                      <span className="alts-label">Alternates</span>
                      {alts.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          className="chip alt-chip"
                          onClick={() =>
                            pushChat(
                              'ross',
                              `Alternate #${a.id}: ${a.workerName} at ${a.score}/100 for ${a.shiftName}. Scroll to that card or Approve from there.`,
                            )
                          }
                        >
                          {a.workerName} {a.score}
                        </button>
                      ))}
                    </div>
                  ) : null}
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

      <RecordPanel
        target={record}
        onClose={() => setRecord(null)}
        onOpenWorker={(id, label) => setRecord({ kind: 'worker', id, label })}
        onOpenShift={(id, label) => setRecord({ kind: 'shift', id, label })}
      />

      <aside className="dash-rail">
        <section className="widget">
          <h3>Vacant · {horizonLabel}</h3>
          {vacant.length === 0 ? (
            <p className="widget-foot">No vacant shifts in this horizon.</p>
          ) : (
            <ul className="activity">
              {vacant.slice(0, 6).map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="linkish activity-action"
                    onClick={() =>
                      setRecord({ kind: 'shift', id: Number(s.id), label: s.name || undefined })
                    }
                  >
                    {s.name || s.id}
                  </button>
                  <span className="activity-time">{s.urgency ?? '—'}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="widget-foot">{vacant.length} vacant · horizon `{horizon}`</p>
        </section>

        <section className="widget">
          <h3>Summary</h3>
          <dl className="stat-grid">
            <div>
              <dt>Pending</dt>
              <dd>{pendingCount}</dd>
            </div>
            <div>
              <dt>Safe</dt>
              <dd>{safeCount}</dd>
            </div>
            <div>
              <dt>Exceptions</dt>
              <dd>{exceptionCount}</dd>
            </div>
            <div>
              <dt>Auto last</dt>
              <dd>{summary?.autoAssigned ?? 0}</dd>
            </div>
          </dl>
          <p className="widget-foot">
            Safe = score ≥ {health?.config?.auto_approve_threshold ?? '—'}% (or flagged). No Entra
            needed to test.
          </p>
        </section>

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
              <dt>Auto</dt>
              <dd>{summary?.autoAssigned ?? 0}</dd>
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
              <dt>Threshold</dt>
              <dd>{health?.config?.auto_approve_threshold ?? '—'}%</dd>
            </div>
            <div>
              <dt>Auto-assign</dt>
              <dd>{health?.config?.auto_assign_enabled ? 'ON' : 'OFF'}</dd>
            </div>
          </dl>
          <p className="widget-foot">Toggle auto-assign under Config → Auto-pilot.</p>
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
