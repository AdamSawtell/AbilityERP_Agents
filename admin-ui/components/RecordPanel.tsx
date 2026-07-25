'use client';

import { useEffect, useState } from 'react';

export type RecordTarget =
  | { kind: 'worker'; id: number; label?: string }
  | { kind: 'shift'; id: number; label?: string };

type WorkerProfile = {
  workerId: number;
  name: string;
  initials: string;
  status: string;
  gender?: string | null;
  zone?: string | null;
  contract?: {
    hoursPerWeek?: number | null;
    maxHoursPerWeek?: number | null;
  };
  credentials?: { name: string; status: string; expiryDate: string | null }[];
  thisWeekShifts?: { date: string; shiftName: string; time: string; shiftId: number }[];
  pastAssignments?: { client: string; count: number }[];
};

type ShiftDetail = {
  shiftId: number;
  name: string;
  documentNo?: string | null;
  startTime: string;
  endTime: string;
  shiftDate?: string;
  startTimeLabel?: string;
  endTimeLabel?: string;
  location?: string | null;
  requiredStaff?: number | null;
  assignedStaff?: number;
  transportRequired?: boolean;
  credentialNames?: string[];
  hoursUntilShift?: number;
  shiftUu?: string | null;
  erpUrl?: string | null;
  receivers?: { id: number; name: string }[];
  staffLines?: {
    workerId: number | null;
    workerName: string | null;
    vacant: boolean;
    line: number | null;
  }[];
  pendingProposals?: { id: number; workerId: number; workerName: string; score: number }[];
};

type Props = {
  target: RecordTarget | null;
  onClose: () => void;
  onOpenWorker?: (id: number, label?: string) => void;
  onOpenShift?: (id: number, label?: string) => void;
};

export function RecordPanel({ target, onClose, onOpenWorker, onOpenShift }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [worker, setWorker] = useState<WorkerProfile | null>(null);
  const [shift, setShift] = useState<ShiftDetail | null>(null);

  useEffect(() => {
    if (!target) {
      setWorker(null);
      setShift(null);
      setError(null);
      return;
    }

    let alive = true;
    setLoading(true);
    setError(null);
    setWorker(null);
    setShift(null);

    void (async () => {
      try {
        if (target.kind === 'worker') {
          const res = await fetch(`/api/worker/${target.id}/profile`);
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Failed to load worker');
          if (alive) setWorker(json.profile);
        } else {
          const res = await fetch(`/api/shifts/${target.id}`);
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Failed to load shift');
          if (alive) setShift(json.shift);
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Failed');
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, onClose]);

  if (!target) return null;

  const title =
    target.kind === 'worker'
      ? worker?.name || target.label || `Worker ${target.id}`
      : shift?.name || target.label || `Shift ${target.id}`;

  return (
    <div className="record-root" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="record-backdrop" aria-label="Close panel" onClick={onClose} />
      <aside className="record-panel">
        <header className="record-head">
          <div>
            <p className="record-kicker">
              {target.kind === 'worker' ? 'Worker' : 'Shift'}
              <span className="id-tag id-tag-inline">#{target.id}</span>
            </p>
            <h2>{title}</h2>
          </div>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </header>

        {loading ? <div className="empty">Loading details…</div> : null}
        {error ? <p style={{ color: 'var(--danger)' }}>{error}</p> : null}

        {!loading && !error && worker ? (
          <div className="record-body">
            <div className="record-hero">
              <span className="record-avatar">{worker.initials}</span>
              <div>
                <p className="record-meta">{worker.status}</p>
                <p className="record-meta">
                  {[worker.gender, worker.zone].filter(Boolean).join(' · ') || 'No zone set'}
                </p>
              </div>
            </div>

            <section>
              <h3>Contract</h3>
              <dl className="stat-list">
                <div>
                  <dt>Hours / week</dt>
                  <dd>{worker.contract?.hoursPerWeek ?? '—'}</dd>
                </div>
                <div>
                  <dt>Max hours</dt>
                  <dd>{worker.contract?.maxHoursPerWeek ?? '—'}</dd>
                </div>
              </dl>
            </section>

            <section>
              <h3>Credentials</h3>
              {(worker.credentials?.length ?? 0) === 0 ? (
                <p className="widget-foot">No credentials on file.</p>
              ) : (
                <ul className="record-list">
                  {worker.credentials!.map((c) => (
                    <li key={c.name}>
                      <span>{c.name}</span>
                      <span className={`chip ${c.status === 'valid' ? 'pass' : 'fail'}`}>
                        {c.status}
                        {c.expiryDate ? ` · ${c.expiryDate}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3>This week</h3>
              {(worker.thisWeekShifts?.length ?? 0) === 0 ? (
                <p className="widget-foot">No shifts in the next 7 days.</p>
              ) : (
                <ul className="record-list">
                  {worker.thisWeekShifts!.map((s) => (
                    <li key={`${s.shiftId}-${s.date}`}>
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => onOpenShift?.(s.shiftId, s.shiftName)}
                      >
                        {s.date} · #{s.shiftId} {s.shiftName}
                      </button>
                      <span className="activity-time">{s.time}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3>Past clients</h3>
              {(worker.pastAssignments?.length ?? 0) === 0 ? (
                <p className="widget-foot">No past receiver history.</p>
              ) : (
                <ul className="record-list">
                  {worker.pastAssignments!.map((p) => (
                    <li key={p.client}>
                      <span>{p.client}</span>
                      <span className="activity-time">{p.count}×</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}

        {!loading && !error && shift ? (
          <div className="record-body">
            <section>
              <h3>When & where</h3>
              <dl className="stat-list">
                <div>
                  <dt>Shift ID</dt>
                  <dd className="id-tag">{shift.shiftId}</dd>
                </div>
                {shift.erpUrl ? (
                  <div>
                    <dt>AbilityERP</dt>
                    <dd>
                      <a
                        className="erp-link"
                        href={shift.erpUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open rostered shift ↗
                      </a>
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt>Starts</dt>
                  <dd style={{ fontSize: '0.95rem' }}>
                    {new Date(shift.startTime).toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt>Ends</dt>
                  <dd style={{ fontSize: '0.95rem' }}>
                    {new Date(shift.endTime).toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt>Location</dt>
                  <dd style={{ fontSize: '0.95rem' }}>{shift.location || '—'}</dd>
                </div>
                <div>
                  <dt>Staff</dt>
                  <dd>
                    {shift.assignedStaff ?? 0}/{shift.requiredStaff ?? '—'}
                  </dd>
                </div>
              </dl>
              <p className="widget-foot">
                {shift.hoursUntilShift != null
                  ? `${shift.hoursUntilShift}h until start · doc ${shift.documentNo || '—'}`
                  : `doc ${shift.documentNo || '—'}`}
              </p>
            </section>

            <section>
              <h3>Receivers</h3>
              {(shift.receivers?.length ?? 0) === 0 ? (
                <p className="widget-foot">No receivers linked.</p>
              ) : (
                <ul className="record-list">
                  {shift.receivers!.map((r) => (
                    <li key={r.id}>
                      <span>{r.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3>Needs</h3>
              <div className="rules">
                {(shift.credentialNames ?? []).map((n) => (
                  <span key={n} className="chip">
                    {n}
                  </span>
                ))}
                {shift.transportRequired ? <span className="chip">transport</span> : null}
                {(shift.credentialNames?.length ?? 0) === 0 && !shift.transportRequired ? (
                  <span className="chip">no special needs</span>
                ) : null}
              </div>
            </section>

            <section>
              <h3>Staff lines</h3>
              <ul className="record-list">
                {(shift.staffLines ?? []).map((s, i) => (
                  <li key={`${s.line ?? i}-${s.workerId ?? 'v'}`}>
                    {s.vacant || !s.workerId ? (
                      <span className="chip fail">vacant line {s.line ?? i + 1}</span>
                    ) : (
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => onOpenWorker?.(s.workerId!, s.workerName || undefined)}
                      >
                        {s.workerName || s.workerId}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {(shift.pendingProposals?.length ?? 0) > 0 ? (
              <section>
                <h3>Pending proposals</h3>
                <ul className="record-list">
                  {shift.pendingProposals!.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => onOpenWorker?.(p.workerId, p.workerName)}
                      >
                        {p.workerName}
                      </button>
                      <span className="score">{p.score}/100</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
