export type HardRuleResult = { rule: string; pass: boolean; detail?: string };

export type SoftRuleResult = {
  rule: string;
  pass: boolean;
  weight: number;
  earned: number;
};

export type MatchCandidate = {
  workerId: number;
  workerName: string;
  adUserId: number;
  score: number;
  scoreBreakdown: { category: string; weight: number; earned: number }[];
  hardRules: HardRuleResult[];
  softRules: SoftRuleResult[];
  isAutoApproved: boolean;
  reason: string;
};

export type MatchBlocker = {
  reason: string;
  detail: string;
  affectedWorkers: number;
  suggestedAction: string;
};

export type MatchResult = {
  shiftId: number;
  candidates: MatchCandidate[];
  hasHardRules: boolean;
  totalEligible: number;
  totalConsidered: number;
  blocker?: MatchBlocker;
  scanTimestamp: string;
};

export type ShiftContext = {
  shiftId: number;
  name: string;
  documentNo: string | null;
  startTs: Date;
  endTs: Date;
  shiftDate: string;
  startTimeLabel: string;
  endTimeLabel: string;
  locationId: number | null;
  locationName: string | null;
  requiredStaff: number | null;
  assignedStaff: number;
  transportRequired: boolean;
  receiverIds: number[];
  credentialIds: number[];
  credentialNames: string[];
  genderIds: number[];
};

export type WorkerRow = {
  worker_id: number;
  worker_name: string;
  ad_user_id: number;
  gender_id: number | null;
  hr_exclude: string | null;
  contract_hrs: number | null;
  max_contract_hrs: number | null;
  contract_location_id: number | null;
};
