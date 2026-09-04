import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const user = process.env.USER || "postgres";

const chain = Object.freeze([
  "scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql",
  "migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql",
  "migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql",
  "migrations/kai_sprint2_p1_parser_run_and_file_profile.sql",
  "migrations/kai_sprint2_p1_04_data_dictionary_and_quality.sql",
  "migrations/kai_sprint2_p1_05_intake_sensitivity_profile.sql",
  "migrations/kai_sprint2_p1_06_review_queue.sql",
  "migrations/kai_sprint2_p1_07_intake_source_candidate.sql",
  "migrations/kai_sprint2_p1_08_source_promotion.sql",
  "migrations/kai_sprint2_p2_01_evidence_lineage.sql",
  "migrations/kai_sprint2_p2_03_claim_proposal.sql",
  "migrations/kai_sprint2_p2_04_claim_gap_followup.sql",
  "migrations/kai_sprint2_p2_05_conflict_review_candidate.sql",
  "migrations/kai_sprint2_p2_09_human_review_internal_approval.sql",
  "migrations/kai_sprint2_p2_10_coverage_review_decision.sql",
  "migrations/kai_sprint2_p2_11_client_followup_completion.sql",
  "migrations/kai_sprint2_p3_01_generated_content_drafts.sql",
  "migrations/kai_sprint2_p3_04_generated_content_review_completion.sql",
  "migrations/kai_sprint2_p3_05_export_review_request.sql",
  "migrations/kai_sprint2_p3_09_export_review_start.sql",
  "migrations/kai_sprint2_p3_13_export_review_completion.sql",
  "migrations/kai_sprint2_p3_16_export_candidate_foundation.sql",
  "migrations/kai_sprint2_p3_17_human_authority_decision_ledger.sql",
  "migrations/kai_sprint2_p2_10_funder_coverage_authority.sql",
]);

function run(command, args, context, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: {
      ...process.env,
      DATABASE_URL: "postgres://127.0.0.1:9/kai_sentinel",
      DATABASE_URL_LOCAL: "",
      PGURL_LOCAL: "",
      RENDER_DATABASE_URL: "",
      PROD_DATABASE_URL: "",
      PGHOST: "127.0.0.1",
      PGPORT: context.port,
      PGDATABASE: context.dbName,
      PGUSER: user,
    },
  });
  if (options.expectFailure) return result;
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function psqlFile(context, path) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", context.dbName, "-f", path], context, { capture: true }).stdout;
}

function psqlCommand(context, sql) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", context.dbName, "-c", sql], context, { capture: true }).stdout;
}

function psqlScalar(context, sql) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-t", "-A", "-d", context.dbName, "-c", sql], context, { capture: true }).stdout.trim();
}

async function withPostgres(label, fn) {
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const workDir = mkdtempSync(join("/tmp", `kai-recon-${safeLabel}-`));
  const dataDir = join(workDir, "data");
  const socketDir = join(workDir, "socket");
  const logFile = join(workDir, "postgres.log");
  const port = String(62000 + Math.floor(Math.random() * 1000));
  const dbName = `kai_forward_recon_${safeLabel}`;
  const targetUrl = `postgresql://${user}@127.0.0.1:${port}/${dbName}`;
  const context = { workDir, dataDir, socketDir, logFile, port, dbName, targetUrl };
  let started = false;
  try {
    mkdirSync(socketDir, { recursive: true });
    run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"], context, { capture: true });
    try {
      run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "start"], context, { capture: true });
    } catch (error) {
      const log = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
      throw new Error(`${error.message}${log ? `\nPostgreSQL log:\n${log}` : ""}`);
    }
    started = true;
    run(createdb, ["-h", "127.0.0.1", "-p", port, dbName], context, { capture: true });
    await proveRunnerOwnedTarget(context);
    await fn(context);
    console.log(`${label}: PASS`);
  } finally {
    if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
    rmSync(workDir, { recursive: true, force: true });
    console.log(`${label}: ephemeral PostgreSQL workdir removed: ${workDir}`);
  }
}

async function proveRunnerOwnedTarget(context) {
  const client = new Client({ connectionString: context.targetUrl, ssl: false });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT current_database() AS database_name,
             inet_server_addr()::text AS server_addr,
             inet_server_port()::text AS server_port,
             current_setting('listen_addresses') AS listen_addresses
    `);
    const row = rows[0];
    if (row.database_name !== context.dbName) throw new Error("runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== context.port) throw new Error("runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("runner refused non-loopback listen_addresses");
  } finally {
    await client.end();
  }
}

function applyCanonicalChain(context) {
  for (const file of chain) psqlFile(context, file);
}

function applyChainThrough(context, lastFile) {
  for (const file of chain) {
    psqlFile(context, file);
    if (file === lastFile) return;
  }
  throw new Error(`migration chain target not found: ${lastFile}`);
}

function applyChainAfter(context, previousFile, lastFile) {
  const previousIndex = chain.indexOf(previousFile);
  const lastIndex = chain.indexOf(lastFile);

  if (previousIndex === -1) {
    throw new Error(`migration chain previous target not found: ${previousFile}`);
  }
  if (lastIndex === -1) {
    throw new Error(`migration chain target not found: ${lastFile}`);
  }
  if (lastIndex <= previousIndex) {
    throw new Error(
      `migration chain target ${lastFile} does not follow ${previousFile}`,
    );
  }

  for (let index = previousIndex + 1; index <= lastIndex; index += 1) {
    psqlFile(context, chain[index]);
  }
}

function applyGovernedIncomingAuditVocabulary(context) {
  psqlCommand(context, `
    DO $$
    DECLARE
      old_expr text;
      pre_ops text[];
      governed_ops text[];
    BEGIN
      SELECT pg_get_expr(c.conbin, c.conrelid)
        INTO old_expr
        FROM pg_constraint c
        JOIN pg_class r ON r.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = 'kai'
         AND r.relname = 'upload_lifecycle_audit'
         AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check';

      SELECT array_agg(DISTINCT m[1] ORDER BY m[1])
        INTO pre_ops
        FROM regexp_matches(old_expr, '''([^'']+)''', 'g') AS m;

      SELECT array_agg(op ORDER BY op)
        INTO governed_ops
        FROM (
          SELECT unnest(pre_ops) AS op
          UNION
          SELECT 'coverage_review_decision_accepted_internal_with_limitation'
        ) ops
       WHERE op NOT IN (
         'evidence_review_completed',
         'claim_review_completed_internal_approval',
         'client_followup_completed'
       );

      EXECUTE format(
        'ALTER TABLE kai.upload_lifecycle_audit ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_governed CHECK (operation = ANY (%L::text[])) NOT VALID',
        governed_ops
      );
      ALTER TABLE kai.upload_lifecycle_audit
        VALIDATE CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_governed;
      ALTER TABLE kai.upload_lifecycle_audit
        DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check;
      ALTER TABLE kai.upload_lifecycle_audit
        RENAME CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_governed
        TO upload_lifecycle_audit_gate_a_operation_check;
    END $$;
  `);
}

function captureProtectedObjects(context) {
  return psqlCommand(context, `
    SELECT jsonb_pretty(jsonb_object_agg(name, definition ORDER BY name))
      FROM (
        SELECT c.conname AS name, pg_get_expr(c.conbin, c.conrelid) AS definition
          FROM pg_constraint c
          JOIN pg_class r ON r.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = r.relnamespace
         WHERE n.nspname = 'kai'
           AND c.conname IN (
             'upload_lifecycle_audit_gate_a_operation_check',
             'review_queue_items_p2_04_client_followup_contract_check',
             'evidence_items_p2_01_support_strength_check',
             'claims_p2_03_claim_strength_check'
           )
        UNION ALL
        SELECT t.tgname, pg_get_triggerdef(t.oid)
          FROM pg_trigger t
          JOIN pg_class r ON r.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = r.relnamespace
         WHERE n.nspname = 'kai'
           AND r.relname = 'coverage_review_decisions'
           AND t.tgname = 'trg_p2_10_coverage_review_decisions_append_only'
      ) s;
  `);
}

function captureP210Objects(context) {
  return psqlCommand(context, `
    WITH p2_10_objects AS (
      SELECT 'table' AS kind,
             to_regclass('kai.coverage_review_decisions')::text AS name,
             to_regclass('kai.coverage_review_decisions') IS NOT NULL AS present,
             NULL::text AS definition
      UNION ALL
      SELECT 'trigger',
             t.tgname,
             t.tgenabled = 'O',
             pg_get_triggerdef(t.oid)
        FROM pg_trigger t
        JOIN pg_class r ON r.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = 'kai'
         AND r.relname = 'coverage_review_decisions'
         AND t.tgname = 'trg_p2_10_coverage_review_decisions_append_only'
      UNION ALL
      SELECT 'operation',
             'coverage_review_decision_accepted_internal_with_limitation',
             bool_or('coverage_review_decision_accepted_internal_with_limitation' = ANY (ops.operations)),
             NULL::text
        FROM (
          SELECT array_agg(DISTINCT op ORDER BY op) AS operations
            FROM (
              SELECT regexp_split_to_table(
                       CASE WHEN m[1] LIKE '{%' THEN trim(both '{}' from m[1]) ELSE m[1] END,
                       CASE WHEN m[1] LIKE '{%' THEN ',' ELSE E'\\x1f' END
                     ) AS op
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace,
                     regexp_matches(pg_get_expr(c.conbin, c.conrelid), '''([^'']+)''', 'g') AS m
               WHERE n.nspname = 'kai'
                 AND r.relname = 'upload_lifecycle_audit'
                 AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
            ) parsed_ops
        ) ops
    )
    SELECT jsonb_pretty(jsonb_agg(to_jsonb(p2_10_objects) ORDER BY kind, name)) AS snapshot
      FROM p2_10_objects;
  `);
}

function captureP301Objects(context) {
  return psqlScalar(context, `
    WITH p3_01_objects AS (
      SELECT 'table' AS kind, c.relname AS name, NULL::text AS definition
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'kai'
         AND c.relname IN ('generation_runs', 'generated_content_drafts', 'generated_content_blocks', 'generated_content_citations')
      UNION ALL
      SELECT 'constraint', conname, pg_get_expr(conbin, conrelid)
        FROM pg_constraint
       WHERE conname IN (
         'generation_runs_p3_01_identity_unique',
         'generated_content_drafts_p3_01_run_unique',
         'generated_content_blocks_p3_01_identity_unique',
         'generated_content_citations_p3_01_identity_unique',
         'upload_lifecycle_audit_p3_01_metadata_object_check'
       )
    )
    SELECT jsonb_agg(to_jsonb(p3_01_objects) ORDER BY kind, name)::text
      FROM p3_01_objects;
  `);
}

function captureAuditOperations(context) {
  const raw = psqlScalar(context, `
    WITH expr AS (
      SELECT pg_get_expr(c.conbin, c.conrelid) AS observed_definition
        FROM pg_constraint c
        JOIN pg_class r ON r.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = 'kai'
         AND r.relname = 'upload_lifecycle_audit'
         AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
    ),
    ops AS (
      SELECT DISTINCT regexp_split_to_table(
             CASE WHEN m[1] LIKE '{%' THEN trim(both '{}' from m[1]) ELSE m[1] END,
             CASE WHEN m[1] LIKE '{%' THEN ',' ELSE E'\\x1f' END
           ) AS op
        FROM expr, regexp_matches(observed_definition, '''([^'']+)''', 'g') AS m
    )
    SELECT jsonb_agg(op ORDER BY op)::text FROM ops WHERE op <> '';
  `);
  return JSON.parse(raw);
}

function arraysEqual(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function assertAuditOperationSet(context, expected, label) {
  const observed = captureAuditOperations(context);
  if (!arraysEqual(observed, expected)) {
    throw new Error(`${label}: audit operations mismatch\nexpected=${JSON.stringify([...expected].sort())}\nobserved=${JSON.stringify(observed)}`);
  }
}

function applyOperationSet(context, operations) {
  const values = [...operations].map((op) => `'${op.replaceAll("'", "''")}'`).join(",");
  psqlCommand(context, `
    ALTER TABLE kai.upload_lifecycle_audit
      ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_fixture
      CHECK (operation = ANY (ARRAY[${values}]::text[])) NOT VALID;
    ALTER TABLE kai.upload_lifecycle_audit
      VALIDATE CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_fixture;
    ALTER TABLE kai.upload_lifecycle_audit
      DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check;
    ALTER TABLE kai.upload_lifecycle_audit
      RENAME CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_fixture
      TO upload_lifecycle_audit_gate_a_operation_check;
  `);
}

function assertP210Snapshot(snapshot, label) {
  if (!snapshot.includes("kai.coverage_review_decisions")) {
    throw new Error(`${label}: kai.coverage_review_decisions is absent\n${snapshot}`);
  }
  if (!snapshot.includes("trg_p2_10_coverage_review_decisions_append_only")) {
    throw new Error(`${label}: P2-10 append-only trigger is absent\n${snapshot}`);
  }
  if (!snapshot.includes("coverage_review_decision_accepted_internal_with_limitation")) {
    throw new Error(`${label}: P2-10 audit operation is absent\n${snapshot}`);
  }
  if (!snapshot.includes('"kind": "table"') || !snapshot.includes('"present": true')) {
    throw new Error(`${label}: P2-10 table presence proof failed\n${snapshot}`);
  }
}

function runVerifier(context) {
  const output = psqlFile(context, "scripts/kai-sprint2-p2-09-p2-10-p2-11-forward-reconciliation-verifier.sql");
  if (/\|\s*FAIL\s*\|/.test(output)) throw new Error(`forward reconciliation verifier returned FAIL\n${output}`);
  return output;
}


const P211_SUMMARY =
  "Client clarification is required for an unresolved claim gap.";

const P211_REQUIRED_ACTIONS = Object.freeze([
  "Confirm the business meaning of the unresolved field or measure.",
  "Confirm the denominator and how it is calculated.",
  "Confirm the reporting period represented by this source.",
  "Confirm the entity level represented by the unresolved field or measure.",
]);

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function p211Predicate({
  pairs,
  actions = P211_REQUIRED_ACTIONS,
  summary = P211_SUMMARY,
  priority = "medium",
} = {}) {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    throw new Error("p211Predicate requires at least one lifecycle pair");
  }

  const pairSql = pairs
    .map(([queueStatus, reviewStatus]) =>
      `(queue_status = ${sqlLiteral(queueStatus)} AND review_status = ${sqlLiteral(reviewStatus)})`)
    .join("\n          OR ");

  const actionSql = actions.map(sqlLiteral).join(",\n          ");

  return `
    queue_type <> 'client_followup'
    OR (
      target_object_type = 'client_followup_item'
      AND priority = ${sqlLiteral(priority)}
      AND summary = ${sqlLiteral(summary)}
      AND assigned_to IS NULL
      AND due_at IS NULL
      AND required_action IN (
          ${actionSql}
      )
      AND (
          ${pairSql}
      )
    )
  `;
}

function replaceP211Constraint(context, predicate) {
  psqlCommand(context, `
    ALTER TABLE kai.review_queue_items
      DROP CONSTRAINT review_queue_items_p2_04_client_followup_contract_check;

    ALTER TABLE kai.review_queue_items
      ADD CONSTRAINT review_queue_items_p2_04_client_followup_contract_check
      CHECK (${predicate});
  `);
}

function convertPriorityToProductionEnum(context) {
  psqlCommand(context, `
    ALTER TABLE kai.review_queue_items
      DROP CONSTRAINT IF EXISTS review_queue_items_p1_06_priority_check;

    ALTER TABLE kai.review_queue_items
      ALTER COLUMN priority DROP DEFAULT;

    DO $$
    BEGIN
      IF to_regtype('kai.priority_enum') IS NULL THEN
        CREATE TYPE kai.priority_enum AS ENUM (
          'mandatory',
          'immediate_fix',
          'high',
          'medium',
          'low',
          'backlog',
          'not_applicable',
          'unknown'
        );
      END IF;
    END $$;

    ALTER TABLE kai.review_queue_items
      ALTER COLUMN priority
      TYPE kai.priority_enum
      USING priority::text::kai.priority_enum;

    ALTER TABLE kai.review_queue_items
      ALTER COLUMN priority
      SET DEFAULT 'medium'::kai.priority_enum;
  `);
}

function capturePriorityPhysicalShape(context) {
  const raw = psqlScalar(context, `
    SELECT jsonb_build_object(
      'type_schema', tyn.nspname,
      'type_name', ty.typname,
      'typtype', ty.typtype::text,
      'not_null', a.attnotnull,
      'default_expr', pg_get_expr(d.adbin, d.adrelid),
      'enum_labels', COALESCE(
        (
          SELECT jsonb_agg(e.enumlabel::text ORDER BY e.enumsortorder)
            FROM pg_enum e
           WHERE e.enumtypid = ty.oid
        ),
        '[]'::jsonb
      ),
      'priority_check_present',
        EXISTS (
          SELECT 1
            FROM pg_constraint c
           WHERE c.conrelid = r.oid
             AND c.conname = 'review_queue_items_p1_06_priority_check'
        ),
      'priority_check_validated',
        EXISTS (
          SELECT 1
            FROM pg_constraint c
           WHERE c.conrelid = r.oid
             AND c.conname = 'review_queue_items_p1_06_priority_check'
             AND c.convalidated
        )
    )::text
      FROM pg_attribute a
      JOIN pg_class r
        ON r.oid = a.attrelid
      JOIN pg_namespace rn
        ON rn.oid = r.relnamespace
      JOIN pg_type ty
        ON ty.oid = a.atttypid
      JOIN pg_namespace tyn
        ON tyn.oid = ty.typnamespace
      LEFT JOIN pg_attrdef d
        ON d.adrelid = a.attrelid
       AND d.adnum = a.attnum
     WHERE rn.nspname = 'kai'
       AND r.relname = 'review_queue_items'
       AND a.attname = 'priority'
       AND a.attnum > 0
       AND NOT a.attisdropped;
  `);

  return JSON.parse(raw);
}

function assertProductionCompatibleEnumPriorityShape(context, label) {
  const shape = capturePriorityPhysicalShape(context);
  const expectedLabels = [
    "mandatory",
    "immediate_fix",
    "high",
    "medium",
    "low",
    "backlog",
    "not_applicable",
    "unknown",
  ];

  if (shape.type_schema !== "kai") {
    throw new Error(`${label}: priority type schema is not kai\n${JSON.stringify(shape)}`);
  }
  if (shape.type_name !== "priority_enum") {
    throw new Error(`${label}: priority type is not priority_enum\n${JSON.stringify(shape)}`);
  }
  if (shape.typtype !== "e") {
    throw new Error(`${label}: priority type is not enum-backed\n${JSON.stringify(shape)}`);
  }
  if (shape.not_null !== true) {
    throw new Error(`${label}: priority is no longer NOT NULL\n${JSON.stringify(shape)}`);
  }
  if (shape.default_expr !== "'medium'::kai.priority_enum") {
    throw new Error(`${label}: priority default changed\n${JSON.stringify(shape)}`);
  }
  if (JSON.stringify(shape.enum_labels) !== JSON.stringify(expectedLabels)) {
    throw new Error(`${label}: priority enum labels changed\n${JSON.stringify(shape)}`);
  }

  return shape;
}

function captureP211Expression(context) {
  return psqlScalar(context, `
    SELECT pg_get_expr(c.conbin, c.conrelid)
      FROM pg_constraint c
      JOIN pg_class r
        ON r.oid = c.conrelid
      JOIN pg_namespace n
        ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'review_queue_items'
       AND c.conname = 'review_queue_items_p2_04_client_followup_contract_check';
  `);
}

function assertP211StoredContract(
  context,
  { enumPriority, resolved, label },
) {
  const expr = captureP211Expression(context);

  const expectedPriority = enumPriority
    ? "(priority = 'medium'::kai.priority_enum)"
    : "(priority = 'medium'::text)";

  if (!expr.includes(expectedPriority)) {
    throw new Error(`${label}: expected priority rendering is absent\n${expr}`);
  }

  if (!expr.includes("required_action = ANY (ARRAY[")) {
    throw new Error(`${label}: required_action was not deparsed as ANY(ARRAY[...])\n${expr}`);
  }

  const observedPairs = [
    ...expr.matchAll(
      /\(queue_status = '([^']+)'::text\) AND \(review_status = '([^']+)'::text\)/g,
    ),
  ]
    .map((match) => `${match[1]}/${match[2]}`)
    .sort();

  const expectedPairs = resolved
    ? ["resolved/resolved", "waiting_on_client/proposed"].sort()
    : ["waiting_on_client/proposed"];

  if (JSON.stringify(observedPairs) !== JSON.stringify(expectedPairs)) {
    throw new Error(
      `${label}: lifecycle tuple mismatch\nexpected=${JSON.stringify(expectedPairs)}\nobserved=${JSON.stringify(observedPairs)}\n${expr}`,
    );
  }

  return expr;
}

function assertP211VerifierFails(context, label) {
  const output = psqlFile(
    context,
    "scripts/kai-sprint2-p2-09-p2-10-p2-11-forward-reconciliation-verifier.sql",
  );

  if (
    !/p2_11_client_followup_contract_canonical\s*\|\s*FAIL\s*\|/.test(output)
  ) {
    throw new Error(
      `${label}: verifier did not fail the P2-11 semantic row\n${output}`,
    );
  }
}

function assertRollbackEnumState(context, label) {
  assertProductionCompatibleEnumPriorityShape(context, `${label} priority`);
  assertP211StoredContract(context, {
    enumPriority: true,
    resolved: false,
    label: `${label} P2-11`,
  });

  const proof = JSON.parse(psqlScalar(context, `
    SELECT jsonb_build_object(
      'evidence_stale',
        (
          SELECT pg_get_expr(c.conbin, c.conrelid)
            FROM pg_constraint c
           WHERE c.conrelid = 'kai.evidence_items'::regclass
             AND c.conname = 'evidence_items_p2_01_support_strength_check'
        ) = '(support_strength = ''unassessed''::text)',

      'claim_stale',
        (
          SELECT pg_get_expr(c.conbin, c.conrelid)
            FROM pg_constraint c
           WHERE c.conrelid = 'kai.claims'::regclass
             AND c.conname = 'claims_p2_03_claim_strength_check'
        ) = '(claim_strength = ''unassessed''::text)',

      'p2_09_metadata_absent',
        NOT EXISTS (
          SELECT 1
            FROM pg_constraint
           WHERE conname IN (
             'upload_lifecycle_audit_p2_09_evidence_review_metadata_object_check'::name,
             'upload_lifecycle_audit_p2_09_claim_review_metadata_object_check'::name
           )
        ),

      'p2_11_metadata_absent',
        NOT EXISTS (
          SELECT 1
            FROM pg_constraint
           WHERE conname =
             'upload_lifecycle_audit_p2_11_client_followup_completion_metadata_object_check'::name
        )
    )::text;
  `));

  for (const [key, value] of Object.entries(proof)) {
    if (value !== true) {
      throw new Error(`${label}: rollback proof failed: ${key}\n${JSON.stringify(proof)}`);
    }
  }

  const ops = captureAuditOperations(context);

  for (const removed of [
    "evidence_review_completed",
    "claim_review_completed_internal_approval",
    "client_followup_completed",
  ]) {
    if (ops.includes(removed)) {
      throw new Error(`${label}: rollback retained ${removed}`);
    }
  }

  for (const preserved of [
    "coverage_review_decision_accepted_internal_with_limitation",
    "generated_content_draft_created",
  ]) {
    if (!ops.includes(preserved)) {
      throw new Error(`${label}: rollback lost ${preserved}`);
    }
  }
}

function assertCanonicalConstraintComparisonRegression(context) {
  const proof = psqlScalar(context, `
    DROP TABLE IF EXISTS pg_temp.kai_recon_compare_probe;
    CREATE TEMP TABLE kai_recon_compare_probe (operation text, metadata jsonb);
    ALTER TABLE kai_recon_compare_probe ADD CONSTRAINT canonical CHECK (
      operation <> 'evidence_review_completed'
      OR (
        jsonb_typeof(metadata) = 'object'
        AND kai.gate_a_p0_jsonb_metadata_only(metadata)
        AND metadata ? 'metadata_only'
        AND metadata ? 'contract'
        AND metadata ? 'evidence_item_id'
        AND metadata ? 'review_queue_item_id'
        AND metadata ? 'previous_queue_status'
        AND metadata ? 'resulting_queue_status'
        AND metadata ? 'previous_review_status'
        AND metadata ? 'resulting_review_status'
        AND metadata ? 'previous_support_strength'
        AND metadata ? 'resulting_support_strength'
        AND metadata ? 'validator_key'
      )
    );
    ALTER TABLE kai_recon_compare_probe ADD CONSTRAINT broadened CHECK (
      operation <> 'evidence_review_completed'
      OR metadata ? 'validator_key'
      OR (
        jsonb_typeof(metadata) = 'object'
        AND kai.gate_a_p0_jsonb_metadata_only(metadata)
        AND metadata ? 'metadata_only'
        AND metadata ? 'contract'
        AND metadata ? 'evidence_item_id'
        AND metadata ? 'review_queue_item_id'
        AND metadata ? 'previous_queue_status'
        AND metadata ? 'resulting_queue_status'
        AND metadata ? 'previous_review_status'
        AND metadata ? 'resulting_review_status'
        AND metadata ? 'previous_support_strength'
        AND metadata ? 'resulting_support_strength'
        AND metadata ? 'validator_key'
      )
    );
    ALTER TABLE kai_recon_compare_probe ADD CONSTRAINT narrowed CHECK (
      operation <> 'evidence_review_completed'
      OR (
        jsonb_typeof(metadata) = 'object'
        AND kai.gate_a_p0_jsonb_metadata_only(metadata)
        AND metadata ? 'metadata_only'
        AND metadata ? 'contract'
        AND metadata ? 'evidence_item_id'
        AND metadata ? 'review_queue_item_id'
        AND metadata ? 'previous_queue_status'
        AND metadata ? 'resulting_queue_status'
        AND metadata ? 'previous_review_status'
        AND metadata ? 'resulting_review_status'
        AND metadata ? 'previous_support_strength'
        AND metadata ? 'resulting_support_strength'
        AND metadata ? 'validator_key'
        AND metadata ? 'extra_required_key'
      )
    );
    WITH actual AS (
      SELECT c.conname, pg_get_expr(c.conbin, c.conrelid) AS expr
        FROM pg_constraint c
        JOIN pg_class r ON r.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = 'kai'
         AND r.relname = 'upload_lifecycle_audit'
         AND c.conname = 'upload_lifecycle_audit_p2_09_evidence_review_metadata_object_check'::name
    ),
    refs AS (
      SELECT c.conname, pg_get_expr(c.conbin, c.conrelid) AS expr
        FROM pg_constraint c
        JOIN pg_class r ON r.oid = c.conrelid
       WHERE r.relname = 'kai_recon_compare_probe'
         AND c.conname IN ('canonical'::name, 'broadened'::name, 'narrowed'::name)
    )
    SELECT jsonb_build_object(
      'stored_name', (SELECT conname FROM actual),
      'name_cast_lookup', EXISTS (SELECT 1 FROM actual),
      'text_lookup', EXISTS (
        SELECT 1
          FROM pg_constraint c
          JOIN pg_class r ON r.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = r.relnamespace
         WHERE n.nspname = 'kai'
           AND r.relname = 'upload_lifecycle_audit'
           AND c.conname::text = 'upload_lifecycle_audit_p2_09_evidence_review_metadata_object_check'
      ),
      'duplicate_count', (SELECT count(*) FROM actual),
      'canonical_equal', (SELECT expr FROM actual) = (SELECT expr FROM refs WHERE conname = 'canonical'::name),
      'broadened_rejected', (SELECT expr FROM actual) <> (SELECT expr FROM refs WHERE conname = 'broadened'::name),
      'narrowed_rejected', (SELECT expr FROM actual) <> (SELECT expr FROM refs WHERE conname = 'narrowed'::name)
    )::text;
  `);
  const parsed = JSON.parse(proof.split("\n").find((line) => line.trim().startsWith("{")).trim());
  if (parsed.stored_name !== "upload_lifecycle_audit_p2_09_evidence_review_metadata_object_ch") {
    throw new Error(`canonical comparison regression: unexpected stored truncated name\n${proof}`);
  }
  if (parsed.name_cast_lookup !== true) {
    throw new Error(`canonical comparison regression: long source name did not resolve with PostgreSQL name semantics\n${proof}`);
  }
  if (parsed.text_lookup !== false) {
    throw new Error(`canonical comparison regression: text lookup unexpectedly matched truncated name\n${proof}`);
  }
  if (parsed.duplicate_count !== 1) {
    throw new Error(`canonical comparison regression: duplicate logical constraint detected\n${proof}`);
  }
  if (parsed.canonical_equal !== true) {
    throw new Error(`canonical comparison regression: PostgreSQL-parsed canonical predicate did not match actual\n${proof}`);
  }
  if (parsed.broadened_rejected !== true || parsed.narrowed_rejected !== true) {
    throw new Error(`canonical comparison regression: fail-closed predicate rejection failed\n${proof}`);
  }
}

function simulateProductionDrift(context) {
  psqlCommand(context, `
    ALTER TABLE kai.evidence_items
      DROP CONSTRAINT evidence_items_p2_01_support_strength_check,
      ADD CONSTRAINT evidence_items_p2_01_support_strength_check CHECK (support_strength = 'unassessed');
    ALTER TABLE kai.claims
      DROP CONSTRAINT claims_p2_03_claim_strength_check,
      ADD CONSTRAINT claims_p2_03_claim_strength_check CHECK (claim_strength = 'unassessed');
    ALTER TABLE kai.upload_lifecycle_audit
      DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p2_09_evidence_review_metadata_object_check,
      DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p2_09_claim_review_metadata_object_check,
      DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p2_11_client_followup_completion_metadata_object_check;
    ALTER TABLE kai.review_queue_items
      DROP CONSTRAINT review_queue_items_p2_04_client_followup_contract_check,
      ADD CONSTRAINT review_queue_items_p2_04_client_followup_contract_check
      CHECK (
        queue_type <> 'client_followup'
        OR (
          target_object_type = 'client_followup_item'
          AND queue_status = 'waiting_on_client'
          AND review_status = 'proposed'
          AND priority = 'medium'
          AND summary = 'Client clarification is required for an unresolved claim gap.'
          AND assigned_to IS NULL
          AND due_at IS NULL
          AND required_action IN (
            'Confirm the business meaning of the unresolved field or measure.',
            'Confirm the denominator and how it is calculated.',
            'Confirm the reporting period represented by this source.',
            'Confirm the entity level represented by the unresolved field or measure.'
          )
        )
      );
  `);
}

function simulateVerifiedProductionTopology(context) {
  simulateProductionDrift(context);
  const currentOps = captureAuditOperations(context);
  const governedOps = new Set(currentOps);
  governedOps.add("evidence_review_completed");
  governedOps.add("claim_review_completed_internal_approval");
  governedOps.add("coverage_review_decision_accepted_internal_with_limitation");
  governedOps.delete("client_followup_completed");
  governedOps.delete("generated_content_draft_created");
  governedOps.delete("generated_content_review_completed");
  governedOps.delete("export_review_requested");
  governedOps.delete("export_review_started");
  governedOps.delete("export_review_completed");
  governedOps.delete("limitation_snapshot_confirmed");
  governedOps.delete("export_candidate_created");
  applyOperationSet(context, governedOps);
}

function assertVerifiedProductionPreState(context) {
  const ops = captureAuditOperations(context);
  for (const op of [
    "evidence_review_completed",
    "claim_review_completed_internal_approval",
    "coverage_review_decision_accepted_internal_with_limitation",
  ]) {
    if (!ops.includes(op)) throw new Error(`production-topology pre-state missing required preserved operation: ${op}`);
  }
  for (const op of [
    "client_followup_completed",
    "generated_content_draft_created",
    "generated_content_review_completed",
    "export_review_requested",
    "export_review_started",
    "export_review_completed",
    "limitation_snapshot_confirmed",
    "export_candidate_created",
  ]) {
    if (ops.includes(op)) throw new Error(`production-topology pre-state unexpectedly accepts operation: ${op}`);
  }
  const proof = psqlScalar(context, `
    SELECT jsonb_build_object(
      'p2_09_evidence_stale', pg_get_expr(c1.conbin, c1.conrelid) = '(support_strength = ''unassessed''::text)',
      'p2_09_claim_stale', pg_get_expr(c2.conbin, c2.conrelid) = '(claim_strength = ''unassessed''::text)',
      'p2_09_metadata_absent', NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN ('upload_lifecycle_audit_p2_09_evidence_review_metadata_object_check'::name, 'upload_lifecycle_audit_p2_09_claim_review_metadata_object_check'::name)),
      'p2_11_metadata_absent', NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'upload_lifecycle_audit_p2_11_client_followup_completion_metadata_object_check'::name),
      'p3_01_metadata_present', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'upload_lifecycle_audit_p3_01_metadata_object_check' AND convalidated),
      'later_p3_metadata_absent', NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN ('upload_lifecycle_audit_p3_04_metadata_object_check', 'upload_lifecycle_audit_p3_05_metadata_object_check', 'upload_lifecycle_audit_p3_09_metadata_object_check', 'upload_lifecycle_audit_p3_13_metadata_object_check', 'upload_lifecycle_audit_p3_16_export_candidate_metadata_check', 'upload_lifecycle_audit_p3_16_limitation_snapshot_metadata_check')),
      'later_p3_tables_absent', to_regclass('kai.export_candidates') IS NULL AND to_regclass('kai.limitation_snapshots') IS NULL AND to_regclass('kai.limitation_snapshot_entries') IS NULL
    )::text
      FROM pg_constraint c1, pg_constraint c2
     WHERE c1.conname = 'evidence_items_p2_01_support_strength_check'
       AND c2.conname = 'claims_p2_03_claim_strength_check';
  `);
  const parsed = JSON.parse(proof);
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== true) throw new Error(`production-topology pre-state proof failed: ${key}\n${proof}`);
  }
}

await withPostgres("Scenario A", async (context) => {
  applyCanonicalChain(context);
  applyGovernedIncomingAuditVocabulary(context);
  const before = captureProtectedObjects(context);
  const p210Before = captureP210Objects(context);
  assertP210Snapshot(p210Before, "Scenario A before reconciliation");
  psqlFile(context, "migrations/kai_sprint2_p2_09_p2_10_p2_11_forward_reconciliation.sql");
  runVerifier(context);
  assertCanonicalConstraintComparisonRegression(context);
  const after = captureProtectedObjects(context);
  const p210After = captureP210Objects(context);
  assertP210Snapshot(p210After, "Scenario A after reconciliation");
  if (p210Before !== p210After) {
    throw new Error("Scenario A mutated P2-10 protected objects");
  }
  if (!before.includes("export_candidate_created") || !after.includes("export_candidate_created")) {
    throw new Error("Scenario A did not preserve later P3 audit operation evidence");
  }
});

await withPostgres("Scenario B", async (context) => {
  applyCanonicalChain(context);
  applyGovernedIncomingAuditVocabulary(context);
  const p210Before = captureP210Objects(context);
  assertP210Snapshot(p210Before, "Scenario B before drift");
  simulateProductionDrift(context);
  const p210AfterDrift = captureP210Objects(context);
  if (p210Before !== p210AfterDrift) {
    throw new Error("Scenario B drift mutated P2-10 protected objects");
  }
  psqlFile(context, "migrations/kai_sprint2_p2_09_p2_10_p2_11_forward_reconciliation.sql");
  runVerifier(context);
  const p210After = captureP210Objects(context);
  assertP210Snapshot(p210After, "Scenario B after reconciliation");
  if (p210Before !== p210After) {
    throw new Error("Scenario B reconciliation mutated P2-10 protected objects");
  }
});

await withPostgres("Verified production topology", async (context) => {
  applyChainThrough(
    context,
    "migrations/kai_sprint2_p1_06_review_queue.sql",
  );

  convertPriorityToProductionEnum(context);

  applyChainAfter(
    context,
    "migrations/kai_sprint2_p1_06_review_queue.sql",
    "migrations/kai_sprint2_p3_01_generated_content_drafts.sql",
  );

  simulateVerifiedProductionTopology(context);
  assertVerifiedProductionPreState(context);

  const priorityBefore = assertProductionCompatibleEnumPriorityShape(
    context,
    "Verified production topology before reconciliation",
  );

  assertP211StoredContract(context, {
    enumPriority: true,
    resolved: false,
    label: "Verified production topology pre-state",
  });
  const preOps = captureAuditOperations(context);
  const p210Before = captureP210Objects(context);
  const p301Before = captureP301Objects(context);
  assertP210Snapshot(p210Before, "Verified production topology before reconciliation");
  if (!p301Before.includes("upload_lifecycle_audit_p3_01_metadata_object_check")) {
    throw new Error("Verified production topology missing P3-01 metadata fingerprint");
  }
  psqlFile(context, "migrations/kai_sprint2_p2_09_p2_10_p2_11_forward_reconciliation.sql");
  psqlFile(context, "migrations/kai_sprint2_p2_10_funder_coverage_authority.sql");
  runVerifier(context);

  const priorityAfter = assertProductionCompatibleEnumPriorityShape(
    context,
    "Verified production topology after reconciliation",
  );

  if (JSON.stringify(priorityBefore) !== JSON.stringify(priorityAfter)) {
    throw new Error(
      `Verified production topology reconciliation mutated priority physical shape\nbefore=${JSON.stringify(priorityBefore)}\nafter=${JSON.stringify(priorityAfter)}`,
    );
  }

  assertP211StoredContract(context, {
    enumPriority: true,
    resolved: true,
    label: "Verified production topology post-state",
  });

  const requiredAdditions = new Set([
    "client_followup_completed",
    "generated_content_draft_created",
    "coverage_review_decision_accepted_funder_with_limitation",
  ]);
  assertAuditOperationSet(context, new Set([...preOps, ...requiredAdditions]), "Verified production topology post-state");
  const p210After = captureP210Objects(context);
  const p301After = captureP301Objects(context);
  if (p210Before !== p210After) throw new Error("Verified production topology mutated P2-10 protected objects");
  if (p301Before !== p301After) throw new Error("Verified production topology mutated P3-01 protected objects");
  for (const op of ["generated_content_review_completed", "export_review_requested", "export_review_started", "export_review_completed", "limitation_snapshot_confirmed", "export_candidate_created"]) {
    if (captureAuditOperations(context).includes(op)) throw new Error(`Verified production topology manufactured absent later-P3 operation: ${op}`);
  }
  const beforeSecond =
    captureProtectedObjects(context)
    + captureP210Objects(context)
    + captureP301Objects(context)
    + JSON.stringify(captureAuditOperations(context))
    + JSON.stringify(capturePriorityPhysicalShape(context));
  psqlFile(context, "migrations/kai_sprint2_p2_09_p2_10_p2_11_forward_reconciliation.sql");
  runVerifier(context);
  const afterSecond =
    captureProtectedObjects(context)
    + captureP210Objects(context)
    + captureP301Objects(context)
    + JSON.stringify(captureAuditOperations(context))
    + JSON.stringify(capturePriorityPhysicalShape(context));
  if (beforeSecond !== afterSecond) throw new Error("Verified production topology second run changed catalog fingerprints");
});


await withPostgres("P2-11 verifier semantic corruption", async (context) => {
  applyChainThrough(
    context,
    "migrations/kai_sprint2_p2_11_client_followup_completion.sql",
  );
  psqlFile(context, "migrations/kai_sprint2_p2_10_funder_coverage_authority.sql");

  runVerifier(context);

  const canonicalPairs = [
    ["waiting_on_client", "proposed"],
    ["resolved", "resolved"],
  ];

  const corruptionCases = [
    {
      label: "crossed lifecycle pairings",
      predicate: p211Predicate({
        pairs: [
          ["waiting_on_client", "resolved"],
          ["resolved", "proposed"],
        ],
      }),
    },
    {
      label: "third lifecycle branch",
      predicate: p211Predicate({
        pairs: [
          ...canonicalPairs,
          ["waiting_on_gk", "proposed"],
        ],
      }),
    },
    {
      label: "missing required_action",
      predicate: p211Predicate({
        pairs: canonicalPairs,
        actions: P211_REQUIRED_ACTIONS.slice(0, 3),
      }),
    },
    {
      label: "extra required_action",
      predicate: p211Predicate({
        pairs: canonicalPairs,
        actions: [
          ...P211_REQUIRED_ACTIONS,
          "Confirm an extra unsupported field.",
        ],
      }),
    },
    {
      label: "changed summary",
      predicate: p211Predicate({
        pairs: canonicalPairs,
        summary: "Client clarification is required.",
      }),
    },
    {
      label: "changed priority",
      predicate: p211Predicate({
        pairs: canonicalPairs,
        priority: "high",
      }),
    },
  ];

  for (const corruption of corruptionCases) {
    replaceP211Constraint(context, corruption.predicate);
    assertP211VerifierFails(context, corruption.label);
  }

  replaceP211Constraint(
    context,
    p211Predicate({ pairs: canonicalPairs }),
  );

  runVerifier(context);
});

await withPostgres("Production enum rollback", async (context) => {
  applyChainThrough(
    context,
    "migrations/kai_sprint2_p1_06_review_queue.sql",
  );

  convertPriorityToProductionEnum(context);

  applyChainAfter(
    context,
    "migrations/kai_sprint2_p1_06_review_queue.sql",
    "migrations/kai_sprint2_p3_01_generated_content_drafts.sql",
  );

  simulateVerifiedProductionTopology(context);

  assertProductionCompatibleEnumPriorityShape(
    context,
    "Production enum rollback pre-forward",
  );

  assertP211StoredContract(context, {
    enumPriority: true,
    resolved: false,
    label: "Production enum rollback pre-forward",
  });

  psqlFile(
    context,
    "migrations/kai_sprint2_p2_09_p2_10_p2_11_forward_reconciliation.sql",
  );
  psqlFile(context, "migrations/kai_sprint2_p2_10_funder_coverage_authority.sql");

  runVerifier(context);

  const priorityBeforeRollback =
    capturePriorityPhysicalShape(context);

  psqlFile(
    context,
    "migrations/kai_sprint2_p2_09_p2_10_p2_11_forward_reconciliation.rollback.sql",
  );

  const priorityAfterRollback =
    capturePriorityPhysicalShape(context);

  if (
    JSON.stringify(priorityBeforeRollback)
    !== JSON.stringify(priorityAfterRollback)
  ) {
    throw new Error(
      `Production enum rollback mutated priority physical shape\nbefore=${JSON.stringify(priorityBeforeRollback)}\nafter=${JSON.stringify(priorityAfterRollback)}`,
    );
  }

  assertRollbackEnumState(
    context,
    "Production enum rollback post-state",
  );
});

await withPostgres("Unsupported production priority shape", async (context) => {
  applyChainThrough(
    context,
    "migrations/kai_sprint2_p1_06_review_queue.sql",
  );

  convertPriorityToProductionEnum(context);

  applyChainAfter(
    context,
    "migrations/kai_sprint2_p1_06_review_queue.sql",
    "migrations/kai_sprint2_p3_01_generated_content_drafts.sql",
  );

  simulateVerifiedProductionTopology(context);

  psqlCommand(context, `
    ALTER TABLE kai.review_queue_items
      ALTER COLUMN priority
      SET DEFAULT 'high'::kai.priority_enum;
  `);

  const before =
    captureProtectedObjects(context)
    + captureP210Objects(context)
    + captureP301Objects(context)
    + JSON.stringify(captureAuditOperations(context))
    + JSON.stringify(capturePriorityPhysicalShape(context));

  const result = run(
    psql,
    [
      "-v",
      "ON_ERROR_STOP=1",
      "-d",
      context.dbName,
      "-f",
      "migrations/kai_sprint2_p2_09_p2_10_p2_11_forward_reconciliation.sql",
    ],
    context,
    {
      capture: true,
      expectFailure: true,
    },
  );

  if (result.status === 0) {
    throw new Error(
      "Unsupported production priority shape unexpectedly succeeded",
    );
  }

  const detail = [result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n");

  if (!detail.includes(
    "kai.review_queue_items.priority has unsupported physical contract",
  )) {
    throw new Error(
      `Unsupported priority shape failed for the wrong reason\n${detail}`,
    );
  }

  const after =
    captureProtectedObjects(context)
    + captureP210Objects(context)
    + captureP301Objects(context)
    + JSON.stringify(captureAuditOperations(context))
    + JSON.stringify(capturePriorityPhysicalShape(context));

  if (before !== after) {
    throw new Error(
      "Unsupported production priority shape changed reconciliation state before failing closed",
    );
  }
});

await withPostgres("Contradictory P3 markers", async (context) => {
  applyChainThrough(context, "migrations/kai_sprint2_p2_11_client_followup_completion.sql");
  const preOps = captureAuditOperations(context);
  psqlCommand(context, `
    ALTER TABLE kai.upload_lifecycle_audit
      ADD CONSTRAINT upload_lifecycle_audit_p3_01_metadata_object_check
      CHECK (operation <> 'generated_content_draft_created' OR jsonb_typeof(metadata) = 'object') NOT VALID;
    ALTER TABLE kai.upload_lifecycle_audit
      VALIDATE CONSTRAINT upload_lifecycle_audit_p3_01_metadata_object_check;
  `);
  const result = run(psql, ["-v", "ON_ERROR_STOP=1", "-d", context.dbName, "-f", "migrations/kai_sprint2_p2_09_p2_10_p2_11_forward_reconciliation.sql"], context, { capture: true, expectFailure: true });
  if (result.status === 0) throw new Error("Contradictory P3 markers scenario unexpectedly succeeded");
  assertAuditOperationSet(context, new Set(preOps), "Contradictory P3 markers preserved shared audit vocabulary");
});

console.log("P2-09 repaired: PASS");
console.log("P2-11 repaired: PASS");
console.log("P2-10 unchanged: PASS");
console.log("later audit vocabulary preserved: PASS");
console.log("P2-09/P2-11 forward reconciliation local PostgreSQL proof passed.");
