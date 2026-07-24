-- SAW047 / Ross Phase 6 — Leave Replacer tracking

CREATE TABLE IF NOT EXISTS adempiere.rostering_agent_leave_replacements (
    id                      SERIAL PRIMARY KEY,
    leave_id                NUMERIC NOT NULL,
    shift_id                NUMERIC NOT NULL,
    staff_line_id           NUMERIC,
    original_worker_id      NUMERIC,
    original_worker_name    VARCHAR(255),
    replacement_worker_id   NUMERIC,
    replacement_worker_name VARCHAR(255),
    score                   INTEGER,
    status                  VARCHAR(20) NOT NULL DEFAULT 'vacated'
        CHECK (status IN ('vacated', 'proposed', 'assigned', 'failed')),
    notes                   TEXT,
    processed_at            TIMESTAMPTZ DEFAULT NOW(),
    created                 TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (leave_id, shift_id)
);

CREATE INDEX IF NOT EXISTS idx_ross_leave_repl_processed
    ON adempiere.rostering_agent_leave_replacements (processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ross_leave_repl_status
    ON adempiere.rostering_agent_leave_replacements (status);

-- Catalogue already seeded Off; leave trigger label accurate
UPDATE adempiere.rostering_agent_skills
SET trigger_label = 'Cron: every 15m + Manual',
    purpose = 'Auto-find replacements when approved leave overlaps rostered shifts',
    updated_at = NOW()
WHERE skill_key = 'leave_replacer';
