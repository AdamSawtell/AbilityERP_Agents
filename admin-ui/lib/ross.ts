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
  shift_id: number | null;
  shift_name: string | null;
  reason: string;
  credential_id?: number | null;
  credential_name?: string | null;
  escalation_level: string;
  detected_at: string;
  resolved: boolean;
  training_requested?: boolean;
  blocked_count: number | null;
  resolution_notes?: string | null;
};

export type TrainingGapSummary = {
  credentialId: number | null;
  credentialName: string;
  reason: string;
  blockedShifts: number;
  openGaps: number;
  trainingRequested: number;
  highestEscalation: string;
  sampleGapIds: number[];
  shiftNames: string[];
};

export type ExpiringCredential = {
  assignmentId: number;
  workerId: number;
  workerName: string;
  credentialId: number;
  credentialName: string;
  expiryDate: string;
  daysLeft: number;
  window: '7' | '14' | '30';
};

export type CredentialWatchGroup = {
  credentialId: number;
  credentialName: string;
  within7Days: number;
  within14Days: number;
  within30Days: number;
  workers: ExpiringCredential[];
};

export type CredentialWatch = {
  withinDays: number;
  totals: { within7Days: number; within14Days: number; within30Days: number };
  groups: CredentialWatchGroup[];
  items: ExpiringCredential[];
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

export type CoverageCell = {
  day: string;
  band: 'morning' | 'afternoon' | 'evening';
  shifts: number;
  required: number;
  assigned: number;
  vacant: number;
  fillRate: number;
  level: 'full' | 'ok' | 'thin' | 'gap' | 'empty';
};

export type CoverageHeatmap = {
  horizon: string;
  period: { start: string; end: string };
  days: { date: string; label: string }[];
  bands: CoverageCell['band'][];
  cells: CoverageCell[];
  totals: {
    shifts: number;
    required: number;
    assigned: number;
    vacant: number;
    fillRate: number;
  };
};

export type PlannerBriefing = {
  generatedAt: string;
  period: { start: string; end: string; label: string };
  priorPeriod: { start: string; end: string; label: string };
  fillRate: {
    thisPeriod: number;
    lastPeriod: number;
    delta: number;
    vacantSlots: number;
    requiredSlots: number;
    assignedSlots: number;
    urgentVacant: number;
  };
  trainingGaps: {
    credentialId: number | null;
    credentialName: string;
    blockedShifts: number;
    openGaps: number;
    trainingRequested: number;
  }[];
  credentialExpiry: {
    within7Days: number;
    within14Days: number;
    within30Days: number;
    workers: {
      workerId: number;
      workerName: string;
      credentialName: string;
      expiryDate: string;
    }[];
  };
  hiringSignals: {
    dayOfWeek: string;
    band: string;
    vacantSlots: number;
    sampleDays: number;
    detail: string;
  }[];
  utilisation: {
    busiest: {
      workerId: number;
      workerName: string;
      assignedShifts: number;
      hoursApprox: number;
    }[];
    lightest: {
      workerId: number;
      workerName: string;
      assignedShifts: number;
      hoursApprox: number;
    }[];
  };
  forecastNext: {
    period: { start: string; end: string };
    fillRate: number;
    vacantSlots: number;
    requiredSlots: number;
  };
  recommendations: string[];
  summaryText: string;
};
