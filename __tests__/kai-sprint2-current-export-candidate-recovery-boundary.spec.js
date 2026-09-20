// CURRENT EXPORT CANDIDATE RECOVERY - BOUNDARY (pure-function / fake-tx, no
// database).
//
// Proves the accepted resolution contract: the exact kai.export_candidates
// row, if any, whose canonical fingerprint matches a draft's CURRENT
// governed state, resolved by organizationId + generatedContentDraftId +
// requestedAudience + the canonical fingerprint recomputed from current
// state - never a latest/newest/created_at-ordered historical candidate.
//
//   - no current candidate -> exportCandidateId: null (a normal read
//     result, never an error);
//   - an exact current-state candidate -> resolves exactly;
//   - a candidate that has gone stale (current governed state no longer
//     matches its recorded fingerprint) never resolves, even though it is
//     still the only candidate row that exists;
//   - a replacement candidate for the new current state resolves once
//     persisted, while the stale candidate remains untouched, immutable
//     history;
//   - human-authority effectiveness is evaluated per EXACT export candidate
//     id, so a grant recorded against a stale candidate can never authorize
//     a different (replacement) candidate id.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  readCurrentExportCandidateForDraftInTransaction,
  __exportCandidateRepositoryTestables,
} from "../Backend/kai/dictionary/postgresExportCandidateRepository.js";
import { evaluateHumanAuthorityEffectivenessInTransaction } from "../Backend/kai/dictionary/postgresHumanAuthorityDecisionRepository.js";

const { buildCanonicalRepresentation, canonicalFingerprint } = __exportCandidateRepositoryTestables;

const ORG = "00000000-0000-4000-8000-000000000001";
const DRAFT = "00000000-0000-4000-8000-000000001301";
const BLOCK = "00000000-0000-4000-8000-000000001302";
const CLAIM = "00000000-0000-4000-8000-000000001303";
const EVIDENCE = "00000000-0000-4000-8000-000000001304";
const SOURCE = "00000000-0000-4000-8000-000000001305";
const SOURCE_VERSION = "00000000-0000-4000-8000-000000001306";
const SNAPSHOT = "00000000-0000-4000-8000-000000001307";
const CANDIDATE_A = "00000000-0000-4000-8000-0000000013a0";
const CANDIDATE_B = "00000000-0000-4000-8000-0000000013b0";

function makeState() {
  return {
    draft: {
      generated_content_draft_id: DRAFT,
      organization_id: ORG,
      content_type: "evidence_summary",
      requested_audience: "internal",
    },
    blocks: [
      { generated_content_block_id: BLOCK, generated_content_draft_id: DRAFT, organization_id: ORG, ordinal: 1, text: "Original governed block text." },
    ],
    citations: [
      { generated_content_block_id: BLOCK, claim_id: CLAIM, evidence_item_id: EVIDENCE, source_id: SOURCE, source_version_id: SOURCE_VERSION },
    ],
    limitationSnapshots: [
      { limitation_snapshot_id: SNAPSHOT, organization_id: ORG, generated_content_draft_id: DRAFT, supersedes_snapshot_id: null },
    ],
    limitationSnapshotEntries: [
      { limitation_snapshot_id: SNAPSHOT, claim_id: CLAIM, evidence_item_id: EVIDENCE, limitation_codes: [] },
    ],
    exportCandidates: [],
    humanAuthorityDecisions: [],
  };
}

function makeTx(state) {
  return {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();

      if (s.includes("FROM kai.generated_content_drafts") && s.includes("generated_content_draft_id = $2::uuid")) {
        const [organizationId, draftId] = params;
        const match = state.draft && state.draft.organization_id === organizationId && state.draft.generated_content_draft_id === draftId;
        return { rows: match ? [state.draft] : [] };
      }
      if (s.includes("FROM kai.limitation_snapshots ls") && s.includes("ls.generated_content_draft_id = $2::uuid")) {
        const [organizationId, draftId] = params;
        const rows = state.limitationSnapshots.filter((snap) => snap.organization_id === organizationId
          && snap.generated_content_draft_id === draftId
          && !state.limitationSnapshots.some((succ) => succ.supersedes_snapshot_id === snap.limitation_snapshot_id));
        return { rows: rows.map((r) => ({ limitation_snapshot_id: r.limitation_snapshot_id })) };
      }
      if (s.includes("FROM kai.limitation_snapshot_entries")) {
        const [snapshotId] = params;
        return {
          rows: state.limitationSnapshotEntries
            .filter((e) => e.limitation_snapshot_id === snapshotId)
            .map((e) => ({ claim_id: e.claim_id, evidence_item_id: e.evidence_item_id, limitation_codes: e.limitation_codes })),
        };
      }
      if (s.includes("FROM kai.generated_content_blocks") && s.includes("ORDER BY ordinal ASC") && !s.includes("JOIN")) {
        const [organizationId, draftId] = params;
        return { rows: state.blocks.filter((b) => b.organization_id === organizationId && b.generated_content_draft_id === draftId) };
      }
      if (s.includes("JOIN kai.generated_content_citations c") && s.includes("JOIN kai.evidence_items e")) {
        const [organizationId, draftId] = params;
        const blockIds = new Set(
          state.blocks.filter((b) => b.organization_id === organizationId && b.generated_content_draft_id === draftId)
            .map((b) => b.generated_content_block_id),
        );
        return {
          rows: state.citations
            .filter((c) => blockIds.has(c.generated_content_block_id))
            .map((c) => ({
              generated_content_block_id: c.generated_content_block_id,
              claim_id: c.claim_id,
              evidence_item_id: c.evidence_item_id,
              source_id: c.source_id,
              source_version_id: c.source_version_id,
            })),
        };
      }
      if (s.includes("FROM kai.export_candidates") && s.includes("canonical_fingerprint = $4")) {
        const [organizationId, draftId, requestedAudience, fingerprint] = params;
        const row = state.exportCandidates.find((c) => c.organization_id === organizationId
          && c.generated_content_draft_id === draftId
          && c.requested_audience === requestedAudience
          && c.canonical_fingerprint === fingerprint);
        return { rows: row ? [{ export_candidate_id: row.export_candidate_id, limitation_snapshot_id: row.limitation_snapshot_id }] : [] };
      }
      if (s.includes("FROM kai.export_candidates") && s.includes("export_candidate_id = $2::uuid")) {
        const [organizationId, candidateId] = params;
        const row = state.exportCandidates.find((c) => c.organization_id === organizationId && c.export_candidate_id === candidateId);
        return { rows: row ? [row] : [] };
      }
      if (s.includes("FROM kai.limitation_snapshots") && s.includes("limitation_snapshot_id = $2::uuid")) {
        const [organizationId, snapshotId] = params;
        const row = state.limitationSnapshots.find((snap) => snap.organization_id === organizationId && snap.limitation_snapshot_id === snapshotId);
        return { rows: row ? [{ limitation_snapshot_id: row.limitation_snapshot_id }] : [] };
      }
      if (s.includes("supersedes_snapshot_id = $1::uuid") && s.includes("LIMIT 1")) {
        const [snapshotId] = params;
        const has = state.limitationSnapshots.some((snap) => snap.supersedes_snapshot_id === snapshotId);
        return { rows: has ? [{ "?column?": 1 }] : [] };
      }
      if (s.includes("FROM kai.human_authority_decisions d")) {
        const [organizationId, candidateId, decisionType] = params;
        const heads = state.humanAuthorityDecisions.filter((d) => d.organization_id === organizationId
          && d.export_candidate_id === candidateId
          && d.decision_type === decisionType
          && !state.humanAuthorityDecisions.some((succ) => succ.supersedes_decision_id === d.decision_id));
        return { rows: heads.map((h) => ({ decision_id: h.decision_id, decision_action: h.decision_action })) };
      }
      throw new Error(`unhandled fake query: ${s}`);
    },
  };
}

function computeFingerprint(state, requestedAudience = "internal") {
  const blocks = state.blocks.map((b) => ({
    ordinal: b.ordinal,
    text: b.text,
    citations: state.citations.filter((c) => c.generated_content_block_id === b.generated_content_block_id),
  }));
  const representation = buildCanonicalRepresentation({
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
    contentType: state.draft.content_type,
    requestedAudience,
    blocks,
    snapshotEntries: state.limitationSnapshotEntries,
  });
  return canonicalFingerprint(representation);
}

test("1. Pre-candidate: no export_candidates row exists yet - resolves exportCandidateId: null, a normal read result", async () => {
  const state = makeState();
  const result = await readCurrentExportCandidateForDraftInTransaction(makeTx(state), {
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
    requestedAudience: "internal",
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.exportCandidateId, null);
});

test("2. Current candidate: a candidate whose fingerprint matches current governed state resolves exactly", async () => {
  const state = makeState();
  const fingerprint = computeFingerprint(state);
  state.exportCandidates.push({
    export_candidate_id: CANDIDATE_A,
    organization_id: ORG,
    generated_content_draft_id: DRAFT,
    content_type: "evidence_summary",
    requested_audience: "internal",
    limitation_snapshot_id: SNAPSHOT,
    canonical_fingerprint: fingerprint,
  });
  const result = await readCurrentExportCandidateForDraftInTransaction(makeTx(state), {
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
    requestedAudience: "internal",
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.exportCandidateId, CANDIDATE_A);
});

test("5. Stale candidate: governed state changes (block text mutated) - candidate A no longer resolves, and there is no fallback to A", async () => {
  const state = makeState();
  const originalFingerprint = computeFingerprint(state);
  state.exportCandidates.push({
    export_candidate_id: CANDIDATE_A,
    organization_id: ORG,
    generated_content_draft_id: DRAFT,
    content_type: "evidence_summary",
    requested_audience: "internal",
    limitation_snapshot_id: SNAPSHOT,
    canonical_fingerprint: originalFingerprint,
  });

  // Mutate current governed state - the block text KAI would regenerate
  // differently, without any new limitation snapshot needed (citation pairs
  // unchanged).
  state.blocks[0].text = "Revised governed block text after regeneration.";

  const result = await readCurrentExportCandidateForDraftInTransaction(makeTx(state), {
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
    requestedAudience: "internal",
  });
  assert.equal(result.ok, true);
  assert.notEqual(result.data.exportCandidateId, CANDIDATE_A);
  assert.equal(result.data.exportCandidateId, null);
});

test("6. Replacement candidate B: persisted for the new canonical fingerprint - B resolves, A remains untouched immutable history", async () => {
  const state = makeState();
  const originalFingerprint = computeFingerprint(state);
  state.exportCandidates.push({
    export_candidate_id: CANDIDATE_A,
    organization_id: ORG,
    generated_content_draft_id: DRAFT,
    content_type: "evidence_summary",
    requested_audience: "internal",
    limitation_snapshot_id: SNAPSHOT,
    canonical_fingerprint: originalFingerprint,
  });

  state.blocks[0].text = "Revised governed block text after regeneration.";
  const newFingerprint = computeFingerprint(state);
  state.exportCandidates.push({
    export_candidate_id: CANDIDATE_B,
    organization_id: ORG,
    generated_content_draft_id: DRAFT,
    content_type: "evidence_summary",
    requested_audience: "internal",
    limitation_snapshot_id: SNAPSHOT,
    canonical_fingerprint: newFingerprint,
  });

  const result = await readCurrentExportCandidateForDraftInTransaction(makeTx(state), {
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
    requestedAudience: "internal",
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.exportCandidateId, CANDIDATE_B);

  // Candidate A's own row is untouched, immutable history.
  const candidateARow = state.exportCandidates.find((c) => c.export_candidate_id === CANDIDATE_A);
  assert.equal(candidateARow.canonical_fingerprint, originalFingerprint);
});

test("7. Authority isolation: a grant recorded against stale candidate A never authorizes replacement candidate B; granting B independently makes B effective", async () => {
  const state = makeState();
  const originalFingerprint = computeFingerprint(state);
  state.exportCandidates.push({
    export_candidate_id: CANDIDATE_A,
    organization_id: ORG,
    generated_content_draft_id: DRAFT,
    content_type: "evidence_summary",
    requested_audience: "internal",
    limitation_snapshot_id: SNAPSHOT,
    canonical_fingerprint: originalFingerprint,
  });
  state.humanAuthorityDecisions.push({
    decision_id: "00000000-0000-4000-8000-000000001401",
    organization_id: ORG,
    export_candidate_id: CANDIDATE_A,
    decision_type: "export_authority_granted",
    decision_action: "grant",
    supersedes_decision_id: null,
  });

  state.blocks[0].text = "Revised governed block text after regeneration.";
  const newFingerprint = computeFingerprint(state);
  state.exportCandidates.push({
    export_candidate_id: CANDIDATE_B,
    organization_id: ORG,
    generated_content_draft_id: DRAFT,
    content_type: "evidence_summary",
    requested_audience: "internal",
    limitation_snapshot_id: SNAPSHOT,
    canonical_fingerprint: newFingerprint,
  });

  const tx = makeTx(state);
  const effectivenessForB = await evaluateHumanAuthorityEffectivenessInTransaction(tx, {
    organizationId: ORG,
    exportCandidateId: CANDIDATE_B,
    decisionType: "export_authority_granted",
  });
  assert.equal(effectivenessForB.ok, true);
  assert.equal(effectivenessForB.data.effective, false);
  assert.equal(effectivenessForB.data.reason, "no_decision");

  state.humanAuthorityDecisions.push({
    decision_id: "00000000-0000-4000-8000-000000001402",
    organization_id: ORG,
    export_candidate_id: CANDIDATE_B,
    decision_type: "export_authority_granted",
    decision_action: "grant",
    supersedes_decision_id: null,
  });
  const effectivenessForBAfterGrant = await evaluateHumanAuthorityEffectivenessInTransaction(tx, {
    organizationId: ORG,
    exportCandidateId: CANDIDATE_B,
    decisionType: "export_authority_granted",
  });
  assert.equal(effectivenessForBAfterGrant.ok, true);
  assert.equal(effectivenessForBAfterGrant.data.effective, true);
});

test("negative proof: the resolver never orders/limits over export_candidates history - no ORDER BY created_at, MAX(created_at), or LIMIT 1 candidate selection", () => {
  const source = readFileSync(new URL("../Backend/kai/dictionary/postgresExportCandidateRepository.js", import.meta.url), "utf8");
  const start = source.indexOf("export async function readCurrentExportCandidateForDraftInTransaction");
  const end = source.indexOf("export function createPostgresExportCandidateRepository");
  const slice = source.slice(start, end);
  assert.ok(start > -1 && end > start);
  assert.doesNotMatch(slice, /ORDER BY created_at|MAX\(\s*created_at|LIMIT\s+1/i);
  assert.match(slice, /loadExistingExportCandidate/);
  assert.match(slice, /requestedAudience,\s*\n\s*fingerprint,/);
});

test("resolver rejects malformed input and never queries", async () => {
  const tx = { async query() { throw new Error("must not query"); } };
  const badOrg = await readCurrentExportCandidateForDraftInTransaction(tx, {
    organizationId: "not-a-uuid",
    generatedContentDraftId: DRAFT,
    requestedAudience: "internal",
  });
  assert.equal(badOrg.ok, false);
  assert.equal(badOrg.error.code, "validation_blocker");

  const badAudience = await readCurrentExportCandidateForDraftInTransaction(tx, {
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
    requestedAudience: "not-a-real-audience",
  });
  assert.equal(badAudience.ok, false);
  assert.equal(badAudience.error.code, "validation_blocker");
});
