-- SAW044 / Ross Phase 3b — pre-shift confirmations

CREATE TABLE IF NOT EXISTS adempiere.rostering_agent_confirmations (
    id                 SERIAL PRIMARY KEY,
    shift_id           NUMERIC NOT NULL,
    shift_name         VARCHAR(255),
    worker_id          NUMERIC NOT NULL,
    worker_name        VARCHAR(255),
    staff_line_id      NUMERIC,
    status             VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'declined', 'escalated', 'expired')),
    requested_at       TIMESTAMPTZ DEFAULT NOW(),
    responded_at       TIMESTAMPTZ,
    escalated_at       TIMESTAMPTZ,
    pathways_request_id NUMERIC,
    response_log_id    NUMERIC,
    shift_start        TIMESTAMPTZ,
    notes              TEXT,
    created            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_confirm_pending
    ON adempiere.rostering_agent_confirmations (status, shift_start);
CREATE INDEX IF NOT EXISTS idx_confirm_shift_worker
    ON adempiere.rostering_agent_confirmations (shift_id, worker_id);
