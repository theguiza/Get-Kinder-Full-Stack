import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { validateEvidenceHasSourceLineage } from "../Backend/kai/validators/kaiEvidenceLineageValidators.js";
import { extractEvidenceFromSourceVersion } from "../Backend/kai/services/kaiEvidenceLineageService.js";
import {
  createPostgresEvidenceLineageRepository,
  __evidenceLineageRepositoryContract,
  __evidenceLineageRepositoryTestables,
} from "../Backend/kai/dictionary/postgresEvidenceLineageRepository.js";

const SERVICE_PATH = "Backend/kai/services/kaiEvidenceLineageService.js";
const REPOSITORY_PATH = "Backend/kai/dictionary/postgresEvidenceLineageRepository.js";

const serviceSource = readFileSync(new URL(`../${SERVICE_PATH}`, import.meta.url), "utf8");
const repositorySource = readFileSync(new URL(`../${REPOSITORY_PATH}`, import.meta.url), "utf8");

const ORG = "00000000-0000-4000-8000-000000000001";
const SOURCE_VERSION = "70000000-0000-4000-8000-000000000001";
const SOURCE = "71000000-0000-4000-8000-000000000001";
const CANDIDATE = "90000000-0000-4000-8000-000000000001";
const SENSITIVITY = "80000000-0000-4000-8000-000000000001";
const FILE_PROFILE = "50000000-0000-4000-8000-000000000001";
const DATA_DICTIONARY = "60000000-0000-4000-8000-000000000001";
const INTAKE_FILE = "20000000-0000-4000-8000-000000000001";
const SHA = "a".repeat(64);
const NOW = "2026-08-05T10:00:00.000Z";

function validRows(overrides = {}) {
  return {
    sourceVersionRow: {
      source_version_id: SOURCE_VERSION,
      organization_id: ORG,
      source_id: SOURCE,
      intake_source_candidate_id: CANDIDATE,
      intake_sensitivity_profile_id: SENSITIVITY,
      profile_canonical_sha256: SHA,
      is_current: true,
      ...overrides.sourceVersionRow,
    },
    sourceRow: {
      source_id: SOURCE,
      organization_id: ORG,
      ...overrides.sourceRow,
    },
    candidateRow: {
      intake_source_candidate_id: CANDIDATE,
      organization_id: ORG,
      intake_file_id: INTAKE_FILE,
      file_profile_id: FILE_PROFILE,
      data_dictionary_id: DATA_DICTIONARY,
      intake_sensitivity_profile_id: SENSITIVITY,
      profile_canonical_sha256: SHA,
      candidate_status: "promoted",
      ...overrides.candidateRow,
    },
    decisionRow: {
      organization_id: ORG,
      source_id: SOURCE,
      source_version_id: SOURCE_VERSION,
      decision_status: "promoted",
      ...overrides.decisionRow,
    },
    profileRow: {
      organization_id: ORG,
      intake_sensitivity_profile_id: SENSITIVITY,
      file_profile_id: FILE_PROFILE,
      data_dictionary_id: DATA_DICTIONARY,
      profile_canonical_sha256: SHA,
      human_review_required: true,
      public_use_allowed: false,
      funder_use_allowed: false,
      llm_processing_allowed: false,
      product_learning_allowed: false,
      retention_posture: "restricted_pending_review",
      ...overrides.profileRow,
    },
    dictionaryRow: {
      data_dictionary_id: DATA_DICTIONARY,
      organization_id: ORG,
      file_profile_id: FILE_PROFILE,
      profile_canonical_sha256: SHA,
      ...overrides.dictionaryRow,
    },
  };
}

test("validateEvidenceHasSourceLineage: all-pass on a fully consistent, promoted, permission-satisfying lineage", () => {
  const result = validateEvidenceHasSourceLineage(validRows());
  assert.deepEqual(result, { ok: true });
});

test("validateEvidenceHasSourceLineage check 1: any missing row returns not_found", () => {
  for (const key of ["sourceVersionRow", "sourceRow", "candidateRow", "decisionRow", "profileRow", "dictionaryRow"]) {
    const rows = validRows();
    rows[key] = null;
    const result = validateEvidenceHasSourceLineage(rows);
    assert.equal(result.ok, false, key);
    assert.equal(result.code, "not_found", key);
  }
  assert.deepEqual(validateEvidenceHasSourceLineage(undefined), { ok: false, code: "not_found" });
});

test("validateEvidenceHasSourceLineage check 2: a non-current source_version returns conflict_current_state_changed", () => {
  const result = validateEvidenceHasSourceLineage(validRows({ sourceVersionRow: { is_current: false } }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "conflict_current_state_changed");
});

test("validateEvidenceHasSourceLineage check 3: source_version bound to a different source_id returns conflict_current_state_changed", () => {
  const result = validateEvidenceHasSourceLineage(validRows({ sourceVersionRow: { source_id: "99999999-0000-4000-8000-000000000099" } }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "conflict_current_state_changed");
});

test("validateEvidenceHasSourceLineage check 4: a non-promoted candidate returns validation_blocker", () => {
  for (const candidateStatus of ["needs_gk_review", "rejected"]) {
    const result = validateEvidenceHasSourceLineage(validRows({ candidateRow: { candidate_status: candidateStatus } }));
    assert.equal(result.ok, false, candidateStatus);
    assert.equal(result.code, "validation_blocker", candidateStatus);
  }
});

test("validateEvidenceHasSourceLineage check 5: a non-promoted decision returns validation_blocker", () => {
  for (const decisionStatus of ["needs_more_information", "rejected"]) {
    const result = validateEvidenceHasSourceLineage(validRows({ decisionRow: { decision_status: decisionStatus } }));
    assert.equal(result.ok, false, decisionStatus);
    assert.equal(result.code, "validation_blocker", decisionStatus);
  }
});

test("validateEvidenceHasSourceLineage check 6: a decision bound to a different source or source_version returns conflict_current_state_changed", () => {
  const wrongSource = validateEvidenceHasSourceLineage(validRows({ decisionRow: { source_id: "99999999-0000-4000-8000-000000000099" } }));
  assert.equal(wrongSource.ok, false);
  assert.equal(wrongSource.code, "conflict_current_state_changed");

  const wrongVersion = validateEvidenceHasSourceLineage(validRows({ decisionRow: { source_version_id: "99999999-0000-4000-8000-000000000098" } }));
  assert.equal(wrongVersion.ok, false);
  assert.equal(wrongVersion.code, "conflict_current_state_changed");
});

test("validateEvidenceHasSourceLineage check 7: any cross-row lineage-field mismatch returns conflict_current_state_changed", () => {
  const scenarios = [
    validRows({ candidateRow: { organization_id: "99999999-0000-4000-8000-000000000097" } }),
    validRows({ candidateRow: { intake_sensitivity_profile_id: "99999999-0000-4000-8000-000000000096" } }),
    validRows({ profileRow: { file_profile_id: "99999999-0000-4000-8000-000000000095" } }),
    validRows({ dictionaryRow: { data_dictionary_id: "99999999-0000-4000-8000-000000000094" } }),
    validRows({ profileRow: { profile_canonical_sha256: "b".repeat(64) } }),
  ];
  for (const rows of scenarios) {
    const result = validateEvidenceHasSourceLineage(rows);
    assert.equal(result.ok, false, JSON.stringify(rows));
    assert.equal(result.code, "conflict_current_state_changed", JSON.stringify(rows));
  }
});

test("validateEvidenceHasSourceLineage check 8: a malformed profile_canonical_sha256 anywhere in the lineage returns validation_blocker", () => {
  for (const key of ["sourceVersionRow", "candidateRow", "profileRow", "dictionaryRow"]) {
    const rows = validRows();
    const malformed = "not-a-sha256";
    rows.sourceVersionRow = { ...rows.sourceVersionRow, profile_canonical_sha256: malformed };
    rows.candidateRow = { ...rows.candidateRow, profile_canonical_sha256: malformed };
    rows.profileRow = { ...rows.profileRow, profile_canonical_sha256: malformed };
    rows.dictionaryRow = { ...rows.dictionaryRow, profile_canonical_sha256: malformed };
    const result = validateEvidenceHasSourceLineage(rows);
    assert.equal(result.ok, false, key);
    assert.equal(result.code, "validation_blocker", key);
  }
});

test("validateEvidenceHasSourceLineage check 9: the reapplied P1-08 permission predicate gates internal evidence processing", () => {
  for (const overrides of [
    { human_review_required: false },
    { public_use_allowed: true },
    { funder_use_allowed: true },
    { llm_processing_allowed: true },
    { product_learning_allowed: true },
    { retention_posture: "purge_scheduled" },
  ]) {
    const result = validateEvidenceHasSourceLineage(validRows({ profileRow: overrides }));
    assert.equal(result.ok, false, JSON.stringify(overrides));
    assert.equal(result.code, "validation_blocker", JSON.stringify(overrides));
  }
});

test("P2-01 service: KAI_SPRINT2_ENABLED disabled (or absent) returns feature_disabled with zero repository calls; P2-01 has no package-specific flag of its own", async () => {
  const throwingRepository = {
    async extractEvidenceFromSourceVersion() {
      throw new Error("repository should never be called when KAI_SPRINT2_ENABLED is disabled");
    },
  };
  for (const env of [
    {},
    { KAI_SPRINT2_ENABLED: "false" },
    { KAI_SPRINT2_ENABLED: "0" },
    { KAI_EVIDENCE_LINEAGE_ENABLED: "true" },
  ]) {
    const result = await extractEvidenceFromSourceVersion(
      { organizationId: ORG, sourceVersionId: SOURCE_VERSION, actorContext: humanActor(), now: NOW },
      { env, evidenceLineageRepository: throwingRepository },
    );
    assert.equal(result.ok, false, JSON.stringify(env));
    assert.equal(result.error.code, "feature_disabled", JSON.stringify(env));
  }
});

test("P2-01 service: KAI_SPRINT2_ENABLED alone (no other flag) enables the seam", async () => {
  const probeRepository = {
    async extractEvidenceFromSourceVersion() {
      return { ok: true, data: { replayed: false }, error: null };
    },
  };
  const result = await extractEvidenceFromSourceVersion(
    { organizationId: ORG, sourceVersionId: SOURCE_VERSION, actorContext: humanActor(), now: NOW },
    { env: { KAI_SPRINT2_ENABLED: "true" }, evidenceLineageRepository: probeRepository, metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) } },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

function humanActor(overrides = {}) {
  return {
    actorType: "human",
    actorUserId: "user-1",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_operator" }],
    ...overrides,
  };
}

const sprint2Enabled = { KAI_SPRINT2_ENABLED: "true" };

test("P2-01 service: rejects input shapes outside the accepted allowlist without calling the repository", async () => {
  const throwingRepository = {
    async extractEvidenceFromSourceVersion() {
      throw new Error("repository should never be called for a rejected input shape");
    },
  };
  const invalidInputs = [
    null,
    {},
    { organizationId: ORG, sourceVersionId: SOURCE_VERSION, actorContext: humanActor() },
    { organizationId: ORG, sourceVersionId: SOURCE_VERSION, now: NOW },
    { sourceVersionId: SOURCE_VERSION, actorContext: humanActor(), now: NOW },
    { organizationId: ORG, actorContext: humanActor(), now: NOW },
    { organizationId: "", sourceVersionId: SOURCE_VERSION, actorContext: humanActor(), now: NOW },
    { organizationId: ORG, sourceVersionId: SOURCE_VERSION, actorContext: humanActor(), now: "not-a-normalized-timestamp" },
    // unknown extra key
    { organizationId: ORG, sourceVersionId: SOURCE_VERSION, actorContext: humanActor(), now: NOW, extraKey: "nope" },
  ];
  for (const input of invalidInputs) {
    const result = await extractEvidenceFromSourceVersion(input, { env: sprint2Enabled, evidenceLineageRepository: throwingRepository });
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.error.code, "validation_blocker", JSON.stringify(input));
  }
});

test("P2-01 service (AUTH-KAI-003): rejects every non-human actor type outright, with zero repository calls", async () => {
  const throwingRepository = {
    async extractEvidenceFromSourceVersion() {
      throw new Error("repository should never be called for a non-human actor");
    },
  };
  for (const actorType of ["ai", "system", "import", "code", "generic_service"]) {
    const result = await extractEvidenceFromSourceVersion(
      { organizationId: ORG, sourceVersionId: SOURCE_VERSION, actorContext: humanActor({ actorType }), now: NOW },
      { env: sprint2Enabled, evidenceLineageRepository: throwingRepository },
    );
    assert.equal(result.ok, false, actorType);
    assert.equal(result.error.code, "authorization_denied", actorType);
  }
});

test("P2-01 service: forwards only organizationId/sourceVersionId/actorUserId/now/metadataOnlyAudit to the repository", async () => {
  const calls = [];
  const probeRepository = {
    async extractEvidenceFromSourceVersion(input) {
      calls.push(input);
      return { ok: true, data: { replayed: false }, error: null };
    },
  };
  const metadataOnlyAudit = { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) };
  const result = await extractEvidenceFromSourceVersion(
    { organizationId: ORG, sourceVersionId: SOURCE_VERSION, actorContext: humanActor(), now: NOW },
    { env: sprint2Enabled, evidenceLineageRepository: probeRepository, metadataOnlyAudit },
  );
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]).sort(), ["actorUserId", "metadataOnlyAudit", "now", "organizationId", "sourceVersionId"]);
  assert.equal(calls[0].organizationId, ORG);
  assert.equal(calls[0].sourceVersionId, SOURCE_VERSION);
  assert.equal(calls[0].actorUserId, "user-1");
  assert.equal(calls[0].now, NOW);
});

test("P2-01 service: extractEvidenceFromSourceVersion itself contains no SQL and does not import a database pool directly", () => {
  const body = serviceSource.match(/export async function extractEvidenceFromSourceVersion\([\s\S]*/)?.[0];
  assert.ok(body, "expected to find the extractEvidenceFromSourceVersion function body");
  assert.doesNotMatch(body, /\bimport\s+pool\b/);
  assert.doesNotMatch(body, /\bSELECT\b|\bINSERT INTO\b|\bUPDATE\b|\bDELETE FROM\b/i);
});

test("P2-01 repository: source_locators/evidence_items/review_queue_items inserts all use ON CONFLICT ... DO NOTHING RETURNING", () => {
  assert.match(
    repositorySource,
    /INSERT INTO kai\.source_locators[\s\S]*?ON CONFLICT \(organization_id, source_version_id, locator_fingerprint\)[\s\S]*?DO NOTHING[\s\S]*?RETURNING/,
  );
  assert.match(
    repositorySource,
    /INSERT INTO kai\.evidence_items[\s\S]*?ON CONFLICT \(organization_id, source_version_id, statement_fingerprint\)[\s\S]*?DO NOTHING[\s\S]*?RETURNING/,
  );
  assert.match(
    repositorySource,
    /INSERT INTO kai\.review_queue_items[\s\S]*?ON CONFLICT \(organization_id, queue_type, target_object_type, target_object_id\)[\s\S]*?DO NOTHING[\s\S]*?RETURNING/,
  );
});

test("P2-01 repository resolves concurrency via ON CONFLICT ... DO NOTHING RETURNING plus authoritative re-reads, not a raised 23505 catch or an in-process lock", () => {
  assert.doesNotMatch(repositorySource, /\bcatch\s*\(\s*insertError\s*\)/);
  assert.doesNotMatch(repositorySource, /"23505"/);
  assert.doesNotMatch(repositorySource, /\b(?:inFlight|pendingLocks?|mutex|semaphore|advisory_lock|pg_advisory|savepoint)\b/i);
});

test("P2-01 repository gates the review-queue-item write strictly on THIS call's own isFreshlyCreated result, never on a missing queue item alone", () => {
  assert.match(repositorySource, /if \(isFreshlyCreated\) \{/);
  assert.match(repositorySource, /throw new ConcurrentStateChangedError\("review_queue_item"\)/);
});

test("P2-01 repository never fabricates raw content, sample values, or storage pointers", () => {
  assert.doesNotMatch(repositorySource, /raw_content|sample_values|storage_uri|signed_url/i);
});

test("P2-01 audit contract discloses its validator key as a P2-01 implementation decision", () => {
  assert.equal(__evidenceLineageRepositoryContract.EVIDENCE_LINEAGE_VALIDATOR_KEY, "VAL-KAI-P2-01-001");
  assert.equal(__evidenceLineageRepositoryContract.EVIDENCE_LINEAGE_AUDIT_OPERATION, "evidence_lineage_extracted");
  assert.equal(__evidenceLineageRepositoryContract.LOCATOR_TYPE_COLUMN, "column");
});

test("P2-01 computeLocatorFingerprint is deterministic and depends on organizationId/sourceVersionId/locatorType/columnName", () => {
  const { computeLocatorFingerprint } = __evidenceLineageRepositoryTestables;
  const inputs = { organizationId: ORG, sourceVersionId: SOURCE_VERSION, locatorType: "column", columnName: "email" };
  const first = computeLocatorFingerprint(inputs);
  const second = computeLocatorFingerprint({ ...inputs });
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, computeLocatorFingerprint({ ...inputs, columnName: "phone" }));
  assert.notEqual(first, computeLocatorFingerprint({ ...inputs, sourceVersionId: "different-version" }));
});

test("P2-01 computeStatementFingerprint is deterministic and depends on organizationId/sourceVersionId/evidenceType/statement", () => {
  const { computeStatementFingerprint } = __evidenceLineageRepositoryTestables;
  const inputs = { organizationId: ORG, sourceVersionId: SOURCE_VERSION, evidenceType: "dictionary_field_presence_fact", statement: "Source version's committed data dictionary includes field \"email\" of committed type \"text\"." };
  const first = computeStatementFingerprint(inputs);
  const second = computeStatementFingerprint({ ...inputs });
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, computeStatementFingerprint({ ...inputs, statement: "different statement." }));
  assert.notEqual(first, computeStatementFingerprint({ ...inputs, evidenceType: "some_other_type" }));
});

test("P2-01 buildEvidenceCompositionPlan builds exactly one locator-bound item per committed field, deterministically, in profile_field_key order, with no unlocated aggregate item", () => {
  const { buildEvidenceCompositionPlan } = __evidenceLineageRepositoryTestables;
  const fieldRows = [
    { profile_field_key: "email", data_type: "text", sensitivity: "unknown" },
    { profile_field_key: "name", data_type: "text", sensitivity: "unknown" },
  ];
  const plan = buildEvidenceCompositionPlan({ organizationId: ORG, sourceVersionId: SOURCE_VERSION, fieldRows });
  assert.equal(plan.length, 2);
  assert.equal(plan[0].evidenceType, "dictionary_field_presence_fact");
  assert.equal(plan[0].sensitivityLevel, "unknown");
  assert.deepEqual(plan[0].coordinates, { column_name: "email" });
  assert.equal(plan[1].coordinates.column_name, "name");

  const emptyPlan = buildEvidenceCompositionPlan({ organizationId: ORG, sourceVersionId: SOURCE_VERSION, fieldRows: [] });
  assert.equal(emptyPlan.length, 0);
});

test("P2-01 repository never statically imports Backend/kai/db/kaiDb.js at module top level - only a deferred dynamic import, used only when no runInTransaction is injected", () => {
  const topLevelImports = repositorySource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(
    topLevelImports.every((line) => !/kaiDb\.js/.test(line)),
    "expected no static top-level import of kaiDb.js - it must be deferred so importing this module never import-time-initializes the ambient application pool",
  );
  assert.match(repositorySource, /await import\("\.\.\/db\/kaiDb\.js"\)/);
});

test("P2-01 repository rejects an input shape outside its own allowlist without opening a transaction", async () => {
  const repository = createPostgresEvidenceLineageRepository({
    runInTransaction: () => {
      throw new Error("transaction should never open for a rejected repository input shape");
    },
  });
  const result = await repository.extractEvidenceFromSourceVersion({ organizationId: ORG });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});
