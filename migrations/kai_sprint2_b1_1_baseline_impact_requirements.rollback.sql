BEGIN;

DROP INDEX IF EXISTS kai.ix_engagement_requirement_sets_b1_1_requirement_set;
DROP INDEX IF EXISTS kai.ix_engagement_requirement_sets_b1_1_tenant_engagement;
DROP TABLE IF EXISTS kai.engagement_requirement_sets;

DROP INDEX IF EXISTS kai.ix_requirements_b1_1_set;
DROP TABLE IF EXISTS kai.requirements;

DROP INDEX IF EXISTS kai.ix_requirement_sets_b1_1_framework_version;
DROP TABLE IF EXISTS kai.requirement_sets;

DROP INDEX IF EXISTS kai.ix_requirement_framework_versions_b1_1_source;
DROP TABLE IF EXISTS kai.requirement_framework_versions;

DROP INDEX IF EXISTS kai.ux_requirement_sources_b1_1_organization_identity;
DROP INDEX IF EXISTS kai.ux_requirement_sources_b1_1_shared_identity;
DROP TABLE IF EXISTS kai.requirement_sources;

COMMIT;
