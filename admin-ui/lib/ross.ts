const baseUrl = process.env.ROSS_API_URL ?? 'http://127.0.0.1:3002';
const apiKey = process.env.ROSS_API_KEY ?? '';

export async function rossFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.message || body?.error || `Ross API ${res.status}`);
  }
  return body as T;
}

export type Proposal = {
  id: number;
  shiftId: number;
  shiftName: string;
  workerId: number;
  workerName: string;
  score: number;
  isAutoApproved: boolean;
  proposedAt: string;
  status: string;
  rulesPassed?: {
    reason?: string;
    hard?: { rule: string; pass: boolean; detail?: string }[];
    soft?: { rule: string; pass: boolean; weight: number; earned: number }[];
  };
};

export type Gap = {
  id: number;
  shift_id: number;
  shift_name: string | null;
  reason: string;
  escalation_level: string;
  detected_at: string;
  resolved: boolean;
  blocked_count: number | null;
};

export type AuditEntry = {
  id: number;
  timestamp: string;
  agent_type: string;
  action: string;
  shift_id: number | null;
  worker_id: number | null;
  score: number | null;
  approved_by: string | null;
  notes: string | null;
};

export type AgentConfig = {
  auto_approve_threshold: number;
  scan_interval_minutes: number;
  pre_shift_confirm_hours: number;
  escalation_hours_before_shift: number;
  max_safe_matches_per_scan: number;
  employee_no_auto_approve: number[];
  auto_assign_enabled: boolean;
};

export type VacantShift = {
  id: number;
  name: string;
  startTime?: string;
  endTime?: string;
  urgency?: string;
  requiredStaff?: number | null;
  assignedStaff?: number;
};

export type Horizon = 'today' | 'period' | 'next';

export type Confirmation = {
  id: number;
  shiftId: number;
  shiftName: string | null;
  workerId: number;
  workerName: string | null;
  staffLineId: number | null;
  status: string;
  requestedAt: string;
  respondedAt: string | null;
  escalatedAt: string | null;
  shiftStart: string | null;
  notes: string | null;
};

export type ConfirmCycleSummary = {
  startedAt: string;
  finishedAt: string;
  sent: number;
  confirmed: number;
  declined: number;
  escalated: number;
  errors: string[];
};

export type Swap = {
  id: number;
  requesterId: number;
  requesterName: string | null;
  partnerId: number;
  partnerName: string | null;
  shiftAId: number;
  shiftAName: string | null;
  shiftBId: number;
  shiftBName: string | null;
  requesterResponse: string;
  partnerResponse: string;
  status: string;
  score: number | null;
  source: string | null;
  notes: string | null;
  proposedAt: string;
};

export type SwapCycleSummary = {
  startedAt: string;
  finishedAt: string;
  intentsSeen: number;
  proposed: number;
  considered: number;
  errors: string[];
};
