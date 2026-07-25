-- SAW049 / Ross — Configurable roster matching rules (AbilityAPP AB-0046 pattern)

CREATE TABLE IF NOT EXISTS adempiere.rostering_agent_rules (
    id              VARCHAR(64) PRIMARY KEY,
    rule_type       VARCHAR(40) NOT NULL,
    name            VARCHAR(120) NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    enforcement     VARCHAR(20) NOT NULL DEFAULT 'blocking'
        CHECK (enforcement IN ('warning', 'blocking')),
    priority        INTEGER NOT NULL DEFAULT 100,
    parameters      JSONB NOT NULL DEFAULT '{}'::jsonb,
    effective_from  DATE,
    effective_to    DATE,
    updated_by      VARCHAR(100),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    created         TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ross_rules_enabled
    ON adempiere.rostering_agent_rules (enabled, priority)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ross_rules_type
    ON adempiere.rostering_agent_rules (rule_type)
    WHERE deleted_at IS NULL;

COMMENT ON TABLE adempiere.rostering_agent_rules IS
    'Configurable roster matching / safety rules — parameters in JSONB (AbilityAPP org_roster_rule pattern).';

-- Built-in hard filters (enabled + blocking by default)
INSERT INTO adempiere.rostering_agent_rules
    (id, rule_type, name, description, enabled, enforcement, priority, parameters, updated_by)
VALUES
    (
        'rule-not-excluded',
        'not_excluded',
        'Not excluded',
        'Worker must not have hr_exclude = Y.',
        TRUE,
        'blocking',
        10,
        '{}'::jsonb,
        'system'
    ),
    (
        'rule-not-on-leave',
        'not_on_leave',
        'Not on approved leave',
        'Worker must not have approved leave overlapping the shift window.',
        TRUE,
        'blocking',
        20,
        '{}'::jsonb,
        'system'
    ),
    (
        'rule-no-time-clash',
        'no_time_clash',
        'No overlapping shift',
        'Worker must not already be assigned to an overlapping active shift.',
        TRUE,
        'blocking',
        30,
        '{}'::jsonb,
        'system'
    ),
    (
        'rule-credentials-held',
        'credentials_held',
        'Required credentials held',
        'Worker must hold every credential required by the shift for the shift window.',
        TRUE,
        'blocking',
        40,
        '{}'::jsonb,
        'system'
    ),
    (
        'rule-gender-preference',
        'gender_preference',
        'Gender preference',
        'When the shift has a gender preference, worker gender must match.',
        TRUE,
        'blocking',
        50,
        '{}'::jsonb,
        'system'
    ),
    (
        'rule-min-break-between',
        'min_break_between_shifts',
        'Min break between shifts (10h)',
        'Minimum rest hours between adjacent shifts (reduced after sleepover).',
        TRUE,
        'blocking',
        60,
        '{"minBreakHours":10,"sleepoverReducedBreakHours":8}'::jsonb,
        'system'
    ),
    (
        'rule-max-weekly-hours',
        'max_weekly_hours',
        'Max weekly / fortnightly hours',
        'Cap assigned hours in the week / fortnight containing the vacant shift.',
        TRUE,
        'blocking',
        70,
        '{"maxWeeklyHours":38,"maxFortnightlyHours":76,"maxFourWeeklyHours":152}'::jsonb,
        'system'
    ),
    (
        'rule-max-consecutive-days',
        'max_consecutive_days',
        'Max consecutive days (6)',
        'Block assignment that would create more than N consecutive work days.',
        TRUE,
        'warning',
        80,
        '{"maxConsecutiveDays":6,"minDaysOffPerWeek":2}'::jsonb,
        'system'
    ),
    (
        'rule-max-shift-hours',
        'max_shift_hours',
        'Max shift length',
        'Reject (or warn) when the vacant shift itself exceeds configured length caps.',
        FALSE,
        'warning',
        90,
        '{"standardMaxHours":8,"extendedMaxHours":10,"requiresWrittenAgreement":true,"absoluteMaxHours":12}'::jsonb,
        'system'
    )
ON CONFLICT (id) DO NOTHING;
