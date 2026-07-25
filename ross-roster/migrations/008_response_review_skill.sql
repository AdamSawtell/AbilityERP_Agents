-- SAW052 — Response Log Review skill (AbilityERP IsResponseLogReviewRequired queue)

INSERT INTO adempiere.rostering_agent_skills
    (skill_key, name, purpose, status, trigger_label, depends_on, sort_order, config_json)
VALUES
    (
        'response_review',
        'Response Log Review',
        'Review worker REQ/DEC on shifts flagged AbERP_IsResponseLogReviewRequired',
        'on',
        'Cron: with emergency scan + Manual',
        '["worker_matching"]'::jsonb,
        25,
        '{
          "auto_accept_req": false,
          "auto_dismiss_dec": true
        }'::jsonb
    )
ON CONFLICT (skill_key) DO NOTHING;
