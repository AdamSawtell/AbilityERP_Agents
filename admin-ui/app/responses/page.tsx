'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  formatShiftWhen,
  shortShiftTitle,
} from '@/lib/format/shiftDisplay';

type OpenResponse = {
  responseLogId: number;
  shiftId: number;
  shiftName: string;
  erpUrl: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  reviewRequired: boolean;
  response: string;
  workerId: number | null;
  workerName: string;
  createdAt: string;
  vacantSlots: number;
  alreadyOnShift: boolean;
};

export default function ResponsesPage() {
  const [items, setItems] = useState<OpenResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/responses');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setItems(json.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runCycle() {
    setRunning(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch('/api/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run', reviewedBy: 'admin-ui' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Cycle failed');
      const s = json.summary;
      setNote(
        `Cycle done — open ${s.openCount}, auto-accepted ${s.autoAccepted}, auto-dismissed DEC ${s.autoDismissedDec}.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cycle failed');
    } finally {
      setRunning(false);
    }
  }

  async function accept(id: number) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/responses/${id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewedBy: 'admin-ui' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Accept failed');
      setNote(`Accepted response #${id} — worker assigned.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Accept failed');
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(id: number) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/responses/${id}/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewedBy: 'admin-ui' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Dismiss failed');
      setNote(`Dismissed response #${id} (IsReviewed=Y).`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dismiss failed');
    } finally {
      setBusyId(null);
    }
  }

  const reqs = items.filter((i) => i.response === 'REQ');
  const decs = items.filter((i) => i.response === 'DEC');

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Response log</h1>
          <p>
            Worker REQ / DEC from AbilityERP. Queued via{' '}
            <code>AbERP_IsResponseLogReviewRequired</code>; Ross marks{' '}
            <code>IsReviewed</code> when done (same as Accept Shift Request).
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void runCycle()}
            disabled={running}
          >
            {running ? 'Running…' : 'Run cycle'}
          </button>
        </div>
      </div>

      {error ? <p style={{ color: 'var(--danger)' }}>{error}</p> : null}
      {note ? <p className="save-ok">{note}</p> : null}

      <dl className="stat-grid" style={{ marginBottom: 18 }}>
        <div>
          <dt>Open</dt>
          <dd>{items.length}</dd>
        </div>
        <div>
          <dt>Requests</dt>
          <dd>{reqs.length}</dd>
        </div>
        <div>
          <dt>Declines</dt>
          <dd>{decs.length}</dd>
        </div>
        <div>
          <dt>Flagged</dt>
          <dd>{items.filter((i) => i.reviewRequired).length}</dd>
        </div>
      </dl>

      {loading ? (
        <div className="empty">Loading open responses…</div>
      ) : items.length === 0 ? (
        <div className="empty">No open REQ/DEC responses to review.</div>
      ) : (
        <div className="rules-list">
          {items.map((item) => {
            const when = formatShiftWhen(item.startTime, item.endTime);
            const title = shortShiftTitle(item.shiftName);
            return (
              <section key={item.responseLogId} className="config-card rules-card">
                <div className="rules-card-head">
                  <div>
                    <h2>
                      <span
                        className={`skill-status ${item.response === 'REQ' ? 'on' : 'off'}`}
                        style={{ marginRight: 8 }}
                      >
                        {item.response}
                      </span>
                      {item.workerName}
                      <span className="propose-for"> · {title}</span>
                    </h2>
                    <p className="rules-desc">
                      {when.day} · {when.time}
                      {item.location ? ` · ${item.location}` : ''}
                      {item.reviewRequired ? ' · review flag Y' : ''}
                      {item.vacantSlots > 0
                        ? ` · ${item.vacantSlots} open slot(s)`
                        : ' · no vacant slots'}
                      {item.alreadyOnShift ? ' · already on shift' : ''}
                    </p>
                    <p className="shift-ref">
                      {item.erpUrl ? (
                        <a
                          className="erp-link"
                          href={item.erpUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open in AbilityERP ↗
                        </a>
                      ) : null}
                      <span className="id-tag id-tag-inline">
                        {' '}
                        · shift #{item.shiftId} · log #{item.responseLogId}
                      </span>
                    </p>
                  </div>
                  <div className="actions">
                    {item.response === 'REQ' ? (
                      <button
                        className="btn btn-primary"
                        disabled={busyId === item.responseLogId || item.vacantSlots <= 0}
                        onClick={() => void accept(item.responseLogId)}
                        title={
                          item.vacantSlots <= 0
                            ? 'No vacant employee slot'
                            : 'Assign worker and mark IsReviewed'
                        }
                      >
                        {busyId === item.responseLogId ? '…' : 'Accept & assign'}
                      </button>
                    ) : null}
                    <button
                      className="btn"
                      disabled={busyId === item.responseLogId}
                      onClick={() => void dismiss(item.responseLogId)}
                    >
                      {item.response === 'DEC' ? 'Mark reviewed' : 'Dismiss'}
                    </button>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
