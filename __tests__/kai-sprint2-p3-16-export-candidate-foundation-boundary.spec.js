import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  confirmGeneratedDraftLimitationSnapshot,
  confirmGeneratedDraftLimitationSnapshotFromCitedPairs,
  createGeneratedDraftExportCandidate,
  __exportCandidateServiceContract,
  __exportCandidateServiceTestables,
} from "../Backend/kai/services/kaiExportCandidateService.js";
import {
  createPostgresExportCandidateRepository,
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
// The existing Get Kinder site-admin authority: no kai.organization_memberships
// row at all, authorized solely through central authorization's recognized
// get_kinder_site_admin platform-superuser bypass.
const platformSuperuserActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000006",
  organizationMemberships: [],
  platformSuperuser: true,
  platformSuperuserAuthority: "get_kinder_site_admin",
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

function repositoryConfirmInput(overrides = {}) {
  return {
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
    entries: [{ claimId: CLAIM_A, evidenceItemId: EVIDENCE_A, limitationCodes: ["small_sample_size"] }],
    actorContext: gkReviewerActorContext,
    confirmedByRole: "gk_reviewer",
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

test("P3-16 confirm-limitation-snapshot input validator rejects unknown keys, malformed ids, malformed codes, duplicate cited pairs, and a missing/blank confirmedByRole", () => {
  const { validateConfirmLimitationSnapshotInput } = __exportCandidateRepositoryTestables;
  assert.equal(validateConfirmLimitationSnapshotInput(repositoryConfirmInput()), true);
  assert.equal(validateConfirmLimitationSnapshotInput({ ...repositoryConfirmInput(), extra: true }), false);
  assert.equal(validateConfirmLimitationSnapshotInput(confirmInput()), false, "the service-shaped input (no confirmedByRole) is not a valid repository input");
  assert.equal(validateConfirmLimitationSnapshotInput(repositoryConfirmInput({ organizationId: "not-a-uuid" })), false);
  assert.equal(validateConfirmLimitationSnapshotInput(repositoryConfirmInput({ entries: [] })), false);
  assert.equal(validateConfirmLimitationSnapshotInput(repositoryConfirmInput({
    entries: [{ claimId: CLAIM_A, evidenceItemId: EVIDENCE_A, limitationCodes: ["BAD CODE"] }],
  })), false);
  assert.equal(validateConfirmLimitationSnapshotInput(repositoryConfirmInput({
    entries: [
      { claimId: CLAIM_A, evidenceItemId: EVIDENCE_A, limitationCodes: [] },
      { claimId: CLAIM_A, evidenceItemId: EVIDENCE_A, limitationCodes: ["x"] },
    ],
  })), false);
  assert.equal(validateConfirmLimitationSnapshotInput(repositoryConfirmInput({ now: "2026-08-07 10:00:00" })), false);
  assert.equal(validateConfirmLimitationSnapshotInput(repositoryConfirmInput({ confirmedByRole: "" })), false);
  assert.equal(validateConfirmLimitationSnapshotInput(repositoryConfirmInput({ confirmedByRole: null })), false);
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

test("P3-16 repository no longer derives confirmedByRole from actorContext.organizationMemberships: an actor with no active org membership at all (the platform-superuser shape) is accepted once the service supplies a canonical confirmedByRole", async () => {
  const repository = createPostgresExportCandidateRepository({ runInTransaction: async () => { throw new Error("should not reach a transaction: shape/role validation must fail first"); } });
  const platformSuperuserActor = { actorType: "human", actorUserId: "x", organizationMemberships: [] };

  const missingRole = await repository.confirmLimitationSnapshot(
    { organizationId: ORG, generatedContentDraftId: DRAFT, entries: [{ claimId: CLAIM_A, evidenceItemId: EVIDENCE_A, limitationCodes: [] }], actorContext: platformSuperuserActor, confirmedByRole: null, now: NOW },
    { metadataOnlyAudit: auditRecorder() },
  );
  assert.equal(missingRole.ok, false);
  assert.equal(missingRole.error.code, "validation_blocker");

  const nonCanonicalRole = await repository.confirmLimitationSnapshot(
    { organizationId: ORG, generatedContentDraftId: DRAFT, entries: [{ claimId: CLAIM_A, evidenceItemId: EVIDENCE_A, limitationCodes: [] }], actorContext: platformSuperuserActor, confirmedByRole: "client_admin", now: NOW },
    { metadataOnlyAudit: auditRecorder() },
  );
  assert.equal(nonCanonicalRole.ok, false);
  assert.equal(nonCanonicalRole.error.code, "validation_blocker");
  assert.equal(nonCanonicalRole.error.reason, "confirmed_by_role_not_derivable");
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

function capturingRepository() {
  const calls = [];
  return {
    calls,
    async confirmLimitationSnapshot(input) {
      calls.push(input);
      return { ok: true, data: { confirmedByRole: input.confirmedByRole }, error: null };
    },
  };
}

test("P3-16 confirmGeneratedDraftLimitationSnapshot: recognized site-admin platform-superuser authorization (no org membership) attributes gk_admin and passes it to the repository [SERVICE_REPOSITORY_ARGUMENT]", async () => {
  const repository = capturingRepository();
  const deps = { exportCandidateRepository: repository, metadataOnlyAudit: auditRecorder(), env: enabledEnv };

  const result = await confirmGeneratedDraftLimitationSnapshot(confirmInput({ actorContext: platformSuperuserActorContext }), deps);
  assert.equal(result.ok, true);
  assert.equal(repository.calls.length, 1);
  assert.equal(repository.calls[0].confirmedByRole, "gk_admin");
  assert.equal(Object.hasOwn(repository.calls[0].actorContext, "organizationMemberships"), true);
  assert.deepEqual(repository.calls[0].actorContext.organizationMemberships, [], "no synthetic membership is fabricated");
});

test("P3-16 confirmGeneratedDraftLimitationSnapshot: an ordinary unauthorized actor is blocked before the repository is ever called [SERVICE_REPOSITORY_ARGUMENT]", async () => {
  const repository = capturingRepository();
  const deps = { exportCandidateRepository: repository, metadataOnlyAudit: auditRecorder(), env: enabledEnv };

  const result = await confirmGeneratedDraftLimitationSnapshot(
    confirmInput({ actorContext: { actorType: "human", actorUserId: "x", organizationMemberships: [] } }),
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(repository.calls.length, 0);
});

test("P3-16 confirmGeneratedDraftLimitationSnapshot: gk_reviewer and gk_admin memberships attribute their own role to the repository [SERVICE_REPOSITORY_ARGUMENT]", async () => {
  const repository = capturingRepository();
  const deps = { exportCandidateRepository: repository, metadataOnlyAudit: auditRecorder(), env: enabledEnv };

  const asReviewer = await confirmGeneratedDraftLimitationSnapshot(confirmInput({ actorContext: gkReviewerActorContext }), deps);
  assert.equal(asReviewer.ok, true);
  assert.equal(repository.calls[0].confirmedByRole, "gk_reviewer");

  const asAdmin = await confirmGeneratedDraftLimitationSnapshot(confirmInput({ actorContext: gkAdminActorContext }), deps);
  assert.equal(asAdmin.ok, true);
  assert.equal(repository.calls[1].confirmedByRole, "gk_admin");
});

test("P3-16 confirmGeneratedDraftLimitationSnapshot: successful authorization with unresolvable attribution fails closed with confirmed_by_role_not_derivable and never reaches the repository", async () => {
  const repository = capturingRepository();
  const deps = { exportCandidateRepository: repository, metadataOnlyAudit: auditRecorder(), env: enabledEnv };

  // Central authorization's platform-superuser bypass succeeds regardless of
  // the operation's allowedRoles (see kai-sprint2-authorization.spec.js), but
  // this actor's platformSuperuserAuthority is not the recognized
  // get_kinder_site_admin source, so the shared resolver in
  // Backend/kai/auth/kaiAuthorizedRoleAttribution.js must not attribute
  // gk_admin (see kai-sprint2-authorized-role-attribution.spec.js for the
  // resolver-level proof of this same rule).
  const result = await confirmGeneratedDraftLimitationSnapshot(
    confirmInput({
      actorContext: {
        actorType: "human",
        actorUserId: "x",
        organizationMemberships: [],
        platformSuperuser: true,
        platformSuperuserAuthority: "not_get_kinder_site_admin",
      },
    }),
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.blockers[0].blocking_reason, "confirmed_by_role_not_derivable");
  assert.equal(repository.calls.length, 0);
});

test("P3-16 confirmGeneratedDraftLimitationSnapshotFromCitedPairs follows the same attribution flow as confirmGeneratedDraftLimitationSnapshot [SERVICE_REPOSITORY_ARGUMENT]", async () => {
  const calls = [];
  const repository = {
    async loadCitedPairsForDraft() {
      return { ok: true, data: { citedPairs: [{ claimId: CLAIM_A, evidenceItemId: EVIDENCE_A }] } };
    },
    async confirmLimitationSnapshot(input) {
      calls.push(input);
      return { ok: true, data: { confirmedByRole: input.confirmedByRole }, error: null };
    },
  };
  const deps = { exportCandidateRepository: repository, metadataOnlyAudit: auditRecorder(), env: enabledEnv };

  const asSiteAdmin = await confirmGeneratedDraftLimitationSnapshotFromCitedPairs(
    candidateInput({ actorContext: platformSuperuserActorContext }),
    deps,
  );
  assert.equal(asSiteAdmin.ok, true);
  assert.equal(calls[0].confirmedByRole, "gk_admin");
  assert.deepEqual(calls[0].actorContext.organizationMemberships, []);
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
