/**
 * The Plan A normal migration chain, shared by the local runners that build
 * the schema the way a fresh environment would get it: every non-rollback
 * kai_sprint2_* migration, each applied once, unmodified, in the order the
 * repository introduced them. The order is reconstructed from git history
 * (the commit that first added each file); it is not the recorded production
 * migration order.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// Repository introduction order: `git log --diff-filter=A` of each file,
// oldest first. Same-commit pairs keep the browser-acceptance runner's order.
export const MIGRATION_CHAIN = [
  "kai_sprint2_gate_a_p0_upload_lifecycle",
  "kai_sprint2_gate_a_p0_policy_decision_replay",
  "kai_sprint2_p1_parser_run_and_file_profile",
  "kai_sprint2_p1_04_data_dictionary_and_quality",
  "kai_sprint2_p1_05_intake_sensitivity_profile",
  "kai_sprint2_p1_06_review_queue",
  "kai_sprint2_p1_07_intake_source_candidate",
  "kai_sprint2_p1_08_source_promotion",
  "kai_sprint2_p2_01_evidence_lineage",
  "kai_sprint2_p2_03_claim_proposal",
  "kai_sprint2_p2_04_claim_gap_followup",
  "kai_sprint2_p2_05_conflict_review_candidate",
  "kai_sprint2_p3_01_generated_content_drafts",
  "kai_sprint2_p3_04_generated_content_review_completion",
  "kai_sprint2_p3_05_export_review_request",
  "kai_sprint2_p3_09_export_review_start",
  "kai_sprint2_p3_13_export_review_completion",
  "kai_sprint2_p3_16_export_candidate_foundation",
  "kai_sprint2_p3_17_human_authority_decision_ledger",
  "kai_sprint2_gate_c1_gcs_generation_binding",
  "kai_sprint2_gk_organization_tenant_binding",
  "kai_sprint2_p2_09_human_review_internal_approval",
  "kai_sprint2_p2_10_coverage_review_decision",
  "kai_sprint2_p2_11_client_followup_completion",
  "kai_sprint2_legacy_generation_cutover_20260817",
  "kai_sprint2_p1_06_review_status_column_repair",
  "kai_sprint2_p2_09_p2_10_p2_11_forward_reconciliation",
  "kai_sprint2_p13_01_impact_narrative_content_type",
  "kai_sprint2_b1a_02_phase5_allowed_use_decision_ledger",
  "kai_sprint2_p2_12_human_review_decision_ledger",
  "kai_sprint2_a1_1_impact_outcome_context",
  "kai_sprint2_a1_2_impact_evaluation_framework_and_criteria",
  "kai_sprint2_a1_3_impact_evaluations_and_results",
  "kai_sprint2_a1_4_impact_evaluation_result_provenance_links",
  "kai_sprint2_b1_1_baseline_impact_requirements",
  "kai_sprint2_b1_3_accepted_catalogue_persistence",
  "kai_sprint2_c2_1_requirement_assessment_persistence",
  "kai_sprint2_c3_a3_requirement_assessment_decision_gap_provenance",
  "kai_sprint2_c3_a4_requirement_assessment_provenance_extension",
  "kai_sprint2_p2_10_funder_coverage_authority",
  "kai_sprint2_package_2a_engagement_requirement_sets_authority",
  "kai_sprint2_p3_17_authority_audit_gate_a_operation_repair",
  "kai_sprint2_p3_19_export_manifest_foundation",
  "kai_sprint2_gate_a_p0_upload_lifecycle_enforcement_forward_repair",
  "kai_sprint2_gate_a_p0_required_index_forward_repair",
  "kai_sprint2_p3_20_export_manifest_review_binding",
  "kai_sprint2_p14_01_generation_run_engagement_binding",
  "kai_sprint2_p14_02_grant_response_packet_export_identity_foundation",
  "kai_sprint2_p14_03_grant_response_packet_export_candidate_foundation",
  "kai_sprint2_p14_05_grant_response_packet_export_review_binding",
  "kai_sprint2_p14_07_b1_grant_response_packet_human_authority_decision_ledger",
  "kai_sprint2_p14_08_a_grant_response_packet_export_manifest_foundation",
  "kai_sprint2_p14_10_review_queue_target_object_type_repair",
  "kai_sprint2_generated_content_review_start_audit_contract",
  "kai_sprint2_br_02_board_reporting_candidate_foundation",
  "kai_sprint2_br_03a_board_reporting_candidate_review_request",
  "kai_sprint2_br_03b_board_reporting_candidate_review_lifecycle",
  "kai_sprint2_br_04_board_reporting_candidate_human_authority_decision_ledger",
  "kai_sprint2_board_reporting_candidate_export_manifest_foundation",
  "kai_sprint2_p14_14_generated_content_type_evolution",
  "kai_sprint2_p14_12_review_queue_type_check_legacy_repair",
  "kai_sprint2_p14_15_export_candidate_content_type_evolution",
  "kai_sprint2_p2_10_public_coverage_authority",
  "kai_sprint2_gate_a_p0_policy_decision_replay_object_facts_index_repair",
  "kai_sprint2_p13_ext1_case_for_support_content_type_evolution",
  "kai_sprint2_p13_ext1_case_for_support_export_candidate_content_type_evolution",
  "kai_sprint2_p13_ext2_board_update_content_type_evolution",
  "kai_sprint2_p13_ext2_board_update_export_candidate_content_type_evolution",
  "kai_sprint2_p13_ext3_annual_report_section_content_type_evolution",
  "kai_sprint2_p13_ext3_annual_report_section_export_candidate_content_type_evolution",
  "kai_sprint2_p13_ext4_funder_outcome_table_content_type_evolution",
  "kai_sprint2_p13_ext4_funder_outcome_table_export_candidate_content_type_evolution",
  "kai_sprint2_p13_ext5_grant_response_paragraph_content_type_evolution",
  "kai_sprint2_p13_ext5_grant_response_paragraph_export_candidate_content_type_evolution",
  "kai_sprint2_package_g_improvement_practices_foundation",
  "kai_sprint2_join_1_organization_join_requests",
  "kai_sprint2_p1_downstream_recovery_state",
  "kai_sprint2_b1a_02_client_admin_sensitivity_review",
  "kai_sprint2_p2_01m_source_record_count_measurement",
  "kai_sprint2_plan_a_organization_internal_release_authority",
  "kai_sprint2_plan_a_organization_internal_factual_review_authority",
];

export const PRODUCTION_HISTORY_ONLY = new Map([
  ["kai_sprint2_legacy_generation_cutover_20260817", /only accepts a fully-legacy pre-cutover state or its own fully-converged post-cutover state/],
  ["kai_sprint2_p1_06_review_status_column_repair", /converged-state check failed: expected exactly 1 CHECK constraint governing review_status/],
]);

export function verifyChainAgainstRepository(repoRoot) {
  const onDisk = readdirSync(join(repoRoot, "migrations"))
    .filter((name) => /^kai_sprint2_.*\.sql$/.test(name) && !name.endsWith(".rollback.sql"))
    .map((name) => name.replace(/\.sql$/, ""))
    .sort();
  const listed = [...MIGRATION_CHAIN].sort();
  if (JSON.stringify(onDisk) !== JSON.stringify(listed)) {
    throw new Error(`migration chain does not list exactly the repository's migrations: missing ${onDisk.filter((m) => !listed.includes(m))}, extra ${listed.filter((m) => !onDisk.includes(m))}`);
  }
  let previous = 0;
  for (const migration of MIGRATION_CHAIN) {
    const added = execFileSync("git", ["log", "--diff-filter=A", "--format=%at", "--", `migrations/${migration}.sql`], { cwd: repoRoot, encoding: "utf8" })
      .trim().split("\n").filter(Boolean).map(Number).pop();
    if (!Number.isFinite(added)) throw new Error(`no introducing commit for ${migration}`);
    if (added < previous) throw new Error(`${migration} is listed after a migration introduced later`);
    previous = added;
  }
  console.log(`Plan A chain: ${MIGRATION_CHAIN.length} migrations, order matches repository introduction order.`);
}
