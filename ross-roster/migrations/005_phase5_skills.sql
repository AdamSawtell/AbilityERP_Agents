-- SAW046 / Ross Phase 5a — Skills Manager catalogue

CREATE TABLE IF NOT EXISTS adempiere.rostering_agent_skills (
    skill_key       VARCHAR(40) PRIMARY KEY,
    name            VARCHAR(80) NOT NULL,
    purpose         TEXT NOT NULL,
    status          VARCHAR(10) NOT NULL DEFAULT 'on'
        CHECK (status IN ('on', 'paused', 'off')),
    trigger_label   VARCHAR(80) NOT NULL,
    depends_on      JSONB NOT NULL DEFAULT '[]'::jsonb,
    sort_order      INTEGER NOT NULL DEFAULT 100,
    config_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_by      VARCHAR(100),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    created         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ross_skills_status
    ON adempiere.rostering_agent_skills (status);

INSERT INTO adempiere.rostering_agent_skills
    (skill_key, name, purpose, status, trigger_label, depends_on, sort_order, config_json)
VALUES
    (
        'shift_scanner',
        'Shift Scanner',
        'Detect unfilled shifts in the current horizon',
        'on',
        'Cron: scan interval',
        '[]'::jsonb,
        10,
        '{}'::jsonb
    ),
    (
        'worker_matching',
        'Worker Matching',
        'Score and rank eligible workers for a vacant shift',
        'on',
        'On event: Shift Scanner',
        '["shift_scanner"]'::jsonb,
        20,
        '{
          "soft_weights": {
            "continuity_of_care": 25,
            "location_proximity": 20,
            "availability_pattern": 20,
            "contract_capacity": 15,
            "transport_match": 10,
            "response_history": 10
          }
        }'::jsonb
    ),
    (
        'pathways_message',
        'Pathways Message',
        'Send Pathways chat messages to workers and officers',
        'on',
        'On event: assign / confirm / remind',
        '["worker_matching"]'::jsonb,
        30,
        '{}'::jsonb
    ),
    (
        'gap_detector',
        'Gap Detector',
        'Log no-match events and suggest training needs',
        'on',
        'On event: Worker Matching',
        '["worker_matching"]'::jsonb,
        40,
        '{}'::jsonb
    ),
    (
        'pre_shift_confirm',
        'Pre-shift Confirm',
        'Send confirmation requests before shift start',
        'on',
        'Cron: hourly',
        '[]'::jsonb,
        50,
        '{}'::jsonb
    ),
    (
        'swap_handler',
        'Swap Handler',
        'Detect swap requests and propose matches',
        'off',
        'Cron: periodic + Manual',
        '[]'::jsonb,
        60,
        '{}'::jsonb
    ),
    (
        'planner_briefing',
        'Planner Briefing',
        'Daily forecast, fill rates, hiring signals',
        'on',
        'Cron: daily 04:00',
        '[]'::jsonb,
        70,
        '{}'::jsonb
    ),
    (
        'credential_watch',
        'Credential Watch',
        'Expiry radar — workers with certs due soon',
        'on',
        'On demand (Credentials page)',
        '[]'::jsonb,
        80,
        '{}'::jsonb
    ),
    (
        'leave_replacer',
        'Leave Replacer',
        'Auto-find replacements when leave is approved (not wired yet)',
        'off',
        'On event: Leave approved',
        '["worker_matching"]'::jsonb,
        90,
        '{}'::jsonb
    )
ON CONFLICT (skill_key) DO NOTHING;
