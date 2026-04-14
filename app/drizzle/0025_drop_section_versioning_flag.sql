-- Retire the section_versioning feature flag.
-- Flag readers were the orchestrator /sessions/:id/sections/:sid/{state,rollback,versions} routes,
-- all deleted in sub-step (d) of the orchestrator retirement plan (2026-04-14).
DELETE FROM feature_flags WHERE key = 'section_versioning';
