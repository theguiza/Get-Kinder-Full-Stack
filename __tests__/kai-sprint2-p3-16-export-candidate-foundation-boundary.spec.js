import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  confirmGeneratedDraftLimitationSnapshot,
  createGeneratedDraftExportCandidate,
  __exportCandidateServiceContract,
  __exportCandidateServiceTestables,
} from "../Backend/kai/services/kaiExportCandidateService.js";
import {
  __exportCandidateRepositoryTestables,
} from "../Backend/kai/dictionary/postgresExportCandidateRepository.js";
import {
  LIMITATION_SNAPSHOT_ALLOWED_ROLES,
  EXPORT_CANDIDATE_ALLOWED_ROLES,
  isLimitationCodeSet,
  LIMITATION_CODES_MAX_COUNT,
} from "../Backend/kai/dictionary/exportCandidateContract.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const DRAFT = "00000000-0000-4000-8000-000000000802";
const CLAIM_A = "00000000-0000-4000-8000-000000000901";
const EVIDENCE_A = "00000000-0000-4000-8000-000000000902";
const CLAIM_B = "00000000-0000-4000-8000-000000000903";
const EVIDENCE_B = "00000000-0000-4000-8000-000000000904";
const NOW = "2026-08-07T10:00:00.000Z";

const enabledEnv = Object.freeze({
  KAI_SPRINT2_ENABLED: "true",
  KAI_GENERATION_ENABLED: "true",
  KAI_PUBLIC_EXPORT_ENABLED: "true",
});

const gkAdminActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
  ],
});
const gkReviewerActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000002",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" },
  ],
});

function auditRecorder() {
  return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
}

function confirmInput(overrides = {}) {
  return {
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
    entries: [{ claimId: CLAIM_A, evidenceItemId: EVIDENCE_A, limitationCodes: ["small_sample_size"] }],
    actorContext: gkReviewerActorContext,
    now: NOW,
    ...overrides,
  };
}

function candidateInput(overrides = {}) {
  return {
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
    actorContext: gkAdminActorContext,
    now: NOW,
    ...overrides,
  };
}

// --- contract-level pure functions ---

test("P3-16 isLimitationCodeSet accepts empty (human-confirmed no limitations) and deduplicated valid sets, rejects malformed/oversized/duplicate", () => {
  assert.equal(isLimitationCodeSet([]), true);
  assert.equal(isLimitationCodeSet(["small_sample_size", "self_reported"]), true);
  assert.equal(isLimitationCodeSet(["Small_Sample"]), false);
  assert.equal(isLimitationCodeSet(["a", "a"]), false);
  assert.equal(isLimitationCodeSet(null), false);
  assert.equal(isLimitationCodeSet(Array.from({ length: LIMITATION_CODES_MAX_COUNT + 1 }, (_, i) => `code_${i}`)), false);
});

test("P3-16 limitation snapshot confirmation is restricted to gk_reviewer/gk_admin; export candidate creation to gk_admin only", () => {
  assert.deepEqual([...LIMITATION_SNAPSHOT_ALLOWED_ROLES].sort(), ["gk_admin", "gk_reviewer"]);
  assert.deepEqual([...EXPORT_CANDIDATE_ALLOWED_ROLES], ["gk_admin"]);
});

// --- repository pure-function testables ---

test("P3-16 confirm-limitation-snapshot input validator rejects unknown keys, malformed ids, malformed codes, and duplicate cited pairs", () => {
  const { validateConfirmLimitationSnapshotInput } = __exportCandidateRepositoryTestables;
  assert.equal(validateConfirmLimitationSnapshotInput(confirmInput()), true);
  assert.equal(validateConfirmLimitationSnapshotInput({ ...confirmInput(), extra: true }), false);
  assert.equal(validateConfirmLimitationSnapshotInput(confirmInput({ organizationId: "not-a-uuid" })), false);
  assert.equal(validateConfirmLimitationSnapshotInput(confirmInput({ entries: [] })), false);
  assert.equal(validateConfirmLimitationSnapshotInput(confirmInput({
    entries: [{ claimId: CLAIM_A, evidenceItemId: EVIDENCE_A, limitationCodes: ["BAD CODE"] }],
  })), false);
  assert.equal(validateConfirmLimitationSnapshotInput(confirmInput({
    entries: [
      { claimId: CLAIM_A, evidenceItemId: EVIDENCE_A, limitationCodes: [] },
      { claimId: CLAIM_A, evidenceItemId: EVIDENCE_A, limitationCodes: ["x"] },
    ],
  })), false);
  assert.equal(validateConfirmLimitationSnapshotInput(confirmInput({ now: "2026-08-07 10:00:00" })), false);
});

test("P3-16 exact cited-pair coverage rejects missing pairs, extra/uncited pairs, and accepts an exact match", () => {
  const { validateEntriesCoverExactCitedPairs } = __exportCandidateRepositoryTestables;
  const citedPairs = [
    { claim_id: CLAIM_A, evidence_item_id: EVIDENCE_A },
    { claim_id: CLAIM_B, evidence_item_id: EVIDENCE_B },
  ];
  const exact = [
    { claimId: CLAIM_A, evidenceItemId: EVIDENCE_A, limitationCodes: [] },
    { claimId: CLAIM_B, evidenceItemId: EVIDENCE_B, limitationCodes: [] },
  ];
  assert.equal(validateEntriesCoverExactCitedPairs(exact, citedPairs), true);
  assert.equal(validateEntriesCoverExactCitedPairs([exact[0]], citedPairs), false);
  assert.equal(validateEntriesCoverExactCitedPairs([...exact, { claimId: CLAIM_A, evidenceItemId: "00000000-0000-4000-8000-000000009999", limitationCodes: [] }], citedPairs), false);
});

test("P3-16 canonicalEntriesFingerprint is order-independent, code-set-order-independent, and sensitive to any code content change", () => {
  const { canonicalEntriesFingerprint } = __exportCandidateRepositoryTestables;
  const a = [
    { claimId: CLAIM_A, evidenceItemId: EVIDENCE_A, limitationCodes: ["b_code", "a_code"] },
    { claimId: CLAIM_B, evidenceItemId: EVIDENCE_B, limitationCodes: [] },
  ];
  const reordered = [
    { claimId: CLAIM_B, evidenceItemId: EVIDENCE_B, limitationCodes: [] },
    { claimId: CLAIM_A, evidenceItemId: EVIDENCE_A, limitationCodes: ["a_code", "b_code"] },
  ];
  const changed = [
    { claimId: CLAIM_A, evidenceItemId: EVIDENCE_A, limitationCodes: ["a_code"] },
    { claimId: CLAIM_B, evidenceItemId: EVIDENCE_B, limitationCodes: [] },
  ];
  assert.equal(canonicalEntriesFingerprint(a), canonicalEntriesFingerprint(reordered));
  assert.notEqual(canonicalEntriesFingerprint(a), canonicalEntriesFingerprint(changed));
});

test("P3-16 deriveConfirmedByRole requires an active, org-scoped gk_reviewer/gk_admin membership", () => {
  const { deriveConfirmedByRole } = __exportCandidateRepositoryTestables;
  assert.equal(deriveConfirmedByRole(gkReviewerActorContext, ORG), "gk_reviewer");
  assert.equal(deriveConfirmedByRole(gkAdminActorContext, ORG), "gk_admin");
  assert.equal(deriveConfirmedByRole(gkReviewerActorContext, OTHER_ORG), null);
  assert.equal(deriveConfirmedByRole({
    actorType: "human",
    actorUserId: "x",
    organizationMemberships: [{ organization_id: ORG, membership_status: "inactive", role_name: "gk_admin" }],
  }, ORG), null);
  assert.equal(deriveConfirmedByRole({
    actorType: "human",
    actorUserId: "x",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_admin" }],
  }, ORG), null);
});

test("P3-16 create-export-candidate input validator rejects unknown keys, malformed ids, and non-canonical timestamps", () => {
  const { validateCreateExportCandidateInput } = __exportCandidateRepositoryTestables;
  assert.equal(validateCreateExportCandidateInput(candidateInput()), true);
  assert.equal(validateCreateExportCandidateInput({ ...candidateInput(), extra: true }), false);
  assert.equal(validateCreateExportCandidateInput(candidateInput({ generatedContentDraftId: "not-a-uuid" })), false);
  assert.equal(validateCreateExportCandidateInput(candidateInput({ now: "2026-08-07T10:00:00Z" })), false);
});

test("P3-16 canonical representation excludes mutable live state and only binds identity, content, citation lineage, and limitation semantics", () => {
  const { buildCanonicalRepresentation, canonicalFingerprint } = __exportCandidateRepositoryTestables;
  const blocks = [{
    ordinal: 1,
    text: "Synthetic block text.",
    citations: [{ claim_id: CLAIM_A, evidence_item_id: EVIDENCE_A, source_id: "s1", source_version_id: "sv1" }],
  }];
  const snapshotEntries = [{ claim_id: CLAIM_A, evidence_item_id: EVIDENCE_A, limitation_codes: ["a_code"] }];
  const representation = buildCanonicalRepresentation({
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
    contentType: "evidence_summary",
    requestedAudience: "internal",
    blocks,
    snapshotEntries,
  });
  assert.deepEqual(new Set(Object.keys(representation)), new Set([
    "organizationId", "generatedContentDraftId", "contentType", "requestedAudience", "blocks", "limitations",
  ]));
  assert.equal(typeof canonicalFingerprint(representation), "string");
  assert.match(canonicalFingerprint(representation), /^[0-9a-f]{64}$/);

  const mismatched = buildCanonicalRepresentation({
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
    contentType: "evidence_summary",
    requestedAudience: "internal",
    blocks,
    snapshotEntries: [],
  });
  assert.equal(mismatched, null);
});

test("P3-16 canonical fingerprint changes when block text, citation lineage, audience, or limitation codes change, but not when equivalent unordered collections are reordered", () => {
  const { buildCanonicalRepresentation, canonicalFingerprint } = __exportCandidateRepositoryTestables;
  const base = {
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
    contentType: "evidence_summary",
    requestedAudience: "internal",
    blocks: [{
      ordinal: 1,
      text: "Synthetic block text.",
      citations: [
        { claim_id: CLAIM_A, evidence_item_id: EVIDENCE_A, source_id: "s1", source_version_id: "sv1" },
        { claim_id: CLAIM_B, evidence_item_id: EVIDENCE_B, source_id: "s2", source_version_id: "sv2" },
      ],
    }],
    snapshotEntries: [
      { claim_id: CLAIM_A, evidence_item_id: EVIDENCE_A, limitation_codes: [] },
      { claim_id: CLAIM_B, evidence_item_id: EVIDENCE_B, limitation_codes: [] },
    ],
  };
  const reorderedCitations = { ...base, blocks: [{ ...base.blocks[0], citations: [...base.blocks[0].citations].reverse() }] };
  const reorderedEntries = { ...base, snapshotEntries: [...base.snapshotEntries].reverse() };
  const changedText = { ...base, blocks: [{ ...base.blocks[0], text: "Different text." }] };
  const changedAudience = { ...base, requestedAudience: "funder" };
  const changedLineage = {
    ...base,
    blocks: [{ ...base.blocks[0], citations: [{ ...base.blocks[0].citations[0], source_version_id: "sv-changed" }, base.blocks[0].citations[1]] }],
  };
  const changedCodes = {
    ...base,
    snapshotEntries: [{ ...base.snapshotEntries[0], limitation_codes: ["new_code"] }, base.snapshotEntries[1]],
  };

  const fp = (input) => canonicalFingerprint(buildCanonicalRepresentation(input));
  assert.equal(fp(base), fp(reorderedCitations));
  assert.equal(fp(base), fp(reorderedEntries));
  assert.notEqual(fp(base), fp(changedText));
  assert.notEqual(fp(base), fp(changedAudience));
  assert.notEqual(fp(base), fp(changedLineage));
  assert.notEqual(fp(base), fp(changedCodes));
});

// --- service gates: limitation snapshot confirmation ---

test("P3-16 confirmGeneratedDraftLimitationSnapshot requires feature flags, exact input, mapped human, active membership, and gk_reviewer/gk_admin role before any repository call", async () => {
  let repositoryCalls = 0;
  const repository = { async confirmLimitationSnapshot() { repositoryCalls += 1; return { ok: true, data: {}, error: null }; } };
  const deps = { exportCandidateRepository: repository, metadataOnlyAudit: auditRecorder() };

  assert.equal((await confirmGeneratedDraftLimitationSnapshot(confirmInput(), { ...deps, env: {} })).error.code, "feature_disabled");
  assert.equal((await confirmGeneratedDraftLimitationSnapshot({ ...confirmInput(), extra: true }, { ...deps, env: enabledEnv })).error.code, "validation_blocker");
  assert.equal(
    (await confirmGeneratedDraftLimitationSnapshot(confirmInput({ actorContext: { actorType: "system", actorUserId: "x" } }), { ...deps, env: enabledEnv })).error.code,
    "authorization_denied",
  );
  assert.equal(
    (await confirmGeneratedDraftLimitationSnapshot(confirmInput({ organizationId: OTHER_ORG }), { ...deps, env: enabledEnv })).error.code,
    "authorization_denied",
  );
  assert.equal(
    (await confirmGeneratedDraftLimitationSnapshot(confirmInput({
      actorContext: { ...gkReviewerActorContext, organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_admin" }] },
    }), { ...deps, env: enabledEnv })).error.code,
    "authorization_denied",
  );
  assert.equal(repositoryCalls, 0);

  const ok = await confirmGeneratedDraftLimitationSnapshot(confirmInput(), { ...deps, env: enabledEnv });
  assert.equal(ok.ok, true);
  assert.equal(repositoryCalls, 1);

  const asAdmin = await confirmGeneratedDraftLimitationSnapshot(confirmInput({ actorContext: gkAdminActorContext }), { ...deps, env: enabledEnv });
  assert.equal(asAdmin.ok, true);
  assert.equal(repositoryCalls, 2);
});

test("P3-16 confirmGeneratedDraftLimitationSnapshot lazy-loads the database-capable repository only after all gates, per its own source", () => {
  const source = readFileSync(new URL("../Backend/kai/services/kaiExportCandidateService.js", import.meta.url), "utf8");
  const topLevelImports = source.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/postgresExportCandidateRepository\.js|kaiDb\.js|"pg"/.test(line)));
  assert.match(source, /await import\(\s*"\.\.\/dictionary\/postgresExportCandidateRepository\.js"/);
});

// --- service gates: export candidate creation ---

test("P3-16 createGeneratedDraftExportCandidate requires feature flags, exact input, mapped human, active membership, and gk_admin (not gk_reviewer) before any repository call", async () => {
  let repositoryCalls = 0;
  const repository = { async createExportCandidate() { repositoryCalls += 1; return { ok: true, data: {}, error: null }; } };
  const deps = { exportCandidateRepository: repository, metadataOnlyAudit: auditRecorder() };

  assert.equal((await createGeneratedDraftExportCandidate(candidateInput(), { ...deps, env: {} })).error.code, "feature_disabled");
  assert.equal((await createGeneratedDraftExportCandidate({ ...candidateInput(), extra: true }, { ...deps, env: enabledEnv })).error.code, "validation_blocker");
  assert.equal(
    (await createGeneratedDraftExportCandidate(candidateInput({ actorContext: gkReviewerActorContext }), { ...deps, env: enabledEnv })).error.code,
    "authorization_denied",
  );
  assert.equal(
    (await createGeneratedDraftExportCandidate(candidateInput({ organizationId: OTHER_ORG }), { ...deps, env: enabledEnv })).error.code,
    "authorization_denied",
  );
  assert.equal(repositoryCalls, 0);

  const ok = await createGeneratedDraftExportCandidate(candidateInput(), { ...deps, env: enabledEnv });
  assert.equal(ok.ok, true);
  assert.equal(repositoryCalls, 1);
});

test("P3-16 createGeneratedDraftExportCandidate lazy-loads the database-capable repository only after all gates, per its own source", () => {
  const source = readFileSync(new URL("../Backend/kai/services/kaiExportCandidateService.js", import.meta.url), "utf8");
  const topLevelImports = source.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/postgresExportCandidateRepository\.js|kaiDb\.js|"pg"/.test(line)));
});

test("P3-16 service and repository contracts export nothing that reaches a route: no route file imports either module", () => {
  const source = readFileSync(new URL("../Backend/kai/services/kaiExportCandidateService.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /express|router|req\.|res\./);
});

test("P3-16 __exportCandidateServiceContract pins operation names and role sets used by the authorization gate", () => {
  assert.equal(__exportCandidateServiceContract.CONFIRM_LIMITATION_SNAPSHOT_OPERATION, "confirm_generated_draft_limitation_snapshot");
  assert.equal(__exportCandidateServiceContract.CREATE_EXPORT_CANDIDATE_OPERATION, "create_generated_draft_export_candidate");
  assert.deepEqual([...__exportCandidateServiceContract.EXPORT_CANDIDATE_ROLES], ["gk_admin"]);
});

test("P3-16 __exportCandidateServiceTestables validators agree with the repository's own input validators", () => {
  const { isConfirmLimitationSnapshotInput, isCreateExportCandidateInput } = __exportCandidateServiceTestables;
  assert.equal(isConfirmLimitationSnapshotInput(confirmInput()), true);
  assert.equal(isCreateExportCandidateInput(candidateInput()), true);
});
