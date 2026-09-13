BEGIN;

-- Only drops the constraint the converge script in this same package would
-- have created, under its own fixed name. If the semantic prerequisite
-- already existed under a different name before this package ever ran (the
-- real production case, and the "pre-existing compatible constraint"
-- synthetic case this package's own runner proves), this rollback leaves
-- that pre-existing constraint untouched - it never inspects column shape,
-- only this exact name.
--
-- Test-only, like its converge counterpart: never run against a real/shared
-- database. See kai-sprint2-engagements-tenant-safe-identity-prerequisite-converge.sql
-- for the full ownership-model rationale.
ALTER TABLE kai.engagements
  DROP CONSTRAINT IF EXISTS kai_engagements_tenant_safe_identity_prerequisite_unique;

COMMIT;
