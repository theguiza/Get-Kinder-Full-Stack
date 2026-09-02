BEGIN;

-- B1.3 rollback: removes only the rows this package persisted - the
-- kai_baseline_impact_v1/v1 catalogue hierarchy under the
-- kai_standard/kai_baseline_impact_requirements source - in dependency-safe
-- (child-before-parent) order. It drops no relation and no column: the five
-- B1.1 tables (kai.requirement_sources, kai.requirement_framework_versions,
-- kai.requirement_sets, kai.requirements, kai.engagement_requirement_sets)
-- and every unrelated row in them are left exactly as they were.

DELETE FROM kai.requirements
WHERE requirement_set_id IN (
  SELECT rs.requirement_set_id
  FROM kai.requirement_sets rs
  JOIN kai.requirement_framework_versions fv
    ON fv.requirement_framework_version_id = rs.requirement_framework_version_id
  JOIN kai.requirement_sources src
    ON src.requirement_source_id = fv.requirement_source_id
  WHERE src.source_type = 'kai_standard'
    AND src.source_code = 'kai_baseline_impact_requirements'
    AND fv.framework_code = 'kai_baseline_impact_v1'
    AND fv.version_label = 'v1'
);

DELETE FROM kai.requirement_sets
WHERE requirement_framework_version_id IN (
  SELECT fv.requirement_framework_version_id
  FROM kai.requirement_framework_versions fv
  JOIN kai.requirement_sources src
    ON src.requirement_source_id = fv.requirement_source_id
  WHERE src.source_type = 'kai_standard'
    AND src.source_code = 'kai_baseline_impact_requirements'
    AND fv.framework_code = 'kai_baseline_impact_v1'
    AND fv.version_label = 'v1'
);

DELETE FROM kai.requirement_framework_versions
WHERE requirement_source_id IN (
  SELECT requirement_source_id FROM kai.requirement_sources
  WHERE source_type = 'kai_standard' AND source_code = 'kai_baseline_impact_requirements'
)
AND framework_code = 'kai_baseline_impact_v1'
AND version_label = 'v1';

DELETE FROM kai.requirement_sources
WHERE source_type = 'kai_standard' AND source_code = 'kai_baseline_impact_requirements';

COMMIT;
