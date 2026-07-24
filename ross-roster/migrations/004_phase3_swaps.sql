-- SAW044 / Ross Phase 3c — shift swap proposals

CREATE TABLE IF NOT EXISTS adempiere.rostering_agent_swaps (
    id                   SERIAL PRIMARY KEY,
    requester_id         NUMERIC NOT NULL,
    requester_name       VARCHAR(255),
    partner_id           NUMERIC NOT NULL,
    partner_name         VARCHAR(255),
    shift_a_id           NUMERIC NOT NULL,
    shift_a_name         VARCHAR(255),
    shift_b_id           NUMERIC NOT NULL,
    shift_b_name         VARCHAR(255),
    staff_line_a_id      NUMERIC,
    staff_line_b_id      NUMERIC,
    requester_response   VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (requester_response IN ('pending', 'accepted', 'declined')),
    partner_response     VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (partner_response IN ('pending', 'accepted', 'declined')),
    status               VARCHAR(20) NOT NULL DEFAULT 'proposed'
        CHECK (status IN ('proposed', 'approved', 'rejected', 'expired', 'cancelled')),
    pathways_request_a_id NUMERIC,
    pathways_request_b_id NUMERIC,
    score                NUMERIC,
    source               VARCHAR(40) DEFAULT 'detect',
    notes                TEXT,
    proposed_at          TIMESTAMPTZ DEFAULT NOW(),
    reviewed_by          VARCHAR(100),
    reviewed_at          TIMESTAMPTZ,
    created              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_swaps_status
    ON adempiere.rostering_agent_swaps (status, proposed_at DESC);
CREATE INDEX IF NOT EXISTS idx_swaps_shifts
    ON adempiere.rostering_agent_swaps (shift_a_id, shift_b_id);
