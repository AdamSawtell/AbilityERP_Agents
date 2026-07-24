-- SAW044 / Ross Phase 3a — auto-pilot config key

INSERT INTO adempiere.rostering_agent_config (key, value, updated_by)
VALUES ('auto_assign_enabled', 'false', 'system')
ON CONFLICT (key) DO NOTHING;
