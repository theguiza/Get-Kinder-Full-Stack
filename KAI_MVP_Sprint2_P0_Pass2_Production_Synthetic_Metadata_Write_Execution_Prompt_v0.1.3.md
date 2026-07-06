# KAI MVP Sprint 2 P0 Pass 2 Production Synthetic Metadata Write Execution Prompt v0.1.3

## Purpose

Execute the accepted production synthetic metadata-only write verification for:

```text
KAI_MVP_Sprint2_P0_Pass2_Production_Synthetic_Metadata_Write_Gate_Plan_v0.1.1
```

This runbook is for a later controlled production execution window only.

Do not execute this runbook while preparing or reviewing this prompt.

## Scope And No-Go Rules

Allowed goal:

```text
one controlled production synthetic metadata-only verification of Sprint 2 P0 Pass 2 admin intake
```

Do not:

```text
patch repo code
change tests
change verifier scripts
change schema
run migrations
rollback
restore
reseed
run cleanup/delete SQL
enable production Sprint 2 routes outside the controlled verifier window
run the production write-path verifier before all gates pass
run POST /api/kai/sprint2/intake/admin/batches before all gates pass
run POST /api/kai/sprint2/intake/admin/batches/:intakeBatchId/file-reservations before all gates pass
create or mutate kai.* rows manually
write directly to kai.*
perform unauthorized kai.* writes
delete production rows
invent replacement markers during the same run
add raw upload
add signed upload URLs
add signed read URLs
add parser workers
add source promotion
add evidence extraction
add claims
add reports or exports
add Neo4j behavior
add assistant tools
add connectors
```

All allowed `kai.*` writes must go through the accepted service and validator paths.

Allowed production write targets are only:

```text
kai.intake_batches
kai.intake_files
metadata-only kai.audit_events rows produced by expected validator blockers
```

All database work in this runbook must be performed through pgAdmin Query Tool only, and every pgAdmin SQL session must begin with:

```sql
SET default_transaction_read_only = on;
```

Do not print:

```text
DATABASE_URL
auth cookies
bearer tokens
session values
credentials
secrets
```

Do not weaken existing stop conditions.

Do not convert any existing stop condition into a warning, INFO row, OBSERVATION row, or optional operator judgment.

Any existing stop condition in v0.1.2 must remain a stop condition in v0.1.3 unless the change makes it stricter.

## Step 1: Confirm Accepted Commit And Deployment

Before any production execution step, check the local working tree:

```sh
git status --short
```

Continue only if the working tree is clean, or any uncommitted files are explicitly confirmed unrelated and not part of the deployed production runtime.

Hard stop:

```text
Do not execute the production verifier if repo code, verifier script, tests, schema, migration, rollback, seed, restore, or cleanup files have uncommitted changes.
```

Record:

```text
pre_run_git_status_short = <clean, or summarized unrelated uncommitted files confirmed not part of deployed production runtime>
```

Record the accepted git commit hash:

```sh
git rev-parse HEAD
```

Record:

```text
accepted_commit_hash = <git commit hash>
deployment_or_version = <deployment/version, release id, image digest, or not available>
deployment_confirmation = <operator confirmation that the running production deployment corresponds to the accepted P0 Pass 2 commit>
```

Continue only if:

```text
- the pre-run git status check is recorded
- the git commit hash is recorded
- the deployment/version is recorded, or recorded as "not available"
- the operator confirms the running deployment corresponds to the accepted P0 Pass 2 commit
```

Stop if the pre-run git status check is not recorded, the commit hash cannot be recorded, the deployment cannot be confirmed to correspond to the accepted P0 Pass 2 commit, or any repo code, verifier script, tests, schema, migration, rollback, seed, restore, or cleanup files have uncommitted changes.

## Step 2: Confirm Exact Marker Values

Before any production write, record and review these exact values:

```text
organization_id = a5d17c5a-c55f-43af-9b21-fe63aafe733f
engagement_id = 2e426ea1-2be3-4e48-b80f-9783ddbacda0
batch_code = NCWS-P0-PASS2-METADATA-001
batch idempotency_key = kai-p0-pass2-ncws-batch-001
file reservation idempotency_key = kai-p0-pass2-ncws-file-reservation-001
batch_metadata.p0_pass = pass2_admin_metadata_intake_verification
batch_metadata.gate_plan = KAI_MVP_Sprint2_P0_Pass2_Production_Synthetic_Metadata_Write_Gate_Plan_v0.1.1
file_metadata.p0_pass or equivalent reservation marker = pass2_admin_metadata_intake_verification
file_metadata.gate_plan or equivalent reservation marker = KAI_MVP_Sprint2_P0_Pass2_Production_Synthetic_Metadata_Write_Gate_Plan_v0.1.1
```

Continue only if the operator confirms these exact reviewed marker values will be used, or the verifier has documented hardcoded equivalents reviewed as equivalent before the run.

Stop before enabling `KAI_SPRINT2_ENABLED=true` if the verifier cannot send and verify the exact reviewed marker values or documented hardcoded equivalents.

## Step 3: Confirm Production DB And API Targets Before SQL Or API Execution

Complete this step before any pgAdmin marker SQL, post-write SQL verifier, feature-flag status API call, or production API verifier call.

Required pgAdmin target confirmation:

```text
pgadmin_database_name = <database name>
pgadmin_host_provider_label = Render production Postgres
pgadmin_connected_user = <connected user if safe, otherwise masked/not recorded>
pgadmin_target_confirmation = I confirm this is the intended production Render Postgres database.
```

The pgAdmin target confirmation must:

```text
- record database name
- record host/provider label as Render production Postgres without printing DATABASE_URL or credentials
- record connected user if safe
- confirm this is the intended production Render Postgres database
```

Use pgAdmin connection properties or UI metadata where possible. If a read-only target-identification SQL query is required to obtain database name or connected user, it is the only permitted preliminary SQL and must begin with `SET default_transaction_read_only = on;`. Do not run any marker, verifier, mutation, cleanup, delete, migration, or schema SQL until the pgAdmin target is confirmed.

Required API target confirmation:

```text
KAI_PASS2_BASE_URL_host = <host only>
api_target_confirmation = I confirm this is the production app URL.
api_target_not_localhost = confirmed
api_target_not_preview = confirmed
api_target_not_staging = confirmed
api_target_not_tunnel = confirmed
```

The API target confirmation must:

```text
- record KAI_PASS2_BASE_URL host only
- confirm it is the production app URL
- confirm it is not localhost
- confirm it is not a preview URL
- confirm it is not staging
- confirm it is not a tunnel
```

Do not print:

```text
DATABASE_URL
auth cookies
bearer tokens
session values
credentials
secrets
```

Stop if either the pgAdmin target or API target is ambiguous.

## Step 4: Confirm Verifier Capability Before Production Writes

Inspect the accepted deployed verifier script without changing it:

```text
scripts/kai-sprint2-pass2-admin-metadata-intake-api-verifier.js
```

Confirm it supports all required production gate controls:

```text
KAI_PASS2_DB_TARGET_CLASS=production
KAI_PASS2_PRODUCTION_SYNTHETIC_WRITE_GATE_ACCEPTED=true
KAI_PASS2_RUN_WRITE_PATH=true
KAI_PASS2_ORGANIZATION_ID=a5d17c5a-c55f-43af-9b21-fe63aafe733f
KAI_PASS2_ENGAGEMENT_ID=2e426ea1-2be3-4e48-b80f-9783ddbacda0
```

The verifier must stop before write-path execution if any required gate variable is absent, false, ambiguous, or unsupported.

Confirm it uses or documents hardcoded equivalents for these exact markers:

```text
batch_code = NCWS-P0-PASS2-METADATA-001
batch idempotency_key = kai-p0-pass2-ncws-batch-001
file reservation idempotency_key = kai-p0-pass2-ncws-file-reservation-001
batch_metadata.p0_pass = pass2_admin_metadata_intake_verification
batch_metadata.gate_plan = KAI_MVP_Sprint2_P0_Pass2_Production_Synthetic_Metadata_Write_Gate_Plan_v0.1.1
file_metadata.p0_pass or equivalent reservation marker = pass2_admin_metadata_intake_verification
file_metadata.gate_plan or equivalent reservation marker = KAI_MVP_Sprint2_P0_Pass2_Production_Synthetic_Metadata_Write_Gate_Plan_v0.1.1
```

The verifier must also prove before writes:

```text
req.user.id -> public.userdata.id
public.userdata.id -> active kai.users.legacy_public_userdata_id
kai.users.user_id -> gk_admin or gk_operator role
kai.users.user_id -> active kai.organization_memberships row for organization_id a5d17c5a-c55f-43af-9b21-fe63aafe733f
engagement_id 2e426ea1-2be3-4e48-b80f-9783ddbacda0 belongs to organization_id a5d17c5a-c55f-43af-9b21-fe63aafe733f
req.user is never serialized in API output
session data is never serialized in API output
auth failures do not create kai.* rows
tenant/auth failures do not create intake batch or file rows
```

Negative auth/tenant checks may run only if they are already implemented in the accepted verifier as no-write or expected-blocker checks and are verified by stable-marker SQL evidence.

Do not:

```text
invent additional production negative POST scenarios
manually call extra invalid POST requests outside the accepted verifier
broaden the route allowlist
create extra synthetic rows to test negative cases
```

Negative auth/tenant checks must create no intake batch rows and no intake file rows.

Stop before enabling `KAI_SPRINT2_ENABLED=true` if any verifier capability is missing or ambiguous.

## Step 5: Secret And Auth Handling

Auth material may be supplied only through environment variables:

```text
KAI_PASS2_AUTH_COOKIE
KAI_PASS2_BEARER_TOKEN
```

The production API verifier may use either:

```text
KAI_PASS2_AUTH_COOKIE
```

or:

```text
KAI_PASS2_BEARER_TOKEN
```

Auth-method rule:

```text
Use exactly one auth mechanism unless the verifier has documented precedence for both.
Preferred: use the same authenticated path that production admin routes actually require.

If using cookie auth, unset KAI_PASS2_BEARER_TOKEN.

If using bearer auth, unset KAI_PASS2_AUTH_COOKIE.

If both KAI_PASS2_AUTH_COOKIE and KAI_PASS2_BEARER_TOKEN are present and verifier precedence is not documented, stop before enabling KAI_SPRINT2_ENABLED=true.
```

Record:

```text
auth_method_used = KAI_PASS2_AUTH_COOKIE or KAI_PASS2_BEARER_TOKEN
exactly_one_auth_method_used = true
```

If both are present and the verifier has documented precedence, record:

```text
auth_method_used = <effective auth method>
both_auth_methods_present = true
verifier_auth_precedence_documented = <where documented, without exposing auth material>
```

Operational requirements:

```text
Do not paste auth cookie or bearer token values directly into command lines.
Do not print auth values.
Do not print environment values.
Do not run env, printenv, set, export -p, history, or shell debug commands that would expose auth material.
Do not run commands with set -x while auth/env values are present.
Load auth values from a local untracked environment source or secure secret manager.
Confirm auth values are present without printing them.
Do not include auth material in markdown evidence, terminal output, tickets, screenshots, logs, or commits.
Do not print session values.
Do not print DATABASE_URL.
Do not print credentials.
Do not print secrets.
Mask auth/env values in all logs and evidence.
```

Use:

```sh
set +x
```

Stop if auth or secret masking cannot be preserved.

Every verifier command template in this runbook must show either a cookie-auth version or a bearer-auth version, not a mixed version that passes both auth variables.

Do not show, run, or record any command template that passes both auth variables unless verifier precedence is documented and recorded in evidence.

## Step 6: pgAdmin Pre-Write Marker Absence Check

Use pgAdmin Query Tool only.

Begin the pgAdmin Query Tool session with:

```sql
SET default_transaction_read_only = on;
```

Run this exact accepted read-only SQL:

```sql
SET default_transaction_read_only = on;

WITH expected AS (
  SELECT
    'NCWS-P0-PASS2-METADATA-001'::text AS batch_code,
    'kai-p0-pass2-ncws-batch-001'::text AS batch_idempotency_key,
    'kai-p0-pass2-ncws-file-reservation-001'::text AS file_idempotency_key,
    'pass2_admin_metadata_intake_verification'::text AS p0_pass,
    'KAI_MVP_Sprint2_P0_Pass2_Production_Synthetic_Metadata_Write_Gate_Plan_v0.1.1'::text AS gate_plan
),
marker_matches AS (
  SELECT 'kai.intake_batches' AS object_name, count(*) AS match_count
  FROM kai.intake_batches b
  JOIN expected e ON b.batch_code = e.batch_code
    OR b.idempotency_key = e.batch_idempotency_key
    OR b.batch_metadata->>'p0_pass' = e.p0_pass
    OR b.batch_metadata->>'gate_plan' = e.gate_plan
  UNION ALL
  SELECT 'kai.intake_files' AS object_name, count(*) AS match_count
  FROM kai.intake_files f
  JOIN expected e ON f.file_metadata->>'idempotency_key' = e.file_idempotency_key
    OR f.file_metadata->>'p0_pass' = e.p0_pass
    OR f.file_metadata->>'gate_plan' = e.gate_plan
  UNION ALL
  SELECT 'kai.audit_events' AS object_name, count(*) AS match_count
  FROM kai.audit_events a
  JOIN expected e ON a.metadata->>'p0_pass' = e.p0_pass
    OR a.metadata->>'gate_plan' = e.gate_plan
)
SELECT
  'CHECK' AS result_type,
  'PASS2_PRE_WRITE_MARKER_ABSENCE' AS check_name,
  object_name,
  CASE WHEN match_count = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  'Existing production rows matching reviewed Pass 2 markers: ' || match_count AS detail
FROM marker_matches;
```

Continue only if every `result_type='CHECK'` row is `PASS`.

If any marker exists:

```text
stop
do not delete rows
do not rollback
do not restore
do not reseed
do not invent new markers
do not create cleanup SQL
preserve the pre-write output as evidence
require a later reviewed plan to decide next action
```

## Step 7: Confirm Backup Or Restore-Point Evidence

Before enabling `KAI_SPRINT2_ENABLED=true`, record the latest available Render/Postgres backup or restore-point status if accessible.

Record:

```text
backup_restore_point_status = <latest available Render/Postgres backup or restore-point status, timestamp, or not accessible>
```

This is evidence only.

Do not:

```text
run rollback
run restore
run point-in-time recovery
use backup status as permission to broaden the write scope
```

If backup/restore-point status cannot be confirmed, require explicit operator confirmation:

```text
I accept proceeding with this metadata-only synthetic production write gate without backup/restore-point status evidence.
```

Stop before enabling `KAI_SPRINT2_ENABLED=true` if backup/restore-point status is unavailable and the explicit operator acceptance is not recorded.

## Step 8: Confirm Feature Flag OFF Before Window

Confirm production configuration currently has:

```text
KAI_SPRINT2_ENABLED=false
```

Run a feature-flag OFF status check using only the allowed status route or the verifier with write path disabled.

Allowed route:

```text
GET /api/kai/sprint2/intake/status
```

Choose exactly one command template.

Cookie-auth command template:

```bash
set +x
unset KAI_PASS2_BEARER_TOKEN

KAI_PASS2_BASE_URL="<production-base-url>" \
KAI_PASS2_AUTH_COOKIE="${KAI_PASS2_AUTH_COOKIE}" \
KAI_PASS2_DB_TARGET_CLASS=production \
KAI_PASS2_PRODUCTION_SYNTHETIC_WRITE_GATE_ACCEPTED=true \
KAI_PASS2_RUN_WRITE_PATH=false \
KAI_PASS2_ORGANIZATION_ID=a5d17c5a-c55f-43af-9b21-fe63aafe733f \
KAI_PASS2_ENGAGEMENT_ID=2e426ea1-2be3-4e48-b80f-9783ddbacda0 \
node scripts/kai-sprint2-pass2-admin-metadata-intake-api-verifier.js
```

Bearer-auth command template:

```bash
set +x
unset KAI_PASS2_AUTH_COOKIE

KAI_PASS2_BASE_URL="<production-base-url>" \
KAI_PASS2_BEARER_TOKEN="${KAI_PASS2_BEARER_TOKEN}" \
KAI_PASS2_DB_TARGET_CLASS=production \
KAI_PASS2_PRODUCTION_SYNTHETIC_WRITE_GATE_ACCEPTED=true \
KAI_PASS2_RUN_WRITE_PATH=false \
KAI_PASS2_ORGANIZATION_ID=a5d17c5a-c55f-43af-9b21-fe63aafe733f \
KAI_PASS2_ENGAGEMENT_ID=2e426ea1-2be3-4e48-b80f-9783ddbacda0 \
node scripts/kai-sprint2-pass2-admin-metadata-intake-api-verifier.js
```

Expected OFF evidence:

```text
API_FEATURE_OFF_STATUS_RETURNS_DISABLED = PASS
```

Stop if the feature-flag OFF check fails.

## Step 9: Define Controlled Feature-Flag Window

Before enabling `KAI_SPRINT2_ENABLED=true`, record:

```text
maximum KAI_SPRINT2_ENABLED=true window = 10 minutes
operator responsible for resetting the flag OFF = <explicit operator name/handle>
feature_flag_enable_started_at = <UTC timestamp immediately before enabling>
feature_flag_disabled_at = <to be recorded immediately after disabling>
```

The `KAI_SPRINT2_ENABLED=true` window must not exceed 10 minutes.

Interruption rule:

```text
If the terminal, verifier, Render dashboard, network connection, browser session, or operator session is interrupted while KAI_SPRINT2_ENABLED=true, the next action is to set KAI_SPRINT2_ENABLED=false and confirm OFF.

Do not analyze results, rerun commands, troubleshoot API behavior, or continue verification while the flag remains ON unless the action is required to turn the flag OFF.
```

If the flag cannot be reset to OFF, treat it as a production incident / feature-flag rollback-to-off issue.

Do not run code rollback unless separately justified and reviewed.

Stop before enabling `KAI_SPRINT2_ENABLED=true` if the maximum window, responsible operator, or pre-enable timestamp is not recorded.

## Step 10: Open Controlled Feature-Flag Window

Record timestamp immediately before enabling:

```text
feature_flag_enable_started_at = <UTC timestamp>
```

Enable:

```text
KAI_SPRINT2_ENABLED=true
```

Enable only for the controlled verifier window.

Confirm the running app observes the flag as true before POST tests. Use only:

```text
GET /api/kai/sprint2/intake/status
```

Or run the verifier with write path disabled and confirm:

```text
API_FEATURE_ON_STATUS_RETURNS_READY_METADATA_ONLY = PASS
API_STATUS_RESPONSE_HAS_NO_FORBIDDEN_KEYS = PASS
```

Choose exactly one write-path-disabled command template.

Cookie-auth command template:

```bash
set +x
unset KAI_PASS2_BEARER_TOKEN

KAI_PASS2_BASE_URL="<production-base-url>" \
KAI_PASS2_AUTH_COOKIE="${KAI_PASS2_AUTH_COOKIE}" \
KAI_PASS2_DB_TARGET_CLASS=production \
KAI_PASS2_PRODUCTION_SYNTHETIC_WRITE_GATE_ACCEPTED=true \
KAI_PASS2_RUN_WRITE_PATH=false \
KAI_PASS2_ORGANIZATION_ID=a5d17c5a-c55f-43af-9b21-fe63aafe733f \
KAI_PASS2_ENGAGEMENT_ID=2e426ea1-2be3-4e48-b80f-9783ddbacda0 \
node scripts/kai-sprint2-pass2-admin-metadata-intake-api-verifier.js
```

Bearer-auth command template:

```bash
set +x
unset KAI_PASS2_AUTH_COOKIE

KAI_PASS2_BASE_URL="<production-base-url>" \
KAI_PASS2_BEARER_TOKEN="${KAI_PASS2_BEARER_TOKEN}" \
KAI_PASS2_DB_TARGET_CLASS=production \
KAI_PASS2_PRODUCTION_SYNTHETIC_WRITE_GATE_ACCEPTED=true \
KAI_PASS2_RUN_WRITE_PATH=false \
KAI_PASS2_ORGANIZATION_ID=a5d17c5a-c55f-43af-9b21-fe63aafe733f \
KAI_PASS2_ENGAGEMENT_ID=2e426ea1-2be3-4e48-b80f-9783ddbacda0 \
node scripts/kai-sprint2-pass2-admin-metadata-intake-api-verifier.js
```

Stop if the app cannot be confirmed to observe `KAI_SPRINT2_ENABLED=true`.

If any interruption occurs while the flag is ON, immediately set `KAI_SPRINT2_ENABLED=false` and confirm OFF before any other action.

## Step 11: Run Production Synthetic Metadata-Only API Verifier

Run the verifier only after all previous gates pass.

Do not include real auth cookies or tokens in this prompt, shell history exports, logs, tickets, or evidence.

Required environment values:

```text
KAI_PASS2_DB_TARGET_CLASS=production
KAI_PASS2_PRODUCTION_SYNTHETIC_WRITE_GATE_ACCEPTED=true
KAI_PASS2_RUN_WRITE_PATH=true
KAI_PASS2_ORGANIZATION_ID=a5d17c5a-c55f-43af-9b21-fe63aafe733f
KAI_PASS2_ENGAGEMENT_ID=2e426ea1-2be3-4e48-b80f-9783ddbacda0
```

The verifier must stop before write-path execution if any required gate variable is absent, false, ambiguous, or unsupported.

Choose exactly one production write-path verifier command template.

Cookie-auth command template:

```bash
set +x
unset KAI_PASS2_BEARER_TOKEN

KAI_PASS2_BASE_URL="<production-base-url>" \
KAI_PASS2_AUTH_COOKIE="${KAI_PASS2_AUTH_COOKIE}" \
KAI_PASS2_DB_TARGET_CLASS=production \
KAI_PASS2_PRODUCTION_SYNTHETIC_WRITE_GATE_ACCEPTED=true \
KAI_PASS2_RUN_WRITE_PATH=true \
KAI_PASS2_ORGANIZATION_ID=a5d17c5a-c55f-43af-9b21-fe63aafe733f \
KAI_PASS2_ENGAGEMENT_ID=2e426ea1-2be3-4e48-b80f-9783ddbacda0 \
node scripts/kai-sprint2-pass2-admin-metadata-intake-api-verifier.js
```

Bearer-auth command template:

```bash
set +x
unset KAI_PASS2_AUTH_COOKIE

KAI_PASS2_BASE_URL="<production-base-url>" \
KAI_PASS2_BEARER_TOKEN="${KAI_PASS2_BEARER_TOKEN}" \
KAI_PASS2_DB_TARGET_CLASS=production \
KAI_PASS2_PRODUCTION_SYNTHETIC_WRITE_GATE_ACCEPTED=true \
KAI_PASS2_RUN_WRITE_PATH=true \
KAI_PASS2_ORGANIZATION_ID=a5d17c5a-c55f-43af-9b21-fe63aafe733f \
KAI_PASS2_ENGAGEMENT_ID=2e426ea1-2be3-4e48-b80f-9783ddbacda0 \
node scripts/kai-sprint2-pass2-admin-metadata-intake-api-verifier.js
```

The verifier may call only these allowed routes:

```text
GET /api/kai/sprint2/intake/status
GET /api/kai/sprint2/intake/admin/access-check
POST /api/kai/sprint2/intake/admin/batches
POST /api/kai/sprint2/intake/admin/batches/:intakeBatchId/file-reservations
```

Do not broaden the route allowlist.

The verifier must not call or enable raw upload, signed upload URL, signed read URL, parser, source promotion, evidence, claim, report/export, graph, assistant, tool, or connector behavior.

Negative auth/tenant checks may run only if already implemented in the accepted verifier as no-write or expected-blocker checks. Do not manually call extra invalid POST requests outside the accepted verifier.

Capture the verifier one-result-set PASS/FAIL output as evidence with env/auth values masked.

If the 10-minute feature-flag window is at risk of being exceeded, immediately set `KAI_SPRINT2_ENABLED=false` and confirm OFF before continuing any analysis.

## Step 12: Immediately Reset Feature Flag OFF

Immediately after verifier completion, verifier failure, interruption, or any stop condition while the flag is ON, set:

```text
KAI_SPRINT2_ENABLED=false
```

Record timestamp after disabling:

```text
feature_flag_disabled_at = <UTC timestamp>
```

Confirm the running app observes:

```text
KAI_SPRINT2_ENABLED=false
```

Run the post-reset OFF status check using exactly one auth method.

Cookie-auth command template:

```bash
set +x
unset KAI_PASS2_BEARER_TOKEN

KAI_PASS2_BASE_URL="<production-base-url>" \
KAI_PASS2_AUTH_COOKIE="${KAI_PASS2_AUTH_COOKIE}" \
KAI_PASS2_DB_TARGET_CLASS=production \
KAI_PASS2_PRODUCTION_SYNTHETIC_WRITE_GATE_ACCEPTED=true \
KAI_PASS2_RUN_WRITE_PATH=false \
KAI_PASS2_ORGANIZATION_ID=a5d17c5a-c55f-43af-9b21-fe63aafe733f \
KAI_PASS2_ENGAGEMENT_ID=2e426ea1-2be3-4e48-b80f-9783ddbacda0 \
node scripts/kai-sprint2-pass2-admin-metadata-intake-api-verifier.js
```

Bearer-auth command template:

```bash
set +x
unset KAI_PASS2_AUTH_COOKIE

KAI_PASS2_BASE_URL="<production-base-url>" \
KAI_PASS2_BEARER_TOKEN="${KAI_PASS2_BEARER_TOKEN}" \
KAI_PASS2_DB_TARGET_CLASS=production \
KAI_PASS2_PRODUCTION_SYNTHETIC_WRITE_GATE_ACCEPTED=true \
KAI_PASS2_RUN_WRITE_PATH=false \
KAI_PASS2_ORGANIZATION_ID=a5d17c5a-c55f-43af-9b21-fe63aafe733f \
KAI_PASS2_ENGAGEMENT_ID=2e426ea1-2be3-4e48-b80f-9783ddbacda0 \
node scripts/kai-sprint2-pass2-admin-metadata-intake-api-verifier.js
```

Expected post-reset evidence:

```text
API_FEATURE_OFF_STATUS_RETURNS_DISABLED = PASS
```

A successful API verifier run is not complete until `KAI_SPRINT2_ENABLED=false` is confirmed by the post-reset OFF status check.

This applies even if every API verifier `CHECK` row passes.

If the post-reset OFF check fails, the gate is not accepted and must be treated as a production feature-flag incident / rollback-to-off issue.

Stop and treat as a production feature-flag rollback-to-off issue if the feature flag cannot be reset OFF or the running app cannot be confirmed to observe OFF.

Do not analyze results, rerun commands, troubleshoot API behavior, or continue verification while the flag remains ON unless the action is required to turn the flag OFF.

Do not run code rollback unless a separate production incident process requires it.

## Step 13: pgAdmin Post-Write SQL Verification

Run this only after `KAI_SPRINT2_ENABLED=false` has been reset and confirmed.

Use pgAdmin Query Tool only.

Begin the pgAdmin Query Tool session with:

```sql
SET default_transaction_read_only = on;
```

Run the accepted read-only SQL verifier:

```sql
SET default_transaction_read_only = on;

WITH expected AS (
  SELECT
    'NCWS-P0-PASS2-METADATA-001'::text AS batch_code,
    'kai-p0-pass2-ncws-batch-001'::text AS batch_idempotency_key,
    'kai-p0-pass2-ncws-file-reservation-001'::text AS file_idempotency_key,
    'pass2_admin_metadata_intake_verification'::text AS p0_pass,
    'KAI_MVP_Sprint2_P0_Pass2_Production_Synthetic_Metadata_Write_Gate_Plan_v0.1.1'::text AS gate_plan,
    'a5d17c5a-c55f-43af-9b21-fe63aafe733f'::uuid AS organization_id,
    '2e426ea1-2be3-4e48-b80f-9783ddbacda0'::uuid AS engagement_id
),
pass2_batches AS (
  SELECT b.*
  FROM kai.intake_batches b
  JOIN expected e ON b.batch_code = e.batch_code
    OR b.idempotency_key = e.batch_idempotency_key
    OR b.batch_metadata->>'p0_pass' = e.p0_pass
    OR b.batch_metadata->>'gate_plan' = e.gate_plan
),
pass2_files AS (
  SELECT f.*
  FROM kai.intake_files f
  JOIN expected e ON f.file_metadata->>'p0_pass' = e.p0_pass
    OR f.file_metadata->>'gate_plan' = e.gate_plan
    OR f.file_metadata->>'idempotency_key' = e.file_idempotency_key
    OR f.file_metadata->>'reservation_idempotency_key' = e.file_idempotency_key
    OR f.file_metadata->>'file_reservation_idempotency_key' = e.file_idempotency_key
),
pass2_audit AS (
  SELECT a.*
  FROM kai.audit_events a
  JOIN expected e ON a.metadata->>'p0_pass' = e.p0_pass
    OR a.metadata->>'gate_plan' = e.gate_plan
)
SELECT 'CHECK' AS result_type,
       'PASS2_BATCH_EXISTS_ONCE' AS check_name,
       'kai.intake_batches' AS object_name,
       CASE WHEN (SELECT count(*) FROM pass2_batches) = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
       'Pass 2 batch rows matched by batch_code, idempotency_key, batch_metadata.p0_pass, or batch_metadata.gate_plan: ' || (SELECT count(*) FROM pass2_batches) AS detail
UNION ALL
SELECT 'CHECK',
       'PASS2_BATCH_ORG_ENGAGEMENT_MATCH',
       'kai.intake_batches',
       CASE WHEN EXISTS (
         SELECT 1 FROM pass2_batches b JOIN expected e ON b.organization_id = e.organization_id AND b.engagement_id = e.engagement_id
       ) THEN 'PASS' ELSE 'FAIL' END,
       'Batch organization_id and engagement_id match expected NCWS target.'
UNION ALL
SELECT 'CHECK',
       'PASS2_BATCH_METADATA_ONLY_FLAGS_CLOSED',
       'kai.intake_batches',
       CASE WHEN EXISTS (
         SELECT 1 FROM pass2_batches
         WHERE batch_metadata->>'p0_pass' = (SELECT p0_pass FROM expected)
           AND batch_metadata->>'synthetic_only' = 'true'
           AND batch_metadata->>'raw_upload_enabled' = 'false'
           AND batch_metadata->>'signed_url_enabled' = 'false'
           AND batch_metadata->>'parser_worker_enabled' = 'false'
           AND batch_metadata->>'source_promotion_enabled' = 'false'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'Batch metadata contains stable Pass 2 markers and closed raw/parser/source flags.'
UNION ALL
SELECT 'CHECK',
       'PASS2_BATCH_GATE_PLAN_MARKER_PRESENT',
       'kai.intake_batches',
       CASE WHEN EXISTS (
         SELECT 1 FROM pass2_batches
         WHERE batch_metadata->>'gate_plan' = (SELECT gate_plan FROM expected)
       ) THEN 'PASS' ELSE 'FAIL' END,
       'Batch metadata contains the exact reviewed gate_plan marker.'
UNION ALL
SELECT 'CHECK',
       'PASS2_FILE_RESERVATION_EXISTS_ONCE',
       'kai.intake_files',
       CASE WHEN (SELECT count(*) FROM pass2_files) = 1 THEN 'PASS' ELSE 'FAIL' END,
       'Pass 2 file reservation rows matched by file_metadata.p0_pass, file_metadata.gate_plan or documented equivalent reservation marker, or file reservation idempotency marker if implemented in file_metadata: ' || (SELECT count(*) FROM pass2_files)
UNION ALL
SELECT 'CHECK',
       'PASS2_FILE_RESERVATION_ORG_ENGAGEMENT_BATCH_MATCH',
       'kai.intake_files',
       CASE WHEN EXISTS (
         SELECT 1
         FROM pass2_files f
         JOIN pass2_batches b ON b.intake_batch_id = f.intake_batch_id
         JOIN expected e ON f.organization_id = e.organization_id AND f.engagement_id = e.engagement_id
       ) THEN 'PASS' ELSE 'FAIL' END,
       'File reservation belongs to expected organization, engagement, and Pass 2 batch.'
UNION ALL
SELECT 'CHECK',
       'PASS2_FILE_GATE_PLAN_MARKER_PRESENT',
       'kai.intake_files',
       CASE WHEN EXISTS (
         SELECT 1 FROM pass2_files
         WHERE file_metadata->>'gate_plan' = (SELECT gate_plan FROM expected)
            OR file_metadata->>'reservation_gate_plan' = (SELECT gate_plan FROM expected)
            OR file_metadata->>'file_reservation_gate_plan' = (SELECT gate_plan FROM expected)
       ) THEN 'PASS' ELSE 'FAIL' END,
       'File metadata contains the exact reviewed gate_plan marker or documented accepted equivalent reservation metadata marker.'
UNION ALL
SELECT 'CHECK',
       'PASS2_FILE_RESERVATION_RAW_FILE_RETAINED_FALSE',
       'kai.intake_files',
       CASE WHEN EXISTS (SELECT 1 FROM pass2_files WHERE raw_file_retained IS FALSE) THEN 'PASS' ELSE 'FAIL' END,
       'File reservation did not retain a raw file.'
UNION ALL
SELECT 'CHECK',
       'PASS2_FILE_RESERVATION_POLICY_STATUS_SKIPPED',
       'kai.intake_files',
       CASE WHEN EXISTS (SELECT 1 FROM pass2_files WHERE file_policy_status = 'skipped') THEN 'PASS' ELSE 'FAIL' END,
       'Synthetic/dev no-raw reservation uses file_policy_status=skipped.'
UNION ALL
SELECT 'CHECK',
       'PASS2_FILE_RESERVATION_MALWARE_STATUS_SKIPPED',
       'kai.intake_files',
       CASE WHEN EXISTS (SELECT 1 FROM pass2_files WHERE malware_scan_status = 'skipped') THEN 'PASS' ELSE 'FAIL' END,
       'Synthetic/dev no-raw reservation uses malware_scan_status=skipped.'
UNION ALL
SELECT 'CHECK',
       'PASS2_FILE_RESERVATION_NO_SIGNED_URL_METADATA',
       'kai.intake_files',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM pass2_files
         WHERE file_metadata ? 'signed_upload_url'
            OR file_metadata ? 'signed_read_url'
            OR file_metadata::text ILIKE '%X-Goog-Signature%'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'File metadata contains no signed upload/read URL.'
UNION ALL
SELECT 'CHECK',
       'PASS2_FILE_RESERVATION_CHECKSUM_SCOPE_METADATA_ONLY',
       'kai.intake_files',
       CASE WHEN EXISTS (
         SELECT 1 FROM pass2_files WHERE file_metadata->>'checksum_scope' = 'metadata_reservation_no_raw_file'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'Checksum scope is metadata_reservation_no_raw_file.'
UNION ALL
SELECT 'CHECK',
       'PASS2_NO_PARSER_RUN_CREATED',
       'kai.intake_parser_runs',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM kai.intake_parser_runs r JOIN pass2_files f ON f.intake_file_id = r.intake_file_id
       ) THEN 'PASS' ELSE 'FAIL' END,
       'No parser run exists for Pass 2 file reservation.'
UNION ALL
SELECT 'CHECK',
       'PASS2_NO_FILE_PROFILE_CREATED',
       'kai.intake_file_profiles',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM kai.intake_file_profiles p JOIN pass2_files f ON f.intake_file_id = p.intake_file_id
       ) THEN 'PASS' ELSE 'FAIL' END,
       'No file profile exists for Pass 2 file reservation.'
UNION ALL
SELECT 'CHECK',
       'PASS2_NO_SENSITIVITY_PROFILE_CREATED',
       'kai.intake_sensitivity_profiles',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM kai.intake_sensitivity_profiles p JOIN pass2_files f ON f.intake_file_id = p.intake_file_id
       ) THEN 'PASS' ELSE 'FAIL' END,
       'No sensitivity profile exists for Pass 2 file reservation.'
UNION ALL
SELECT 'CHECK',
       'PASS2_NO_SOURCE_CANDIDATE_CREATED',
       'kai.intake_source_candidates',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM kai.intake_source_candidates c JOIN pass2_files f ON f.intake_file_id = c.intake_file_id
       ) THEN 'PASS' ELSE 'FAIL' END,
       'No source candidate exists for Pass 2 file reservation.'
UNION ALL
SELECT 'CHECK',
       'PASS2_NO_PROMOTION_DECISION_CREATED',
       'kai.intake_promotion_decisions',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM kai.intake_promotion_decisions d JOIN pass2_files f ON f.intake_file_id = d.intake_file_id
       ) THEN 'PASS' ELSE 'FAIL' END,
       'No promotion decision exists for Pass 2 file reservation.'
UNION ALL
SELECT 'CHECK',
       'PASS2_AUDIT_OBJECT_TYPE_OTHER_FOR_INTAKE_BATCH_BLOCKER',
       'kai.audit_events',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM pass2_audit WHERE metadata->>'target_object_type' = 'intake_batch' AND object_type <> 'other'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'Intake batch blocked-attempt audit rows use object_type=other.'
UNION ALL
SELECT 'CHECK',
       'PASS2_AUDIT_OBJECT_TYPE_OTHER_FOR_INTAKE_FILE_BLOCKER',
       'kai.audit_events',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM pass2_audit WHERE metadata->>'target_object_type' = 'intake_file' AND object_type <> 'other'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'Intake file blocked-attempt audit rows use object_type=other.'
UNION ALL
SELECT 'CHECK',
       'PASS2_AUDIT_METADATA_TARGET_OBJECT_TYPE_PRESENT',
       'kai.audit_events',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM pass2_audit WHERE metadata->>'target_object_type' IS NULL
       ) THEN 'PASS' ELSE 'FAIL' END,
       'Pass 2 audit rows preserve real target type in metadata.target_object_type.'
UNION ALL
SELECT 'CHECK',
       'PASS2_AUDIT_METADATA_NO_RAW_OR_PROMPT_KEYS',
       'kai.audit_events',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM pass2_audit
         WHERE metadata ? 'raw_file_content'
            OR metadata ? 'raw_parsed_rows'
            OR metadata ? 'prompt_text'
            OR metadata ? 'signed_upload_url'
            OR metadata ? 'signed_read_url'
            OR metadata ? 'storage_credentials'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'Pass 2 audit metadata contains no raw, prompt, signed URL, or credential keys.'
UNION ALL
SELECT 'CHECK',
       'PASS2_FORBIDDEN_CORE_TABLE_TOUCH_MARKERS_ZERO',
       'kai.core_forbidden_objects',
       CASE WHEN
         NOT EXISTS (SELECT 1 FROM kai.sources s WHERE to_jsonb(s)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%' OR to_jsonb(s)::text LIKE '%' || (SELECT gate_plan FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.source_versions sv WHERE to_jsonb(sv)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%' OR to_jsonb(sv)::text LIKE '%' || (SELECT gate_plan FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.source_locators sl WHERE to_jsonb(sl)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%' OR to_jsonb(sl)::text LIKE '%' || (SELECT gate_plan FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.evidence_items ei WHERE to_jsonb(ei)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%' OR to_jsonb(ei)::text LIKE '%' || (SELECT gate_plan FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.claims c WHERE to_jsonb(c)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%' OR to_jsonb(c)::text LIKE '%' || (SELECT gate_plan FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.claim_evidence_links cel WHERE to_jsonb(cel)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%' OR to_jsonb(cel)::text LIKE '%' || (SELECT gate_plan FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.claim_requirement_links crl WHERE to_jsonb(crl)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%' OR to_jsonb(crl)::text LIKE '%' || (SELECT gate_plan FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.reports r WHERE to_jsonb(r)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%' OR to_jsonb(r)::text LIKE '%' || (SELECT gate_plan FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.report_sections rs WHERE to_jsonb(rs)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%' OR to_jsonb(rs)::text LIKE '%' || (SELECT gate_plan FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.report_section_claims rsc WHERE to_jsonb(rsc)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%' OR to_jsonb(rsc)::text LIKE '%' || (SELECT gate_plan FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.exports ex WHERE to_jsonb(ex)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%' OR to_jsonb(ex)::text LIKE '%' || (SELECT gate_plan FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.export_items xi WHERE to_jsonb(xi)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%' OR to_jsonb(xi)::text LIKE '%' || (SELECT gate_plan FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.graph_relationships gr WHERE to_jsonb(gr)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%' OR to_jsonb(gr)::text LIKE '%' || (SELECT gate_plan FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.prompt_runs pr WHERE to_jsonb(pr)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%' OR to_jsonb(pr)::text LIKE '%' || (SELECT gate_plan FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.model_outputs mo WHERE to_jsonb(mo)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%' OR to_jsonb(mo)::text LIKE '%' || (SELECT gate_plan FROM expected) || '%')
       THEN 'PASS' ELSE 'FAIL' END,
       'No Pass 2 p0_pass or gate_plan marker appears in forbidden source/evidence/claim/report/export/graph/prompt/model tables.'
UNION ALL
SELECT 'CHECK',
       'PASS2_RESULTS_SINGLE_RESULT_SET_SHAPE',
       'verifier',
       'PASS',
       'Verifier returns one result set with result_type, check_name, object_name, status, detail.';
```

Export the result set as CSV evidence.

Every `result_type='CHECK'` row must be `PASS`.

If any `CHECK` row fails:

```text
stop
do not delete rows
do not rollback
do not restore
do not reseed
do not retry with a new marker
do not create cleanup SQL
preserve all evidence
record partial-failure status
require a later reviewed plan for next action
```

## Step 14: Supplemental Forbidden-Table Marker Verification

Run this only after `KAI_SPRINT2_ENABLED=false` has been reset and confirmed.

Use pgAdmin Query Tool only.

Begin the pgAdmin Query Tool session with:

```sql
SET default_transaction_read_only = on;
```

The post-write read-only verification must check both markers:

```text
p0_pass
gate_plan
```

The marker scan must not rely on total production row counts.

Check the existing forbidden core families for both markers:

```text
kai.intake_parser_runs
kai.intake_file_profiles
kai.intake_sensitivity_profiles
kai.intake_source_candidates
kai.intake_promotion_decisions
kai.sources
kai.source_versions
kai.source_locators
kai.evidence_items
kai.claims
kai.claim_evidence_links
kai.claim_requirement_links
kai.reports
kai.report_sections
kai.report_section_claims
kai.exports
kai.export_items
kai.graph_relationships
kai.prompt_runs
kai.model_outputs
```

Also check these non-allowed Sprint 2/KAI tables if present in the current accepted DDL:

```text
kai.data_dictionaries
kai.data_dictionary_fields
kai.data_dictionary_mappings
kai.data_quality_findings
kai.review_queue_items
kai.review_decisions
kai.client_followup_items
kai.retention_jobs
```

Table-existence handling:

```text
- If a listed table exists, marker count must be zero.
- If a listed table does not exist and it is not part of the current accepted DDL, report INFO/OBSERVATION rather than failing the gate.
- Do not create missing tables.
- Do not change schema.
- Do not patch SQL during execution.
```

For relationship tables that do not carry metadata directly, use the safest available marker method:

```text
- direct to_jsonb marker scan where feasible; or
- join from exact Pass 2 synthetic identifiers if the relationship table references a marked object; or
- report an explicit OBSERVATION if no marker-bearing column or safe join path exists.
```

Do not use total row counts in mature production tables as proof of failure or success.

Supplemental pgAdmin read-only SQL pattern:

```sql
to_jsonb(x)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%'
OR to_jsonb(x)::text LIKE '%' || (SELECT gate_plan FROM expected) || '%'
```

Run this supplemental read-only SQL if it is not already covered by the accepted SQL verifier output:

```sql
SET default_transaction_read_only = on;

WITH expected AS (
  SELECT
    'pass2_admin_metadata_intake_verification'::text AS p0_pass,
    'KAI_MVP_Sprint2_P0_Pass2_Production_Synthetic_Metadata_Write_Gate_Plan_v0.1.1'::text AS gate_plan
),
listed_tables AS (
  SELECT *
  FROM (VALUES
    ('kai', 'intake_parser_runs', true),
    ('kai', 'intake_file_profiles', true),
    ('kai', 'intake_sensitivity_profiles', true),
    ('kai', 'intake_source_candidates', true),
    ('kai', 'intake_promotion_decisions', true),
    ('kai', 'sources', true),
    ('kai', 'source_versions', true),
    ('kai', 'source_locators', true),
    ('kai', 'evidence_items', true),
    ('kai', 'claims', true),
    ('kai', 'claim_evidence_links', true),
    ('kai', 'claim_requirement_links', true),
    ('kai', 'reports', true),
    ('kai', 'report_sections', true),
    ('kai', 'report_section_claims', true),
    ('kai', 'exports', true),
    ('kai', 'export_items', true),
    ('kai', 'graph_relationships', true),
    ('kai', 'prompt_runs', true),
    ('kai', 'model_outputs', true),
    ('kai', 'data_dictionaries', false),
    ('kai', 'data_dictionary_fields', false),
    ('kai', 'data_dictionary_mappings', false),
    ('kai', 'data_quality_findings', false),
    ('kai', 'review_queue_items', false),
    ('kai', 'review_decisions', false),
    ('kai', 'client_followup_items', false),
    ('kai', 'retention_jobs', false)
  ) AS t(table_schema, table_name, core_forbidden_family)
),
existing_tables AS (
  SELECT
    l.*,
    to_regclass(format('%I.%I', l.table_schema, l.table_name)) AS table_regclass
  FROM listed_tables l
),
marker_counts AS (
  SELECT
    e.table_schema,
    e.table_name,
    e.core_forbidden_family,
    e.table_regclass,
    CASE
      WHEN e.table_regclass IS NULL THEN NULL::bigint
      ELSE (
        xpath(
          '/row/c/text()',
          query_to_xml(
            format(
              'SELECT count(*) AS c FROM %I.%I x WHERE to_jsonb(x)::text LIKE %L OR to_jsonb(x)::text LIKE %L',
              e.table_schema,
              e.table_name,
              '%' || (SELECT p0_pass FROM expected) || '%',
              '%' || (SELECT gate_plan FROM expected) || '%'
            ),
            false,
            true,
            ''
          )
        )
      )[1]::text::bigint
    END AS marker_match_count
  FROM existing_tables e
)
SELECT
  CASE WHEN table_regclass IS NULL THEN 'OBSERVATION' ELSE 'CHECK' END AS result_type,
  'PASS2_SUPPLEMENTAL_FORBIDDEN_TABLE_MARKERS_ZERO' AS check_name,
  table_schema || '.' || table_name AS object_name,
  CASE
    WHEN table_regclass IS NULL THEN 'INFO'
    WHEN marker_match_count = 0 THEN 'PASS'
    ELSE 'FAIL'
  END AS status,
  CASE
    WHEN table_regclass IS NULL AND core_forbidden_family
      THEN 'Listed forbidden core table is absent in this production DDL; report observation only and do not create it.'
    WHEN table_regclass IS NULL
      THEN 'Listed non-allowed Sprint 2/KAI table is absent in this production DDL; report observation only and do not create it.'
    ELSE 'Rows containing reviewed p0_pass or gate_plan marker: ' || marker_match_count
  END AS detail
FROM marker_counts
ORDER BY object_name;
```

For every existing listed table, `marker_match_count` must be zero and status must be `PASS`.

For absent tables that are not part of the current accepted DDL, preserve the `OBSERVATION` / `INFO` row as evidence and do not fail the gate.

If a relationship table has no marker-bearing column and no safe join path, preserve an explicit `OBSERVATION` explaining that limitation. Do not use total row counts as proof of success or failure.

If supplemental forbidden-table verification returns INFO or OBSERVATION rows, preserve them in the evidence package and explicitly explain whether they are expected DDL absences or known marker-path limitations.

INFO and OBSERVATION rows cannot override any CHECK failure.

Any `result_type='CHECK'` row with status other than `PASS` fails the gate.

Do not patch SQL during execution to eliminate OBSERVATION/INFO rows.

## Step 15: Stop Conditions

Stop immediately if any condition occurs:

```text
pre-run git status check is missing
repo code, verifier script, tests, schema, migration, rollback, seed, restore, or cleanup files have uncommitted changes
pgAdmin production DB target is ambiguous
API production target is ambiguous
pre-write marker absence check fails
backup/restore-point status is unavailable and explicit operator acceptance is not recorded
feature flag OFF check fails
verifier capability check fails
verifier capability is missing or ambiguous
required verifier gate variable is absent, false, ambiguous, or unsupported
production synthetic-write gate acceptance is missing
auth method is ambiguous
auth/secret masking cannot be preserved
app cannot be confirmed to observe KAI_SPRINT2_ENABLED=true during the controlled window
maximum 10-minute feature-flag ON window is at risk of being exceeded
terminal, verifier, Render dashboard, network connection, browser session, or operator session is interrupted while KAI_SPRINT2_ENABLED=true
feature flag cannot be reset OFF
post-reset OFF status check fails
app cannot be confirmed to observe KAI_SPRINT2_ENABLED=false after reset
any result_type='CHECK' row fails
any forbidden payload appears
any forbidden table marker appears
any no-go behavior appears
any raw upload behavior appears
any signed URL behavior appears
any parser/source/evidence/claim/report/export/graph/assistant/tool/connector behavior appears
any unauthorized kai.* write appears
any real client data is used
any schema change, migration, rollback, restore, reseed, cleanup, or delete activity appears
```

Do not weaken existing stop conditions.

Do not convert any existing stop condition into a warning, INFO row, OBSERVATION row, or optional operator judgment.

Any existing stop condition in v0.1.2 must remain a stop condition in v0.1.3 unless the change makes it stricter.

A successful API verifier run is not complete until `KAI_SPRINT2_ENABLED=false` is confirmed by the post-reset OFF status check.

The only immediate corrective action inside this runbook is:

```text
set KAI_SPRINT2_ENABLED=false
confirm KAI_SPRINT2_ENABLED=false
preserve masked evidence
record partial-failure status
```

If the flag cannot be reset OFF, treat it as a production incident / feature-flag rollback-to-off issue.

Do not:

```text
delete
rollback
restore
reseed
run cleanup/delete SQL
invent new markers inside this runbook
run code rollback unless separately justified and reviewed
```

## Step 16: Final Evidence Package

The final evidence package must include:

```text
API verifier one-result-set PASS/FAIL output
pgAdmin pre-write marker absence output
pgAdmin post-write SQL verifier CSV
production feature-flag reset confirmation
post-reset OFF status check result
git commit hash
pre-run git status --short output or summarized clean-working-tree confirmation
deployment/version or "not available"
exact marker values used
operator confirmation that no real client data was used
operator confirmation that no raw upload occurred
operator confirmation that no signed URL/parser/source/evidence/claim/report/export/graph/assistant/tool/connector behavior occurred
masked environment/auth handling confirmation
INFO/OBSERVATION explanation, if present
partial-failure status, if applicable
pgAdmin production DB target confirmation with secrets masked
API production target confirmation with host only
maximum feature-flag ON window and responsible operator
feature-flag ON timestamp
feature-flag OFF timestamp
auth-method used, without exposing auth material
confirmation that exactly one auth method was used, or documented verifier precedence if both were present
backup/restore-point status, or explicit operator acceptance to proceed without it
supplemental forbidden-table marker check output, if separate from the accepted SQL verifier
post-reset OFF status check output
```

Evidence must not contain:

```text
auth cookies
bearer tokens
session values
DATABASE_URL
credentials
secrets
raw payload
raw file content
req.user
signed URL
storage credential
prompt text
assistant/model output
PII
```

## Final Operator Acceptance Statement

Complete this statement in the evidence package after the run:

Final acceptance is valid only if `KAI_SPRINT2_ENABLED=false` is confirmed by the post-reset OFF status check; otherwise the gate is not accepted even if every API verifier `CHECK` row passes.

```text
I confirm the production synthetic metadata-only write verification used only the accepted P0 Pass 2 marker values or reviewed hardcoded equivalents, used no real client data, performed no raw upload, produced no signed upload URL or signed read URL, triggered no parser/source/evidence/claim/report/export/graph/assistant/tool/connector behavior, preserved auth and env secrecy through masking, used the confirmed production Render Postgres and production app targets only, respected the maximum 10-minute KAI_SPRINT2_ENABLED=true window, reset KAI_SPRINT2_ENABLED=false after completion, failure, or interruption, confirmed KAI_SPRINT2_ENABLED=false by the post-reset OFF status check before accepting the API verifier run as complete, and preserved partial-failure status if applicable.
```
