-- SAW042 / Ross Phase 1a — foundation tables (adempiere schema, not AD-registered)

CREATE TABLE IF NOT EXISTS adempiere.rostering_agent_config (
    key         VARCHAR(50) PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_by  VARCHAR(100),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS adempiere.rostering_agent_audit_log (
    id              SERIAL PRIMARY KEY,
    timestamp       TIMESTAMPTZ DEFAULT NOW(),
    agent_type      VARCHAR(20) NOT NULL CHECK (agent_type IN ('emergency', 'planner', 'system')),
    action          VARCHAR(30) NOT NULL,
    shift_id        NUMERIC,
    worker_id       NUMERIC,
    score           INTEGER CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
    rules_passed    JSONB,
    rules_failed    JSONB,
    approved_by     VARCHAR(100),
    notes           TEXT,
    previous_hash   VARCHAR(64),
    created         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp
    ON adempiere.rostering_agent_audit_log (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_shift
    ON adempiere.rostering_agent_audit_log (shift_id);
CREATE INDEX IF NOT EXISTS idx_audit_worker
    ON adempiere.rostering_agent_audit_log (worker_id);

CREATE TABLE IF NOT EXISTS adempiere.rostering_agent_gaps (
    id                 SERIAL PRIMARY KEY,
    detected_at        TIMESTAMPTZ DEFAULT NOW(),
    shift_id           NUMERIC NOT NULL,
    shift_name         VARCHAR(255),
    shift_date         DATE,
    shift_time         VARCHAR(20),
    reason             VARCHAR(30) NOT NULL,
    credential_id      NUMERIC,
    credential_name    VARCHAR(255),
    affected_workers   JSONB,
    blocked_count      INTEGER DEFAULT 1,
    resolved           BOOLEAN DEFAULT FALSE,
    training_requested BOOLEAN DEFAULT FALSE,
    escalation_level   VARCHAR(10) DEFAULT 'info'
        CHECK (escalation_level IN ('info', 'warning', 'critical')),
    escalated_at       TIMESTAMPTZ,
    resolved_at        TIMESTAMPTZ,
    resolution_notes   TEXT,
    created            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gaps_unresolved
    ON adempiere.rostering_agent_gaps (resolved, escalation_level);
CREATE INDEX IF NOT EXISTS idx_gaps_credential
    ON adempiere.rostering_agent_gaps (credential_id);
CREATE INDEX IF NOT EXISTS idx_gaps_detected
    ON adempiere.rostering_agent_gaps (detected_at DESC);

CREATE TABLE IF NOT EXISTS adempiere.rostering_agent_proposals (
    id              SERIAL PRIMARY KEY,
    shift_id        NUMERIC NOT NULL,
    shift_name      VARCHAR(255),
    worker_id       NUMERIC NOT NULL,
    worker_name     VARCHAR(255),
    score           INTEGER NOT NULL,
    rules_passed    JSONB,
    rules_failed    JSONB,
    proposed_at     TIMESTAMPTZ DEFAULT NOW(),
    status          VARCHAR(20) DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    reviewed_by     VARCHAR(100),
    reviewed_at     TIMESTAMPTZ,
    notes           TEXT,
    created         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proposals_pending
    ON adempiere.rostering_agent_proposals (status, proposed_at);
CREATE INDEX IF NOT EXISTS idx_proposals_shift
    ON adempiere.rostering_agent_proposals (shift_id);

-- Seed config (idempotent)
INSERT INTO adempiere.rostering_agent_config (key, value, updated_by)
VALUES
    ('auto_approve_threshold', '90', 'system'),
    ('scan_interval_minutes', '30', 'system'),
    ('pre_shift_confirm_hours', '14', 'system'),
    ('escalation_hours_before_shift', '4', 'system'),
    ('max_safe_matches_per_scan', '3', 'system'),
    ('employee_no_auto_approve', '[]', 'system')
ON CONFLICT (key) DO NOTHING;
