BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.organizations') IS NULL THEN
    RAISE EXCEPTION 'kai.organizations is required before the B1.1 baseline-impact-requirements migration';
  END IF;
  IF to_regclass('kai.engagements') IS NULL THEN
    RAISE EXCEPTION 'kai.engagements is required before the B1.1 baseline-impact-requirements migration';
  END IF;
END $$;

-- B1.1 owner decision (Baseline Impact Requirements Persistence Foundation):
-- this migration creates exactly five new, additive relations - the
-- canonical generic requirements model:
--   REQUIREMENT SOURCE -> FRAMEWORK VERSION -> REQUIREMENT SET -> REQUIREMENT
--   ENGAGEMENT -> REQUIREMENT SET APPLICABILITY
-- It never creates requirement assessment, coverage, evidence/claim mapping,
-- gap, recommendation, alignment, funder-ingestion, or baseline-catalogue
-- objects, and it never modifies kai.organizations, kai.engagements, or any
-- A1/A2 impact-evaluation table (all pre-existing, owned outside this
-- package). Capability #6 (Requirement Coverage) is a separate later
-- package.
--
-- requirement_sources is the shared/tenant boundary: source_type
-- distinguishes KAI-owned, shared external, and organization-local sources.
-- organization_id is NOT NULL exactly when source_type = 'organization' and
-- NULL for every shared source type, enforced by a CHECK tied to
-- source_type rather than a separate boolean flag.
CREATE TABLE IF NOT EXISTS kai.requirement_sources (
  requirement_source_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  source_type text NOT NULL,
  source_code text NOT NULL,
  source_name text NOT NULL,
  organization_id uuid,

  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT requirement_sources_b1_1_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES kai.organizations (organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT requirement_sources_b1_1_source_type_check
    CHECK (source_type IN ('kai_standard', 'standard_framework', 'funder', 'government_program', 'reporting_template', 'organization')),
  CONSTRAINT requirement_sources_b1_1_organization_id_by_type_check
    CHECK (
      (source_type = 'organization' AND organization_id IS NOT NULL)
      OR (source_type <> 'organization' AND organization_id IS NULL)
    ),
  CONSTRAINT requirement_sources_b1_1_source_code_check
    CHECK (source_code ~ '^[a-z][a-z0-9_]{0,95}$'),
  CONSTRAINT requirement_sources_b1_1_source_name_check
    CHECK (btrim(source_name) <> '' AND char_length(source_name) <= 200),
  CONSTRAINT requirement_sources_b1_1_created_by_type_check
    CHECK (created_by_type IN ('human', 'system'))
);

-- Shared-source identity (organization_id IS NULL): one row per
-- (source_type, source_code) tuple. A plain table-level UNIQUE cannot police
-- this alone because organization_id participates in the organization-owned
-- identity below, so each ownership shape gets its own partial index.
CREATE UNIQUE INDEX IF NOT EXISTS ux_requirement_sources_b1_1_shared_identity
  ON kai.requirement_sources (source_type, source_code)
  WHERE organization_id IS NULL;

-- Organization-owned identity: source_code is unique within one
-- organization, but two different organizations may independently use the
-- same organization-local source_code.
CREATE UNIQUE INDEX IF NOT EXISTS ux_requirement_sources_b1_1_organization_identity
  ON kai.requirement_sources (organization_id, source_code)
  WHERE source_type = 'organization';

-- requirement_framework_versions: stable framework identity
-- (requirement_source_id, framework_code) plus one version. Mirrors the
-- A1.2 framework_version convention (framework_status lifecycle
-- draft -> active -> retired; a version row, once created, is never mutated
-- in place to change its methodology). This package never references any
-- A1 evaluation-framework table.
CREATE TABLE IF NOT EXISTS kai.requirement_framework_versions (
  requirement_framework_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_source_id uuid NOT NULL,

  framework_code text NOT NULL,
  framework_name text NOT NULL,
  version_label text NOT NULL,
  framework_status text NOT NULL DEFAULT 'draft',

  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT requirement_framework_versions_b1_1_source_fk
    FOREIGN KEY (requirement_source_id)
    REFERENCES kai.requirement_sources (requirement_source_id)
    ON DELETE RESTRICT,
  CONSTRAINT requirement_framework_versions_b1_1_identity_unique
    UNIQUE (requirement_source_id, framework_code, version_label),
  CONSTRAINT requirement_framework_versions_b1_1_framework_code_check
    CHECK (framework_code ~ '^[a-z][a-z0-9_]{0,95}$'),
  CONSTRAINT requirement_framework_versions_b1_1_framework_name_check
    CHECK (btrim(framework_name) <> '' AND char_length(framework_name) <= 200),
  CONSTRAINT requirement_framework_versions_b1_1_version_label_check
    CHECK (version_label ~ '^[a-z0-9][a-z0-9._-]{0,31}$'),
  CONSTRAINT requirement_framework_versions_b1_1_framework_status_check
    CHECK (framework_status IN ('draft', 'active', 'retired')),
  CONSTRAINT requirement_framework_versions_b1_1_created_by_type_check
    CHECK (created_by_type IN ('human', 'system'))
);

CREATE INDEX IF NOT EXISTS ix_requirement_framework_versions_b1_1_source
  ON kai.requirement_framework_versions (requirement_source_id);

-- requirement_sets: one set belongs to exactly one framework version, which
-- is the only version boundary this package introduces - there is no
-- independent requirement_set_versions relation.
CREATE TABLE IF NOT EXISTS kai.requirement_sets (
  requirement_set_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_framework_version_id uuid NOT NULL,

  set_key text NOT NULL,
  set_name text NOT NULL,

  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT requirement_sets_b1_1_framework_version_fk
    FOREIGN KEY (requirement_framework_version_id)
    REFERENCES kai.requirement_framework_versions (requirement_framework_version_id)
    ON DELETE RESTRICT,
  CONSTRAINT requirement_sets_b1_1_identity_unique
    UNIQUE (requirement_framework_version_id, set_key),
  CONSTRAINT requirement_sets_b1_1_set_key_check
    CHECK (set_key ~ '^[a-z][a-z0-9_]{0,95}$'),
  CONSTRAINT requirement_sets_b1_1_set_name_check
    CHECK (btrim(set_name) <> '' AND char_length(set_name) <= 200),
  CONSTRAINT requirement_sets_b1_1_created_by_type_check
    CHECK (created_by_type IN ('human', 'system'))
);

CREATE INDEX IF NOT EXISTS ix_requirement_sets_b1_1_framework_version
  ON kai.requirement_sets (requirement_framework_version_id);

-- requirements: one requirement belongs to exactly one requirement set. No
-- assessment, coverage, mapping, gap, recommendation, or alignment field is
-- present - this table is pure catalogue identity/text.
CREATE TABLE IF NOT EXISTS kai.requirements (
  requirement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_set_id uuid NOT NULL,

  requirement_key text NOT NULL,
  requirement_label text NOT NULL,
  requirement_description text,
  display_order integer NOT NULL,

  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT requirements_b1_1_set_fk
    FOREIGN KEY (requirement_set_id)
    REFERENCES kai.requirement_sets (requirement_set_id)
    ON DELETE RESTRICT,
  CONSTRAINT requirements_b1_1_identity_unique
    UNIQUE (requirement_set_id, requirement_key),
  CONSTRAINT requirements_b1_1_requirement_key_check
    CHECK (requirement_key ~ '^[a-z][a-z0-9_]{0,95}$'),
  CONSTRAINT requirements_b1_1_requirement_label_check
    CHECK (btrim(requirement_label) <> '' AND char_length(requirement_label) <= 200),
  CONSTRAINT requirements_b1_1_requirement_description_check
    CHECK (requirement_description IS NULL OR char_length(requirement_description) <= 4000),
  CONSTRAINT requirements_b1_1_display_order_check
    CHECK (display_order >= 0),
  CONSTRAINT requirements_b1_1_created_by_type_check
    CHECK (created_by_type IN ('human', 'system'))
);

CREATE INDEX IF NOT EXISTS ix_requirements_b1_1_set
  ON kai.requirements (requirement_set_id);

-- engagement_requirement_sets: the tenant-scoped applicability object -
-- "this requirement set applies to this engagement". Tenant scoping mirrors
-- the A1.1 shape: engagement_id is bound through the composite
-- (engagement_id, organization_id) -> kai.engagements (engagement_id,
-- organization_id) foreign key so an engagement can never be attached to an
-- organization other than the one that owns it. This package adds no
-- applicability provenance beyond created_by/created_by_type/created_at.
CREATE TABLE IF NOT EXISTS kai.engagement_requirement_sets (
  engagement_requirement_set_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  engagement_id uuid NOT NULL,
  requirement_set_id uuid NOT NULL,

  applicability_status text NOT NULL DEFAULT 'proposed',

  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT engagement_requirement_sets_b1_1_engagement_fk
    FOREIGN KEY (engagement_id, organization_id)
    REFERENCES kai.engagements (engagement_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT engagement_requirement_sets_b1_1_requirement_set_fk
    FOREIGN KEY (requirement_set_id)
    REFERENCES kai.requirement_sets (requirement_set_id)
    ON DELETE RESTRICT,
  CONSTRAINT engagement_requirement_sets_b1_1_identity_unique
    UNIQUE (organization_id, engagement_id, requirement_set_id),
  CONSTRAINT engagement_requirement_sets_b1_1_applicability_status_check
    CHECK (applicability_status IN ('proposed', 'confirmed', 'retired')),
  CONSTRAINT engagement_requirement_sets_b1_1_created_by_type_check
    CHECK (created_by_type IN ('human', 'system'))
);

CREATE INDEX IF NOT EXISTS ix_engagement_requirement_sets_b1_1_tenant_engagement
  ON kai.engagement_requirement_sets (organization_id, engagement_id);

CREATE INDEX IF NOT EXISTS ix_engagement_requirement_sets_b1_1_requirement_set
  ON kai.engagement_requirement_sets (requirement_set_id);

COMMIT;
