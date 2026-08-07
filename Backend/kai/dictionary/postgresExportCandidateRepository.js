import crypto from "node:crypto";

import { withTransaction } from "../db/kaiDb.js";
import {
  LIMITATION_SNAPSHOT_ALLOWED_ROLES,
  EXPORT_CANDIDATE_CONTENT_TYPE,
  EXPORT_CANDIDATE_AUDIENCES,
  EXPORT_CANDIDATE_FINGERPRINT_CONTRACT_VERSION,
  LIMITATION_SNAPSHOT_AUDIT_OPERATION,
  LIMITATION_SNAPSHOT_AUDIT_CONTRACT,
  EXPORT_CANDIDATE_AUDIT_OPERATION,
  EXPORT_CANDIDATE_AUDIT_CONTRACT,
  isLimitationCodeSet,
} from "./exportCandidateContract.js";
import { GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES } from "./generatedContentReviewQueueContract.js";
import { EXPORT_REVIEW_LIFECYCLE_PROFILES } from "./exportReviewQueueContract.js";

const RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
  system_error: 500,
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_LOWER_PATTERN = /^[0-9a-f]{64}$/;

const GENERATED_CONTENT_REVIEW_RESOLVED_PROFILE = GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES[2];
const EXPORT_REVIEW_RESOLVED_PROFILE = EXPORT_REVIEW_LIFECYCLE_PROFILES[2];

function failure(code) {
  return { ok: false, data: null, error: { code, status: RESULT_STATUS[code] || 500 } };
}

function success(data) {
  return { ok: true, data, error: null };
}

export class RollbackResultError extends Error {
  constructor(result) {
    super("rollback export-candidate transaction");
    this.name = "RollbackResultError";
    this.result = result;
  }
}

function rollbackFailure(code) {
  throw new RollbackResultError(failure(code));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hasExactKeys(value, allowed) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

function hasOnlyAllowedKeys(value, allowedKeys) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).every((key) => allowedKeys.has(key));
}

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== "string") return false;
  let normalized = null;
  try {
    normalized = new Date(value).toISOString();
  } catch {
    return false;
  }
  return normalized === value;
}

function pairKey(claimId, evidenceItemId) {
  return `${claimId}:${evidenceItemId}`;
}

function sortByPairKey(list, claimIdKey, evidenceItemIdKey) {
  return [...list].sort((a, b) => {
    const ak = pairKey(a[claimIdKey], a[evidenceItemIdKey]);
    const bk = pairKey(b[claimIdKey], b[evidenceItemIdKey]);
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });
}

function canonicalEntriesFingerprint(entries) {
  const normalized = sortByPairKey(
    entries.map((entry) => ({
      claimId: entry.claimId,
      evidenceItemId: entry.evidenceItemId,
      limitationCodes: [...new Set(entry.limitationCodes)].sort(),
    })),
    "claimId",
    "evidenceItemId",
  );
  return crypto.createHash("sha256").update(canonicalJson(normalized)).digest("hex");
}

// ---------------------------------------------------------------------------
// Limitation snapshot confirmation (OWNER_DECISION.P3_EXPORT_LIMITATION_SNAPSHOT_V1)
// ---------------------------------------------------------------------------

function validateConfirmLimitationSnapshotInput(input) {
  if (!hasExactKeys(input, new Set([
    "organizationId",
    "generatedContentDraftId",
    "entries",
    "actorContext",
    "now",
  ]))) return false;
  if (!UUID_PATTERN.test(input.organizationId)) return false;
  if (!UUID_PATTERN.test(input.generatedContentDraftId)) return false;
  if (!Array.isArray(input.entries) || input.entries.length < 1) return false;
  const entryKeys = new Set(["claimId", "evidenceItemId", "limitationCodes"]);
  const seen = new Set();
  for (const entry of input.entries) {
    if (!hasExactKeys(entry, entryKeys)) return false;
    if (!UUID_PATTERN.test(entry.claimId) || !UUID_PATTERN.test(entry.evidenceItemId)) return false;
    if (!isLimitationCodeSet(entry.limitationCodes)) return false;
    const key = pairKey(entry.claimId, entry.evidenceItemId);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  if (!Boolean(input.actorContext) || typeof input.actorContext !== "object" || Array.isArray(input.actorContext)) return false;
  return isCanonicalUtcTimestamp(input.now);
}

function deriveConfirmedByRole(actorContext, organizationId) {
  const memberships = (actorContext?.organizationMemberships || []).filter(
    (membership) => String(membership.organization_id) === String(organizationId)
      && membership.membership_status === "active"
      && LIMITATION_SNAPSHOT_ALLOWED_ROLES.includes(membership.role_name),
  );
  return memberships[0]?.role_name || null;
}

async function loadCitedPairs(tx, { organizationId, generatedContentDraftId }) {
  const { rows } = await tx.query(
    `SELECT DISTINCT c.claim_id::text AS claim_id, c.evidence_item_id::text AS evidence_item_id
       FROM kai.generated_content_blocks b
       JOIN kai.generated_content_citations c
         ON c.generated_content_block_id = b.generated_content_block_id
      WHERE b.organization_id = $1::uuid AND b.generated_content_draft_id = $2::uuid`,
    [organizationId, generatedContentDraftId],
  );
  return rows;
}

function validateEntriesCoverExactCitedPairs(entries, citedPairs) {
  const citedKeys = new Set(citedPairs.map((pair) => pairKey(pair.claim_id, pair.evidence_item_id)));
  const enteredKeys = entries.map((entry) => pairKey(entry.claimId, entry.evidenceItemId));
  if (enteredKeys.length !== citedKeys.size) return false;
  return enteredKeys.every((key) => citedKeys.has(key));
}

async function loadDraftRow(tx, { organizationId, generatedContentDraftId }) {
  const { rows } = await tx.query(
    `SELECT generated_content_draft_id::text AS generated_content_draft_id,
            organization_id::text AS organization_id, content_type, requested_audience, draft_status
       FROM kai.generated_content_drafts
      WHERE organization_id = $1::uuid AND generated_content_draft_id = $2::uuid`,
    [organizationId, generatedContentDraftId],
  );
  return rows[0] || null;
}

async function loadCurrentSnapshotForUpdate(tx, { organizationId, generatedContentDraftId }) {
  const { rows } = await tx.query(
    `SELECT limitation_snapshot_id::text AS limitation_snapshot_id,
            organization_id::text AS organization_id,
            generated_content_draft_id::text AS generated_content_draft_id,
            confirmed_by::text AS confirmed_by, confirmed_by_role, entries_fingerprint
       FROM kai.limitation_snapshots
      WHERE organization_id = $1::uuid AND generated_content_draft_id = $2::uuid
        AND superseded_by_snapshot_id IS NULL
      FOR UPDATE`,
    [organizationId, generatedContentDraftId],
  );
  return rows[0] || null;
}

async function loadAuditFileContext(tx, { organizationId, generatedContentDraftId }) {
  const { rows } = await tx.query(
    `SELECT f.intake_file_id::text AS intake_file_id, f.upload_state
       FROM kai.generated_content_blocks b
       JOIN kai.generated_content_citations c
         ON c.generated_content_block_id = b.generated_content_block_id
       JOIN kai.evidence_items e
         ON e.organization_id = c.organization_id AND e.evidence_item_id = c.evidence_item_id
       JOIN kai.source_versions sv
         ON sv.organization_id = e.organization_id AND sv.source_version_id = e.source_version_id
       JOIN kai.intake_source_candidates isc
         ON isc.organization_id = sv.organization_id AND isc.intake_source_candidate_id = sv.intake_source_candidate_id
       JOIN kai.intake_files f
         ON f.organization_id = isc.organization_id AND f.intake_file_id = isc.intake_file_id
      WHERE b.organization_id = $1::uuid AND b.generated_content_draft_id = $2::uuid
      ORDER BY b.ordinal ASC, c.claim_id ASC
      LIMIT 1`,
    [organizationId, generatedContentDraftId],
  );
  return rows[0] || null;
}

function buildLimitationSnapshotAuditMetadata({ input, limitationSnapshotId, supersededSnapshotId, confirmedByRole, citedPairCount, entriesFingerprint }) {
  return {
    contract: LIMITATION_SNAPSHOT_AUDIT_CONTRACT,
    organization_id: input.organizationId,
    generated_content_draft_id: input.generatedContentDraftId,
    limitation_snapshot_id: limitationSnapshotId,
    superseded_snapshot_id: supersededSnapshotId,
    actor_id: input.actorContext.actorUserId,
    actor_type: "human",
    confirmed_by_role: confirmedByRole,
    cited_pair_count: citedPairCount,
    entries_fingerprint: entriesFingerprint,
    confirmation_timestamp: input.now,
  };
}

async function insertLimitationSnapshotAudit(tx, { input, auditFileContext, metadata }) {
  await tx.query(
    `INSERT INTO kai.upload_lifecycle_audit (
       organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
     )
     VALUES ($1::uuid,$2::uuid,$3,$4,$4,'success',$5::jsonb,$6::timestamptz)`,
    [
      input.organizationId,
      auditFileContext.intake_file_id,
      LIMITATION_SNAPSHOT_AUDIT_OPERATION,
      auditFileContext.upload_state,
      JSON.stringify(metadata),
      input.now,
    ],
  );
}

function toConfirmLimitationSnapshotResult({ limitationSnapshotId, supersededSnapshotId, confirmedByRole, citedPairCount, entriesFingerprint, replayed }) {
  return {
    limitationSnapshotId,
    supersededSnapshotId,
    confirmedByRole,
    citedPairCount,
    entriesFingerprint,
    replayed,
  };
}

// ---------------------------------------------------------------------------
// Export candidate creation (OWNER_DECISION.P3_EXPORT_CANDIDATE_V1)
// ---------------------------------------------------------------------------

function validateCreateExportCandidateInput(input) {
  if (!hasExactKeys(input, new Set([
    "organizationId",
    "generatedContentDraftId",
    "actorContext",
    "now",
  ]))) return false;
  if (!UUID_PATTERN.test(input.organizationId)) return false;
  if (!UUID_PATTERN.test(input.generatedContentDraftId)) return false;
  if (!Boolean(input.actorContext) || typeof input.actorContext !== "object" || Array.isArray(input.actorContext)) return false;
  return isCanonicalUtcTimestamp(input.now);
}

async function loadResolvedQueueRow(tx, { organizationId, generatedContentDraftId, queueType, resolvedProfile }) {
  const { rows } = await tx.query(
    `SELECT queue_status, review_status
       FROM kai.review_queue_items
      WHERE organization_id = $1::uuid
        AND queue_type = $2
        AND target_object_type = 'generated_content_draft'
        AND target_object_id = $3::uuid`,
    [organizationId, queueType, generatedContentDraftId],
  );
  const row = rows[0];
  return Boolean(row)
    && row.queue_status === resolvedProfile.queueStatus
    && row.review_status === resolvedProfile.reviewStatus;
}

async function loadCurrentSnapshotWithEntries(tx, { organizationId, generatedContentDraftId }) {
  const snapshotRows = await tx.query(
    `SELECT limitation_snapshot_id::text AS limitation_snapshot_id
       FROM kai.limitation_snapshots
      WHERE organization_id = $1::uuid AND generated_content_draft_id = $2::uuid
        AND superseded_by_snapshot_id IS NULL`,
    [organizationId, generatedContentDraftId],
  );
  const snapshot = snapshotRows.rows[0];
  if (!snapshot) return null;
  const entryRows = await tx.query(
    `SELECT claim_id::text AS claim_id, evidence_item_id::text AS evidence_item_id, limitation_codes
       FROM kai.limitation_snapshot_entries
      WHERE limitation_snapshot_id = $1::uuid
      ORDER BY claim_id ASC, evidence_item_id ASC`,
    [snapshot.limitation_snapshot_id],
  );
  return { limitationSnapshotId: snapshot.limitation_snapshot_id, entries: entryRows.rows };
}

async function loadCanonicalGraph(tx, { organizationId, generatedContentDraftId }) {
  const blockRows = await tx.query(
    `SELECT generated_content_block_id::text AS generated_content_block_id, ordinal, text
       FROM kai.generated_content_blocks
      WHERE organization_id = $1::uuid AND generated_content_draft_id = $2::uuid
      ORDER BY ordinal ASC`,
    [organizationId, generatedContentDraftId],
  );
  const citationRows = await tx.query(
    `SELECT b.generated_content_block_id::text AS generated_content_block_id,
            c.claim_id::text AS claim_id, c.evidence_item_id::text AS evidence_item_id,
            e.source_id::text AS source_id, e.source_version_id::text AS source_version_id
       FROM kai.generated_content_blocks b
       JOIN kai.generated_content_citations c
         ON c.generated_content_block_id = b.generated_content_block_id
       JOIN kai.evidence_items e
         ON e.organization_id = c.organization_id AND e.evidence_item_id = c.evidence_item_id
      WHERE b.organization_id = $1::uuid AND b.generated_content_draft_id = $2::uuid`,
    [organizationId, generatedContentDraftId],
  );
  const citationsByBlock = new Map();
  for (const citation of citationRows.rows) {
    if (!citationsByBlock.has(citation.generated_content_block_id)) citationsByBlock.set(citation.generated_content_block_id, []);
    citationsByBlock.get(citation.generated_content_block_id).push(citation);
  }
  return blockRows.rows.map((block) => ({
    ordinal: block.ordinal,
    text: block.text,
    citations: sortByPairKey(citationsByBlock.get(block.generated_content_block_id) || [], "claim_id", "evidence_item_id"),
  }));
}

function buildCanonicalRepresentation({ organizationId, generatedContentDraftId, contentType, requestedAudience, blocks, snapshotEntries }) {
  const citedPairs = new Set();
  for (const block of blocks) {
    for (const citation of block.citations) citedPairs.add(pairKey(citation.claim_id, citation.evidence_item_id));
  }
  const snapshotPairs = new Set(snapshotEntries.map((entry) => pairKey(entry.claim_id, entry.evidence_item_id)));
  if (citedPairs.size !== snapshotPairs.size) return null;
  for (const key of citedPairs) if (!snapshotPairs.has(key)) return null;

  const limitations = sortByPairKey(
    snapshotEntries.map((entry) => ({
      claimId: entry.claim_id,
      evidenceItemId: entry.evidence_item_id,
      limitationCodes: [...new Set(entry.limitation_codes)].sort(),
    })),
    "claimId",
    "evidenceItemId",
  );

  return {
    organizationId,
    generatedContentDraftId,
    contentType,
    requestedAudience,
    blocks: blocks.map((block) => ({
      ordinal: block.ordinal,
      text: block.text,
      citations: sortByPairKey(block.citations, "claim_id", "evidence_item_id").map((citation) => ({
        claimId: citation.claim_id,
        evidenceItemId: citation.evidence_item_id,
        sourceId: citation.source_id,
        sourceVersionId: citation.source_version_id,
      })),
    })),
    limitations,
  };
}

function canonicalFingerprint(representation) {
  return crypto.createHash("sha256").update(canonicalJson(representation)).digest("hex");
}

async function insertExportCandidate(tx, { candidateId, input, draft, limitationSnapshotId, fingerprint }) {
  const { rows } = await tx.query(
    `INSERT INTO kai.export_candidates (
       export_candidate_id, organization_id, generated_content_draft_id, content_type,
       requested_audience, limitation_snapshot_id, fingerprint_contract_version,
       canonical_fingerprint, created_by, created_by_type, created_at
     )
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,$7,$8,$9::uuid,'human',$10::timestamptz)
     ON CONFLICT (organization_id, generated_content_draft_id, requested_audience, canonical_fingerprint) DO NOTHING
     RETURNING export_candidate_id::text AS export_candidate_id`,
    [
      candidateId,
      input.organizationId,
      input.generatedContentDraftId,
      draft.content_type,
      draft.requested_audience,
      limitationSnapshotId,
      EXPORT_CANDIDATE_FINGERPRINT_CONTRACT_VERSION,
      fingerprint,
      input.actorContext.actorUserId,
      input.now,
    ],
  );
  return rows[0] || null;
}

async function loadExistingExportCandidate(tx, { organizationId, generatedContentDraftId, requestedAudience, fingerprint }) {
  const { rows } = await tx.query(
    `SELECT export_candidate_id::text AS export_candidate_id, limitation_snapshot_id::text AS limitation_snapshot_id
       FROM kai.export_candidates
      WHERE organization_id = $1::uuid AND generated_content_draft_id = $2::uuid
        AND requested_audience = $3 AND canonical_fingerprint = $4`,
    [organizationId, generatedContentDraftId, requestedAudience, fingerprint],
  );
  return rows[0] || null;
}

function buildExportCandidateAuditMetadata({ input, draft, exportCandidateId, limitationSnapshotId, fingerprint, citedPairCount, blockCount }) {
  return {
    contract: EXPORT_CANDIDATE_AUDIT_CONTRACT,
    organization_id: input.organizationId,
    generated_content_draft_id: input.generatedContentDraftId,
    export_candidate_id: exportCandidateId,
    requested_audience: draft.requested_audience,
    limitation_snapshot_id: limitationSnapshotId,
    fingerprint_contract_version: EXPORT_CANDIDATE_FINGERPRINT_CONTRACT_VERSION,
    canonical_fingerprint: fingerprint,
    actor_id: input.actorContext.actorUserId,
    actor_type: "human",
    cited_pair_count: citedPairCount,
    block_count: blockCount,
    creation_timestamp: input.now,
  };
}

async function insertExportCandidateAudit(tx, { input, auditFileContext, metadata }) {
  await tx.query(
    `INSERT INTO kai.upload_lifecycle_audit (
       organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
     )
     VALUES ($1::uuid,$2::uuid,$3,$4,$4,'success',$5::jsonb,$6::timestamptz)`,
    [
      input.organizationId,
      auditFileContext.intake_file_id,
      EXPORT_CANDIDATE_AUDIT_OPERATION,
      auditFileContext.upload_state,
      JSON.stringify(metadata),
      input.now,
    ],
  );
}

// ---------------------------------------------------------------------------
// Private, read-only currentness evaluator. Not wired into VAL-EXP-001.
// ---------------------------------------------------------------------------

async function evaluateExportCandidateCurrentnessInTransaction(tx, { organizationId, exportCandidateId }) {
  const { rows } = await tx.query(
    `SELECT export_candidate_id::text AS export_candidate_id, organization_id::text AS organization_id,
            generated_content_draft_id::text AS generated_content_draft_id, content_type, requested_audience,
            limitation_snapshot_id::text AS limitation_snapshot_id, canonical_fingerprint
       FROM kai.export_candidates
      WHERE organization_id = $1::uuid AND export_candidate_id = $2::uuid`,
    [organizationId, exportCandidateId],
  );
  const candidate = rows[0];
  if (!candidate) return failure("not_found");

  const supersededRows = await tx.query(
    `SELECT superseded_by_snapshot_id::text AS superseded_by_snapshot_id
       FROM kai.limitation_snapshots
      WHERE organization_id = $1::uuid AND limitation_snapshot_id = $2::uuid`,
    [organizationId, candidate.limitation_snapshot_id],
  );
  if (!supersededRows.rows[0]) return success({ current: false, reason: "limitation_snapshot_missing" });
  if (supersededRows.rows[0].superseded_by_snapshot_id !== null) {
    return success({ current: false, reason: "limitation_snapshot_superseded" });
  }

  const draftRow = await loadDraftRow(tx, {
    organizationId: candidate.organization_id,
    generatedContentDraftId: candidate.generated_content_draft_id,
  });
  if (!draftRow) return success({ current: false, reason: "draft_missing" });

  const snapshot = await loadCurrentSnapshotWithEntries(tx, {
    organizationId: candidate.organization_id,
    generatedContentDraftId: candidate.generated_content_draft_id,
  });
  if (!snapshot || snapshot.limitationSnapshotId !== candidate.limitation_snapshot_id) {
    return success({ current: false, reason: "limitation_snapshot_superseded" });
  }

  const blocks = await loadCanonicalGraph(tx, {
    organizationId: candidate.organization_id,
    generatedContentDraftId: candidate.generated_content_draft_id,
  });
  const representation = buildCanonicalRepresentation({
    organizationId: candidate.organization_id,
    generatedContentDraftId: candidate.generated_content_draft_id,
    contentType: draftRow.content_type,
    requestedAudience: draftRow.requested_audience,
    blocks,
    snapshotEntries: snapshot.entries,
  });
  if (!representation) return success({ current: false, reason: "cited_pair_mismatch" });
  if (representation.requestedAudience !== candidate.requested_audience) {
    return success({ current: false, reason: "requested_audience_changed" });
  }

  const recomputedFingerprint = canonicalFingerprint(representation);
  if (recomputedFingerprint !== candidate.canonical_fingerprint) {
    return success({ current: false, reason: "fingerprint_mismatch" });
  }
  return success({ current: true, reason: null });
}

export function createPostgresExportCandidateRepository({ runInTransaction = withTransaction } = {}) {
  return Object.freeze({
    async confirmLimitationSnapshot(input, dependencies = {}) {
      if (!validateConfirmLimitationSnapshotInput(input)) return failure("validation_blocker");
      if (!dependencies.metadataOnlyAudit) return failure("validation_blocker");
      const confirmedByRole = deriveConfirmedByRole(input.actorContext, input.organizationId);
      if (!confirmedByRole) return failure("validation_blocker");

      try {
        return await runInTransaction(async (tx) => {
          const draft = await loadDraftRow(tx, input);
          if (!draft) return failure("not_found");

          const citedPairs = await loadCitedPairs(tx, input);
          if (citedPairs.length === 0) return failure("validation_blocker");
          if (!validateEntriesCoverExactCitedPairs(input.entries, citedPairs)) return failure("validation_blocker");

          const entriesFingerprint = canonicalEntriesFingerprint(input.entries);
          const existing = await loadCurrentSnapshotForUpdate(tx, input);

          if (existing && existing.entries_fingerprint === entriesFingerprint) {
            return success(toConfirmLimitationSnapshotResult({
              limitationSnapshotId: existing.limitation_snapshot_id,
              supersededSnapshotId: null,
              confirmedByRole: existing.confirmed_by_role,
              citedPairCount: citedPairs.length,
              entriesFingerprint,
              replayed: true,
            }));
          }

          const newSnapshotId = crypto.randomUUID();
          let supersededSnapshotId = null;
          if (existing) {
            const updateResult = await tx.query(
              `UPDATE kai.limitation_snapshots
                  SET superseded_by_snapshot_id = $1::uuid
                WHERE organization_id = $2::uuid
                  AND limitation_snapshot_id = $3::uuid
                  AND superseded_by_snapshot_id IS NULL`,
              [newSnapshotId, input.organizationId, existing.limitation_snapshot_id],
            );
            if (updateResult.rowCount !== 1) rollbackFailure("conflict_current_state_changed");
            supersededSnapshotId = existing.limitation_snapshot_id;
          }

          await tx.query(
            `INSERT INTO kai.limitation_snapshots (
               limitation_snapshot_id, organization_id, generated_content_draft_id,
               confirmed_by, confirmed_by_role, entries_fingerprint, created_by_type, created_at
             )
             VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,'human',$7::timestamptz)`,
            [
              newSnapshotId,
              input.organizationId,
              input.generatedContentDraftId,
              input.actorContext.actorUserId,
              confirmedByRole,
              entriesFingerprint,
              input.now,
            ],
          );
          for (const entry of input.entries) {
            await tx.query(
              `INSERT INTO kai.limitation_snapshot_entries (
                 limitation_snapshot_id, organization_id, claim_id, evidence_item_id, limitation_codes, created_at
               )
               VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text[],$6::timestamptz)`,
              [newSnapshotId, input.organizationId, entry.claimId, entry.evidenceItemId, entry.limitationCodes, input.now],
            );
          }

          const auditFileContext = await loadAuditFileContext(tx, input);
          if (!auditFileContext) rollbackFailure("system_error");

          const preparedAudit = dependencies.metadataOnlyAudit.prepareMetadataOnlyAudit?.({
            payload: {
              attempted_operation: LIMITATION_SNAPSHOT_AUDIT_OPERATION,
              actor_type: "human",
              object_type: "limitation_snapshot",
              request_scope: "organization_generated_content_draft",
              contract: LIMITATION_SNAPSHOT_AUDIT_CONTRACT,
            },
          });
          if (!preparedAudit || preparedAudit.ok !== true || typeof preparedAudit.publish !== "function") {
            rollbackFailure("system_error");
          }
          const metadata = buildLimitationSnapshotAuditMetadata({
            input,
            limitationSnapshotId: newSnapshotId,
            supersededSnapshotId,
            confirmedByRole,
            citedPairCount: citedPairs.length,
            entriesFingerprint,
          });
          await insertLimitationSnapshotAudit(tx, { input, auditFileContext, metadata });
          await preparedAudit.publish();

          return success(toConfirmLimitationSnapshotResult({
            limitationSnapshotId: newSnapshotId,
            supersededSnapshotId,
            confirmedByRole,
            citedPairCount: citedPairs.length,
            entriesFingerprint,
            replayed: false,
          }));
        });
      } catch (error) {
        if (error instanceof RollbackResultError) return error.result;
        if (error?.code === "23505") return failure("conflict_current_state_changed");
        if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") return failure("validation_blocker");
        if (error?.code === "25001") return failure("conflict_current_state_changed");
        return failure("system_error");
      }
    },

    async createExportCandidate(input, dependencies = {}) {
      if (!validateCreateExportCandidateInput(input)) return failure("validation_blocker");
      if (!dependencies.metadataOnlyAudit) return failure("validation_blocker");

      try {
        return await runInTransaction(async (tx) => {
          const draft = await loadDraftRow(tx, input);
          if (!draft) return failure("not_found");
          if (draft.content_type !== EXPORT_CANDIDATE_CONTENT_TYPE) return failure("conflict_current_state_changed");
          if (!EXPORT_CANDIDATE_AUDIENCES.includes(draft.requested_audience)) return failure("conflict_current_state_changed");

          const generatedContentResolved = await loadResolvedQueueRow(tx, {
            organizationId: input.organizationId,
            generatedContentDraftId: input.generatedContentDraftId,
            queueType: "generated_content_review",
            resolvedProfile: GENERATED_CONTENT_REVIEW_RESOLVED_PROFILE,
          });
          if (!generatedContentResolved) return failure("conflict_current_state_changed");

          const exportReviewResolved = await loadResolvedQueueRow(tx, {
            organizationId: input.organizationId,
            generatedContentDraftId: input.generatedContentDraftId,
            queueType: "export_review",
            resolvedProfile: EXPORT_REVIEW_RESOLVED_PROFILE,
          });
          if (!exportReviewResolved) return failure("conflict_current_state_changed");

          const snapshot = await loadCurrentSnapshotWithEntries(tx, input);
          if (!snapshot) return failure("conflict_current_state_changed");

          const blocks = await loadCanonicalGraph(tx, input);
          if (blocks.length === 0) return failure("conflict_current_state_changed");

          const representation = buildCanonicalRepresentation({
            organizationId: input.organizationId,
            generatedContentDraftId: input.generatedContentDraftId,
            contentType: draft.content_type,
            requestedAudience: draft.requested_audience,
            blocks,
            snapshotEntries: snapshot.entries,
          });
          if (!representation) return failure("conflict_current_state_changed");

          const fingerprint = canonicalFingerprint(representation);
          const candidateId = crypto.randomUUID();
          const inserted = await insertExportCandidate(tx, {
            candidateId,
            input,
            draft,
            limitationSnapshotId: snapshot.limitationSnapshotId,
            fingerprint,
          });

          const citedPairCount = representation.limitations.length;
          const blockCount = representation.blocks.length;

          if (!inserted) {
            const existingCandidate = await loadExistingExportCandidate(tx, {
              organizationId: input.organizationId,
              generatedContentDraftId: input.generatedContentDraftId,
              requestedAudience: draft.requested_audience,
              fingerprint,
            });
            if (!existingCandidate) rollbackFailure("system_error");
            return success({
              exportCandidateId: existingCandidate.export_candidate_id,
              generatedContentDraftId: input.generatedContentDraftId,
              requestedAudience: draft.requested_audience,
              limitationSnapshotId: existingCandidate.limitation_snapshot_id,
              canonicalFingerprint: fingerprint,
              replayed: true,
            });
          }

          const auditFileContext = await loadAuditFileContext(tx, input);
          if (!auditFileContext) rollbackFailure("system_error");

          const preparedAudit = dependencies.metadataOnlyAudit.prepareMetadataOnlyAudit?.({
            payload: {
              attempted_operation: EXPORT_CANDIDATE_AUDIT_OPERATION,
              actor_type: "human",
              object_type: "export_candidate",
              request_scope: "organization_generated_content_draft",
              contract: EXPORT_CANDIDATE_AUDIT_CONTRACT,
            },
          });
          if (!preparedAudit || preparedAudit.ok !== true || typeof preparedAudit.publish !== "function") {
            rollbackFailure("system_error");
          }
          const metadata = buildExportCandidateAuditMetadata({
            input,
            draft,
            exportCandidateId: candidateId,
            limitationSnapshotId: snapshot.limitationSnapshotId,
            fingerprint,
            citedPairCount,
            blockCount,
          });
          await insertExportCandidateAudit(tx, { input, auditFileContext, metadata });
          await preparedAudit.publish();

          return success({
            exportCandidateId: candidateId,
            generatedContentDraftId: input.generatedContentDraftId,
            requestedAudience: draft.requested_audience,
            limitationSnapshotId: snapshot.limitationSnapshotId,
            canonicalFingerprint: fingerprint,
            replayed: false,
          });
        });
      } catch (error) {
        if (error instanceof RollbackResultError) return error.result;
        if (error?.code === "23505") return failure("conflict_current_state_changed");
        if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") return failure("validation_blocker");
        if (error?.code === "25001") return failure("conflict_current_state_changed");
        return failure("system_error");
      }
    },
  });
}

export const __exportCandidateRepositoryTestables = Object.freeze({
  validateConfirmLimitationSnapshotInput,
  validateEntriesCoverExactCitedPairs,
  canonicalEntriesFingerprint,
  validateCreateExportCandidateInput,
  buildCanonicalRepresentation,
  canonicalFingerprint,
  deriveConfirmedByRole,
  evaluateExportCandidateCurrentnessInTransaction,
});

export const __exportCandidateRepositoryContract = Object.freeze({
  UUID_PATTERN,
  SHA256_LOWER_PATTERN,
});
