'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AuditEntry } from '@/lib/ross';

function formatNotes(e: AuditEntry): string {
  const raw = e.notes ?? e.approved_by;
  if (!raw) return '—';
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.trigger === 'string') {
        return `${parsed.trigger}: ${parsed.proposalsWritten ?? 0} proposals, ${parsed.gapsLogged ?? 0} gaps`;
      }
      if (typeof parsed.summary === 'string') return parsed.summary.slice(0, 120);
      if (typeof parsed.fillRate === 'number') return `fill ${parsed.fillRate}%`;
    } catch {
      /* keep raw */
    }
  }
  return raw.length > 140 ? `${raw.slice(0, 140)}…` : raw;
}

function sinceIso(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agentType, setAgentType] = useState('');
  const [action, setAction] = useState('');
  const [windowHours, setWindowHours] = useState<number | 'all'>(24);

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: '100' });
      if (agentType) qs.set('agent_type', agentType);
      if (action) qs.set('action', action);
      if (windowHours !== 'all') qs.set('since', sinceIso(windowHours));
      const res = await fetch(`/api/audit?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setEntries(json.entries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [agentType, action, windowHours]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  function exportCsv() {
    const qs = new URLSearchParams({ limit: '500' });
    if (agentType) qs.set('agent_type', agentType);
    if (action) qs.set('action', action);
    if (windowHours !== 'all') qs.set('since', sinceIso(windowHours));
    window.location.href = `/api/audit/export?${qs}`;
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Audit</h1>
          <p>Immutable action log — filter and export CSV.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={exportCsv}>
          Export CSV
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <select value={windowHours} onChange={(e) => setWindowHours(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value={24}>Last 24h</option>
          <option value={72}>Last 72h</option>
          <option value={168}>Last 7d</option>
          <option value="all">All time</option>
        </select>
        <select value={agentType} onChange={(e) => setAgentType(e.target.value)}>
          <option value="">All agents</option>
          <option value="emergency">emergency</option>
          <option value="planner">planner</option>
          <option value="system">system</option>
        </select>
        <select value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          <option value="scan_run">scan_run</option>
          <option value="daily_plan">daily_plan</option>
          <option value="shift_assigned">shift_assigned</option>
          <option value="match_approved">match_approved</option>
          <option value="gap_logged">gap_logged</option>
          <option value="training_requested">training_requested</option>
          <option value="cred_remind">cred_remind</option>
          <option value="swap_proposed">swap_proposed</option>
          <option value="swap_approved">swap_approved</option>
          <option value="message_sent">message_sent</option>
        </select>
      </div>

      {error ? <p style={{ color: 'var(--danger)' }}>{error}</p> : null}
      {loading ? (
        <div className="empty">Loading audit log…</div>
      ) : entries.length === 0 ? (
        <div className="empty">No audit entries for this filter.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Agent</th>
              <th>Action</th>
              <th>Shift</th>
              <th>Score</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.timestamp).toLocaleString()}</td>
                <td>{e.agent_type}</td>
                <td>{e.action}</td>
                <td>{e.shift_id ?? '—'}</td>
                <td>{e.score ?? '—'}</td>
                <td>{formatNotes(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
