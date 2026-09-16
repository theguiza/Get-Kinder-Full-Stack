# KAI Final Production Database Repair Packet

Source HEAD: `c14621eb690c1b5afe4bf53e026c7767bf59705e`

Production execution target: existing pgAdmin production execution surface only. Do not rediscover or substitute database access.

This packet prepares execution only. No production mutation was executed while preparing it.

## Production Mutation Boundary

These files mutate production if executed:

- `02_package_2a_forward.sql`
- `04_gate_a_index_only_forward.sql`
- `08_gate_a_index_only_rollback.sql`
- `09_package_2a_rollback_only_if_safe.sql`

These files are read-only verification/precheck SQL:

- `01_read_only_preflight.sql`
- `03_package_2a_post_forward_verification.sql`
- `05_gate_a_post_forward_verification.sql`
- `06_combined_final_two_surface_verification.sql`
- `07_package_2a_rollback_precheck.sql`

## Exact Execution Order

A. Read-only preflight:

1. Execute `01_read_only_preflight.sql`.
2. Expected PASS condition: every result row has `status = PASS` and the script raises notice `PRE_FLIGHT_READY`.
3. Stop conditions: any `FAIL` row or exception. Do not run forward SQL.

B. Package 2A forward SQL:

1. Execute `02_package_2a_forward.sql`.
2. This is production mutation.
3. Source: verbatim from `migrations/kai_sprint2_package_2a_engagement_requirement_sets_authority.sql`.
4. Stop conditions: any SQL error or transaction failure.

C. Package 2A post-forward verification:

1. Execute `03_package_2a_post_forward_verification.sql`.
2. Expected PASS condition: every result row has `status = PASS` and the script raises notice `PACKAGE_2A_FORWARD_VERIFIED`.
3. Stop conditions: any `FAIL` row or exception. Do not continue to Gate-A forward SQL.
4. PostgreSQL 63-byte identifier handling: the two proven long Package 2A constraints are matched by the corrected verifier's prefixes:
   - `engagement_requirement_sets_package_2a_id_org_engagement_set_un%`
   - `engagement_requirement_sets_package_2a_reviewed_effective_consi%`

D. Gate-A index-only forward SQL:

1. Execute `04_gate_a_index_only_forward.sql`.
2. This is production mutation.
3. Source: verbatim from `migrations/kai_sprint2_gate_a_p0_policy_decision_replay_object_facts_index_repair.sql`.
4. Stop conditions: any SQL error or transaction failure.
5. Do not replay the full historical Gate-A migration.

E. Gate-A post-forward verification:

1. Execute `05_gate_a_post_forward_verification.sql`.
2. Expected PASS condition: every result row has `status = PASS` and the script raises notice `GATE_A_INDEX_ONLY_FORWARD_VERIFIED`.
3. Stop conditions: any `FAIL` row or exception. Do not declare Gate-A complete.

F. Combined final two-surface verification:

1. Execute `06_combined_final_two_surface_verification.sql`.
2. Expected PASS condition: every result row has `status = PASS` and the script raises notice `FINAL_TWO_SURFACES_VERIFIED`.
3. Stop conditions: any `FAIL` row or exception. Do not declare production repair complete.

G. Package 2A rollback-precheck:

1. Execute `07_package_2a_rollback_precheck.sql` before any Package 2A rollback.
2. Expected result: exactly one row with `rollback_precheck` equal to either `SAFE_TO_ROLL_BACK` or `UNSAFE_TO_ROLL_BACK_WITH_EXISTING_DATA`.

H. Rollback instructions:

1. Gate-A index-only rollback:
   - Execute `08_gate_a_index_only_rollback.sql` if Gate-A rollback is required.
   - This is production mutation.
   - Source: verbatim from `migrations/kai_sprint2_gate_a_p0_policy_decision_replay_object_facts_index_repair.rollback.sql`.
2. Package 2A rollback:
   - Execute `07_package_2a_rollback_precheck.sql`.
   - Execute `09_package_2a_rollback_only_if_safe.sql` only when `rollback_precheck = SAFE_TO_ROLL_BACK`.
   - This is production mutation.
   - Source: verbatim from `migrations/kai_sprint2_package_2a_engagement_requirement_sets_authority.rollback.sql`.
3. Otherwise STOP with `UNSAFE_TO_ROLL_BACK_WITH_EXISTING_DATA`.

## Prohibitions

- Do not connect to production while preparing this packet.
- Do not use pgAdmin during preparation.
- Do not execute SQL against production during preparation.
- Do not deploy, push, change flags, access credentials, or use real client data.
- Do not run DELETE, TRUNCATE, or data-rewriting SQL in this packet.
