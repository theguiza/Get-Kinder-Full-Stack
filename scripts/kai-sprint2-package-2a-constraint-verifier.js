export const PACKAGE_2A_ENGAGEMENT_REQUIREMENT_SET_CONSTRAINTS = [
  {
    label: "unique identity constraint",
    identifierPrefix: "engagement_requirement_sets_package_2a_id_org_engagement_set_un",
    contype: "u",
    definition: "UNIQUE (engagement_requirement_set_id, organization_id, engagement_id, requirement_set_id)",
  },
  {
    label: "supersedes FK",
    identifier: "engagement_requirement_sets_package_2a_supersedes_fk",
    contype: "f",
    definition:
      "FOREIGN KEY (supersedes_engagement_requirement_set_id, organization_id, engagement_id, requirement_set_id) REFERENCES kai.engagement_requirement_sets(engagement_requirement_set_id, organization_id, engagement_id, requirement_set_id) ON DELETE RESTRICT",
  },
  {
    label: "not-self-superseding check",
    identifier: "engagement_requirement_sets_package_2a_not_self_superseding",
    contype: "c",
    definition: "CHECK ((supersedes_engagement_requirement_set_id IS DISTINCT FROM engagement_requirement_set_id))",
  },
  {
    label: "reviewed authority check",
    identifier: "engagement_requirement_sets_package_2a_reviewed_authority_check",
    contype: "c",
    definition:
      "CHECK ((((reviewed_by IS NULL) AND (reviewed_by_role IS NULL) AND (reviewed_at IS NULL)) OR ((reviewed_by IS NOT NULL) AND (reviewed_by_role = ANY (ARRAY['gk_admin'::text, 'gk_operator'::text, 'gk_reviewer'::text, 'client_admin'::text])) AND (reviewed_at IS NOT NULL))))",
  },
  {
    label: "effective state check",
    identifier: "engagement_requirement_sets_package_2a_effective_state_check",
    contype: "c",
    definition:
      "CHECK ((applicability_effective_state = ANY (ARRAY['pending_review'::text, 'applicable'::text, 'not_applicable'::text, 'retired'::text])))",
  },
  {
    label: "reviewed/effective consistency check",
    identifierPrefix: "engagement_requirement_sets_package_2a_reviewed_effective_consi",
    contype: "c",
    definition:
      "CHECK (((applicability_effective_state = 'pending_review'::text) OR ((applicability_status = 'confirmed'::text) AND (reviewed_by IS NOT NULL) AND (reviewed_by_role IS NOT NULL) AND (reviewed_at IS NOT NULL) AND (target_context_identity IS NOT NULL))))",
  },
  {
    label: "approved target check",
    identifier: "engagement_requirement_sets_package_2a_approved_target_check",
    contype: "c",
    definition:
      "CHECK (((target_context_identity IS NULL) OR ((jsonb_typeof(target_context_identity) = 'object'::text) AND (target_context_identity ? 'target_funder_id'::text) AND (target_context_identity ? 'target_framework'::text))))",
  },
];

export function assertConstraintCatalogMatch(rows, spec) {
  const matches = rows.filter((row) =>
    spec.identifier ? row.conname === spec.identifier : row.conname.startsWith(spec.identifierPrefix),
  );
  const expectedIdentifier = spec.identifier || `${spec.identifierPrefix}*`;
  if (matches.length !== 1) {
    throw new Error(`Package 2A ${spec.label} expected exactly one catalog match for ${expectedIdentifier}; found ${matches.length}`);
  }

  const [row] = matches;
  if (row.contype !== spec.contype) {
    throw new Error(`Package 2A ${spec.label} had wrong constraint type: ${row.contype}`);
  }
  if (row.convalidated !== true) {
    throw new Error(`Package 2A ${spec.label} was not validated`);
  }
  if (row.definition !== spec.definition) {
    throw new Error(`Package 2A ${spec.label} had wrong definition: ${row.definition}`);
  }
}
