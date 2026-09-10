// P14-09 ASSEMBLED FUNDER EVIDENCE-SUMMARY -> GRANT RESPONSE PACKET
// MEMBERSHIP PROOF
//
// Threads ONE consistent generated-content-draft identity through the REAL,
// unmodified existing services and the REAL postgresGeneratedContentRepository
// transaction code (only the raw `tx.query` SQL boundary is faked, the same
// seam __tests__/kai-sprint2-p14-09-funder-evidence-summary-boundary.spec.js
// and __tests__/kai-sprint2-p3-04-generated-content-review-completion-boundary.spec.js
// already use for the generation/review-lifecycle halves, and
// __tests__/kai-grant-response-packet-boundary.spec.js already uses for the
// membership-read half):
//
//   authoritative funder-eligible governed claim
//     -> createEvidenceSummaryDraft (real service, real repository
//        transaction code, requestedAudience="funder")
//     -> exact engagement_id + requested_audience persisted on the real
//        generation_runs/generated_content_drafts rows
//     -> generated-content review created (open/needs_gk_review)
//     -> startGeneratedContentReview + completeGeneratedContentReview (real
//        service + real repository, the actual resolve mechanism - no
//        hand-written "resolved" row)
//     -> current funder eligibility re-checked (real evaluator, re-run by
//        the real repository code during the packet read)
//     -> getGrantResponsePacket (real service, real repository, real
//        evaluateGrantResponsePacketMembershipInTransaction)
//     -> the exact draft appears as a packet member
//
// No packet membership, review resolution, or eligibility state is ever
// written directly into the fake store by a test - every state transition
// happens by calling the real exported service/repository functions with a
// scripted claim-traceability evaluator (the same injectable seam
// createPostgresGeneratedContentRepository already exposes in production).

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  createEvidenceSummaryDraft,
  createImpactNarrativeDraft,
  startGeneratedContentReview,
  completeGeneratedContentReview,
} from "../Backend/kai/services/kaiGeneratedContentService.js";
import { getGrantResponsePacket } from "../Backend/kai/services/kaiGrantResponsePacketService.js";
import { createPostgresGeneratedContentRepository } from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import { GENERATED_CONTENT_REVIEW_QUEUE_CONTRACT } from "../Backend/kai/dictionary/generatedContentReviewQueueContract.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000501";
const OTHER_ENGAGEMENT = "00000000-0000-4000-8000-000000000502";
const CLAIM = "00000000-0000-4000-8000-000000000101";
const EVIDENCE = "00000000-0000-4000-8000-000000000201";
const SOURCE = "00000000-0000-4000-8000-000000000301";
const SOURCE_VERSION = "00000000-0000-4000-8000-000000000401";
const INTAKE_FILE = "00000000-0000-4000-8000-000000000601";
const NOW = "2026-08-06T10:00:00.000Z";
const LATER = "2026-08-06T10:05:00.000Z";
const LATEST = "2026-08-06T10:10:00.000Z";

const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });

// Reviewer only (NOT gk_admin) - deliberately keeps the actor outside
// EXPORT_REVIEW_ALLOWED_ROLES (gk_admin-only) so getGrantResponsePacket's
// exportReviewVisible branch (P14-03/07/08 candidate/authority machinery)
// never engages. That machinery is a separate, already-proven read layered
// on top of packet membership - this proof is scoped to membership itself,
// exactly the P14-09 contract under test.
function actorWithRole(role, organizationId = ORG) {
  return Object.freeze({
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    source: "public.userdata",
    organizationMemberships: [{ organization_id: organizationId, membership_status: "active", role_name: role }],
  });
}
const reviewerActor = actorWithRole("gk_reviewer");

// --------------------------------------------------------------------------
// Shared in-memory fixture store + fake `tx.query`, spanning the real SQL
// shapes issued by: createGeneratedContentDraft (funder + internal +
// impact_narrative), startGeneratedContentReview, completeGeneratedContentReview,
// and evaluateGrantResponsePacketMembershipInTransaction. Every handler below
// mirrors an exact query the repository issues (verified by reading
// Backend/kai/dictionary/postgresGeneratedContentRepository.js).
// --------------------------------------------------------------------------

function emptyState() {
  return {
    generationRuns: [],
    generatedContentDrafts: [],
    generatedContentBlocks: [],
    generatedContentCitations: [],
    reviewQueueItems: [],
    uploadLifecycleAudit: [],
    claims: [],
    engagements: [
      { engagement_id: ENGAGEMENT, organization_id: ORG },
      { engagement_id: OTHER_ENGAGEMENT, organization_id: ORG },
    ],
  };
}

// Authoritative claim, authorized for every audience (VAL-GEN-005 reads
// claim.audienceAuthority.{internal,funder,public} from these three
// columns) - this proof is scoped to the funder-generation/packet-membership
// contract, not to VAL-GEN-005's own separate audience-authority gate, so
// every audience is granted here unless a test explicitly narrows it.
function seedClaim(state, {
  claimId = CLAIM,
  evidenceItemId = EVIDENCE,
  organizationId = ORG,
  internalOnly = true,
  funderUseAllowed = true,
  publicUseAllowed = true,
} = {}) {
  state.claims.push({
    organization_id: organizationId,
    claim_id: claimId,
    claim_statement: "Enrollment increased by 12% in 2025.",
    claim_type: "finding",
    evidence_item_id: evidenceItemId,
    internal_only: internalOnly,
    funder_use_allowed: funderUseAllowed,
    public_use_allowed: publicUseAllowed,
    source_id: SOURCE,
    source_version_id: SOURCE_VERSION,
    intake_file_id: INTAKE_FILE,
    upload_state: "confirmed",
  });
}

function arrOrSingle(param) {
  return Array.isArray(param) ? param : [param];
}

// Several downstream validators (validateImmutableGraphRows,
// validateGeneratedContentReviewQueueRows) do an EXACT-key check against
// the row shape the real SQL SELECT actually projects - so these fake reads
// must return exactly those columns, never the full stored fixture row.
function projectDraft(d) {
  return {
    generated_content_draft_id: d.generated_content_draft_id,
    generation_run_id: d.generation_run_id,
    organization_id: d.organization_id,
    content_type: d.content_type,
    requested_audience: d.requested_audience,
    draft_status: d.draft_status,
    review_status: d.review_status,
  };
}
function projectDraftWithCreatedByType(d) {
  return { ...projectDraft(d), created_by_type: d.created_by_type };
}
function projectRun(r) {
  return {
    generation_run_id: r.generation_run_id,
    organization_id: r.organization_id,
    engagement_id: r.engagement_id,
    request_fingerprint: r.request_fingerprint,
    content_type: r.content_type,
    requested_audience: r.requested_audience,
  };
}
function projectBlock(b) {
  return {
    generated_content_block_id: b.generated_content_block_id,
    generated_content_draft_id: b.generated_content_draft_id,
    organization_id: b.organization_id,
    ordinal: b.ordinal,
    text: b.text,
  };
}
function projectCitationWithOrdinal(c, ordinal) {
  return {
    generated_content_citation_id: c.generated_content_citation_id,
    generated_content_block_id: c.generated_content_block_id,
    organization_id: c.organization_id,
    claim_id: c.claim_id,
    evidence_item_id: c.evidence_item_id,
    block_ordinal: ordinal,
  };
}

function makeFakeTx(state) {
  return {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();

      // repository.getGrantResponsePacket / getGeneratedDraftReviewPacket
      // issue this session-scoped isolation-level statement before any real
      // read - a no-op against this in-memory fixture.
      if (s.startsWith("SET TRANSACTION ISOLATION LEVEL")) return { rows: [] };

      // lockImmutableDraftRoot
      if (/FROM kai\.generated_content_drafts/.test(s) && /FOR UPDATE/.test(s)) {
        const [organizationId, draftId] = params;
        const match = state.generatedContentDrafts.some(
          (d) => d.organization_id === organizationId && d.generated_content_draft_id === draftId,
        );
        return { rows: match ? [{ generated_content_draft_id: draftId }] : [] };
      }

      // insertRunReservation
      if (s.startsWith("INSERT INTO kai.generation_runs")) {
        const [organizationId, engagementId, idempotencyKey, requestFingerprint, contentType, requestedAudience, now] = params;
        const conflict = state.generationRuns.some(
          (r) => r.organization_id === organizationId && r.idempotency_key === idempotencyKey,
        );
        if (conflict) return { rows: [] };
        const row = {
          generation_run_id: randomUUID(),
          organization_id: organizationId,
          engagement_id: engagementId,
          idempotency_key: idempotencyKey,
          request_fingerprint: requestFingerprint,
          content_type: contentType,
          requested_audience: requestedAudience,
          created_by_type: "system",
          created_at: now,
        };
        state.generationRuns.push(row);
        return { rows: [{ generation_run_id: row.generation_run_id }] };
      }

      // readExistingState's generation_runs-by-idempotency-key select (replay path)
      if (/idempotency_key, request_fingerprint, content_type, requested_audience/.test(s)) {
        const [organizationId, idempotencyKey] = params;
        const row = state.generationRuns.find(
          (r) => r.organization_id === organizationId && r.idempotency_key === idempotencyKey,
        );
        return { rows: row ? [row] : [] };
      }

      // loadGenerationProjection
      if (/FROM kai\.claims c\b/.test(s)) {
        const [organizationId, claimIds] = params;
        const rows = state.claims
          .filter((c) => c.organization_id === organizationId && claimIds.includes(c.claim_id))
          .sort((a, b) => (a.claim_id < b.claim_id ? -1 : 1));
        return { rows };
      }

      // persistCompleteSet: draft insert
      if (s.startsWith("INSERT INTO kai.generated_content_drafts")) {
        const [generationRunId, organizationId, contentType, requestedAudience, draftStatus, reviewStatus, , now] = params;
        const row = {
          generated_content_draft_id: randomUUID(),
          generation_run_id: generationRunId,
          organization_id: organizationId,
          content_type: contentType,
          requested_audience: requestedAudience,
          draft_status: draftStatus,
          review_status: reviewStatus,
          created_by_type: "system",
          created_at: now,
        };
        state.generatedContentDrafts.push(row);
        return { rows: [{ generated_content_draft_id: row.generated_content_draft_id }] };
      }

      // persistCompleteSet: block insert
      if (s.startsWith("INSERT INTO kai.generated_content_blocks")) {
        const [draftId, organizationId, ordinal, text, now] = params;
        const row = {
          generated_content_block_id: randomUUID(),
          generated_content_draft_id: draftId,
          organization_id: organizationId,
          ordinal,
          text,
          created_at: now,
        };
        state.generatedContentBlocks.push(row);
        return { rows: [{ generated_content_block_id: row.generated_content_block_id }] };
      }

      // persistCompleteSet: citation insert
      if (s.startsWith("INSERT INTO kai.generated_content_citations")) {
        const [blockId, organizationId, claimId, evidenceItemId, now] = params;
        state.generatedContentCitations.push({
          generated_content_citation_id: randomUUID(),
          generated_content_block_id: blockId,
          organization_id: organizationId,
          claim_id: claimId,
          evidence_item_id: evidenceItemId,
          created_at: now,
        });
        return { rows: [] };
      }

      // persistCompleteSet: review_queue_items insert (open/needs_gk_review)
      if (s.startsWith("INSERT INTO kai.review_queue_items")) {
        const [organizationId, queueType, targetObjectType, targetObjectId, reviewStatus, summary, requiredAction, now] = params;
        const row = {
          review_queue_item_id: randomUUID(),
          organization_id: organizationId,
          engagement_id: null,
          queue_type: queueType,
          target_object_type: targetObjectType,
          target_object_id: targetObjectId,
          priority: "medium",
          queue_status: "open",
          review_status: reviewStatus,
          blocked_reason: null,
          assigned_to: null,
          due_at: null,
          summary,
          required_action: requiredAction,
          queue_metadata: {},
          created_by: null,
          created_by_type: "system",
          created_at: now,
          updated_at: now,
        };
        state.reviewQueueItems.push(row);
        return { rows: [{ review_queue_item_id: row.review_queue_item_id }] };
      }

      // insertAudit / insertStartReviewAudit / insertCompleteReviewAudit
      if (s.startsWith("INSERT INTO kai.upload_lifecycle_audit")) {
        const [organizationId, intakeFileId, operation, fromState, metadataJson, now] = params;
        state.uploadLifecycleAudit.push({
          organization_id: organizationId,
          intake_file_id: intakeFileId,
          operation,
          from_state: fromState,
          to_state: fromState,
          outcome: "success",
          metadata: JSON.parse(metadataJson),
          created_at: now,
        });
        return { rows: [] };
      }

      // loadAuditFileContext (distinct JOIN signature from loadGenerationProjection)
      if (/JOIN kai\.claims cl\b/.test(s)) {
        const [organizationId, generatedContentDraftId] = params;
        const blockIds = new Set(
          state.generatedContentBlocks
            .filter((b) => b.organization_id === organizationId && b.generated_content_draft_id === generatedContentDraftId)
            .map((b) => b.generated_content_block_id),
        );
        const citation = state.generatedContentCitations.find(
          (c) => c.organization_id === organizationId && blockIds.has(c.generated_content_block_id),
        );
        if (!citation) return { rows: [] };
        const claim = state.claims.find((c) => c.organization_id === organizationId && c.claim_id === citation.claim_id);
        if (!claim) return { rows: [] };
        return { rows: [{ intake_file_id: claim.intake_file_id, upload_state: claim.upload_state }] };
      }

      // loadReviewQueueItemById
      if (s.includes("WHERE review_queue_item_id = $1::uuid")) {
        const [reviewQueueItemId] = params;
        const row = state.reviewQueueItems.find((q) => q.review_queue_item_id === reviewQueueItemId);
        return { rows: row ? [row] : [] };
      }

      // startGeneratedContentReview / completeGeneratedContentReview UPDATE
      if (s.startsWith("UPDATE kai.review_queue_items")) {
        const isStartTransition = params.length === 9;
        const newQueueStatus = params[0];
        const newReviewStatus = isStartTransition ? undefined : params[1];
        const now = isStartTransition ? params[1] : params[2];
        const organizationId = isStartTransition ? params[2] : params[3];
        const reviewQueueItemId = isStartTransition ? params[3] : params[4];
        const targetType = isStartTransition ? params[4] : params[5];
        const targetId = isStartTransition ? params[5] : params[6];
        const expectedQueueStatus = isStartTransition ? params[6] : params[7];
        const expectedReviewStatus = isStartTransition ? params[7] : params[8];
        const expectedUpdatedAt = isStartTransition ? params[8] : params[9];
        const row = state.reviewQueueItems.find((q) => q.review_queue_item_id === reviewQueueItemId);
        const matches = row
          && row.organization_id === organizationId
          && row.target_object_type === targetType
          && row.target_object_id === targetId
          && row.queue_status === expectedQueueStatus
          && row.review_status === expectedReviewStatus
          && row.updated_at === expectedUpdatedAt;
        if (!matches) return { rowCount: 0, rows: [] };
        row.queue_status = newQueueStatus;
        if (newReviewStatus !== undefined) row.review_status = newReviewStatus;
        row.updated_at = now;
        return { rowCount: 1, rows: [{ review_queue_item_id: reviewQueueItemId }] };
      }

      // loadGrantResponsePacketMemberDraftIds (join expressed manually here)
      if (/JOIN kai\.generation_runs r\b/.test(s)) {
        const [organizationId, engagementId, contentTypes, draftStatus, audience] = params;
        const rows = state.generatedContentDrafts
          .filter((d) => {
            if (d.organization_id !== organizationId) return false;
            if (!contentTypes.includes(d.content_type)) return false;
            if (d.draft_status !== draftStatus) return false;
            if (d.requested_audience !== audience) return false;
            const run = state.generationRuns.find((r) => r.generation_run_id === d.generation_run_id);
            return run && run.organization_id === organizationId && run.engagement_id === engagementId;
          })
          .sort((a, b) => (a.generated_content_draft_id < b.generated_content_draft_id ? -1 : 1))
          .map((d) => ({ generated_content_draft_id: d.generated_content_draft_id }));
        return { rows };
      }

      // generated_content_drafts: sibling-drafts-by-run (single or batch) -
      // real SQL selects exactly the 7 draftKeys columns.
      if (/FROM kai\.generated_content_drafts/.test(s) && /WHERE generation_run_id/.test(s)) {
        const runIds = arrOrSingle(params[0]);
        const rows = state.generatedContentDrafts.filter((d) => runIds.includes(d.generation_run_id)).map(projectDraft);
        return { rows };
      }

      // readExistingState's draft-by-generation_run_id lookup (distinct from
      // the sibling-drafts-by-run query above: this one is scoped by
      // organization_id + generation_run_id equality, no ORDER BY, and its
      // SELECT additionally includes created_by_type/created_at - only
      // created_by_type is read downstream (validateExistingState).
      if (/FROM kai\.generated_content_drafts/.test(s) && /generation_run_id = \$2::uuid/.test(s)) {
        const [organizationId, runId] = params;
        const rows = state.generatedContentDrafts
          .filter((d) => d.organization_id === organizationId && d.generation_run_id === runId)
          .map(projectDraftWithCreatedByType);
        return { rows };
      }

      // generated_content_drafts: by draft id(s) (single readReviewPacketState /
      // batch readReviewPacketStatesBatch) - exact draftKeys columns only.
      if (/FROM kai\.generated_content_drafts/.test(s)) {
        const [organizationId, draftIdOrIds] = params;
        const ids = arrOrSingle(draftIdOrIds);
        const rows = state.generatedContentDrafts
          .filter((d) => d.organization_id === organizationId && ids.includes(d.generated_content_draft_id))
          .map(projectDraft);
        return { rows };
      }

      // generation_runs: by run id(s), no JOIN - exact runKeys columns only.
      if (/FROM kai\.generation_runs\b/.test(s) && !/JOIN/.test(s)) {
        const ids = arrOrSingle(params[0]);
        const rows = state.generationRuns.filter((r) => ids.includes(r.generation_run_id)).map(projectRun);
        return { rows };
      }

      // generated_content_blocks: by draft id(s). readExistingState scopes by
      // (organizationId, draftId) - 2 params; readReviewPacketState/batch
      // scope by draft id(s) alone - 1 param, no organization_id filter.
      // All three call sites select exactly blockKeys columns.
      if (/FROM kai\.generated_content_blocks\b/.test(s)) {
        const organizationId = params.length >= 2 ? params[0] : undefined;
        const idsParam = params.length >= 2 ? params[1] : params[0];
        const ids = arrOrSingle(idsParam);
        const rows = state.generatedContentBlocks
          .filter((b) => (organizationId === undefined || b.organization_id === organizationId) && ids.includes(b.generated_content_draft_id))
          .sort((a, b) => a.ordinal - b.ordinal)
          .map(projectBlock);
        return { rows };
      }

      // readExistingState's citations-by-(organizationId, draftId) lookup -
      // joins through generated_content_blocks itself rather than taking a
      // block-id array, distinct from the ANY(blockIds) shape below. This
      // call site's SELECT does not include block_ordinal.
      if (/FROM kai\.generated_content_citations\b/.test(s) && /b\.generated_content_draft_id = \$2::uuid/.test(s)) {
        const [organizationId, draftId] = params;
        const blockIds = new Set(
          state.generatedContentBlocks
            .filter((b) => b.organization_id === organizationId && b.generated_content_draft_id === draftId)
            .map((b) => b.generated_content_block_id),
        );
        const rows = state.generatedContentCitations
          .filter((c) => c.organization_id === organizationId && blockIds.has(c.generated_content_block_id))
          .map((c) => ({
            generated_content_citation_id: c.generated_content_citation_id,
            generated_content_block_id: c.generated_content_block_id,
            organization_id: c.organization_id,
            claim_id: c.claim_id,
            evidence_item_id: c.evidence_item_id,
          }));
        return { rows };
      }

      // generated_content_citations: by block id(s) (ANY array shape) - the
      // real SQL JOINs generated_content_blocks to also select b.ordinal AS
      // block_ordinal (required by validateImmutableGraphRows's exact-key
      // citationKeys check downstream), so this fake must too.
      if (/FROM kai\.generated_content_citations\b/.test(s)) {
        const blockIds = arrOrSingle(params[0]);
        const ordinalByBlockId = new Map(state.generatedContentBlocks.map((b) => [b.generated_content_block_id, b.ordinal]));
        const rows = state.generatedContentCitations
          .filter((c) => blockIds.includes(c.generated_content_block_id))
          .map((c) => projectCitationWithOrdinal(c, ordinalByBlockId.get(c.generated_content_block_id)));
        return { rows };
      }

      // export-review-scoped review_queue_items reads (single + batch) - this
      // proof never requests export review, so this store is always empty.
      if (/FROM kai\.review_queue_items\b/.test(s) && /blocked_reason/.test(s)) {
        return { rows: [] };
      }

      // generic generated_content_review review_queue_items reads (single +
      // batch: readReviewPacketState / readExistingState / readReviewPacketStatesBatch).
      // Param ORDER differs between these three call sites (readExistingState
      // puts queue_type before target_object_type; the others put
      // target_object_type before queue_type/ids), so the target id(s) are
      // located by elimination rather than by a fixed position: organizationId
      // is always params[0] in all three, and the remaining params are
      // exactly the two known constant strings (queue_type, target_object_type,
      // in either order) plus the target id or target ids array.
      //
      // The real SQL at each call site selects a DIFFERENT, exact column
      // list (readReviewPacketState/batch select `updated_at` but not
      // `created_by_type`; readExistingState selects `created_by_type` but
      // not `updated_at`), and readReviewPacketState/batch's own downstream
      // validator (validateGeneratedContentReviewQueueRows) does an EXACT-key
      // check against that column list - so the projection below must match
      // the real SELECT's own column list per call site, not just return the
      // full stored row.
      if (/FROM kai\.review_queue_items\b/.test(s)) {
        const organizationId = params[0];
        const rest = params.slice(1);
        const arrParam = rest.find((p) => Array.isArray(p));
        const ids = arrParam
          || rest.filter(
            (p) => p !== GENERATED_CONTENT_REVIEW_QUEUE_CONTRACT.queueType
              && p !== GENERATED_CONTENT_REVIEW_QUEUE_CONTRACT.targetObjectType,
          );
        const matched = state.reviewQueueItems.filter(
          (q) => q.organization_id === organizationId
            && q.queue_type === GENERATED_CONTENT_REVIEW_QUEUE_CONTRACT.queueType
            && q.target_object_type === GENERATED_CONTENT_REVIEW_QUEUE_CONTRACT.targetObjectType
            && ids.includes(q.target_object_id),
        );
        const isReadExistingStateShape = /created_by_type/.test(s);
        const rows = matched.map((q) => (
          isReadExistingStateShape
            ? {
                review_queue_item_id: q.review_queue_item_id,
                organization_id: q.organization_id,
                queue_type: q.queue_type,
                target_object_type: q.target_object_type,
                target_object_id: q.target_object_id,
                priority: q.priority,
                queue_status: q.queue_status,
                review_status: q.review_status,
                assigned_to: q.assigned_to,
                due_at: q.due_at,
                summary: q.summary,
                required_action: q.required_action,
                created_by_type: q.created_by_type,
              }
            : {
                review_queue_item_id: q.review_queue_item_id,
                organization_id: q.organization_id,
                queue_type: q.queue_type,
                target_object_type: q.target_object_type,
                target_object_id: q.target_object_id,
                priority: q.priority,
                queue_status: q.queue_status,
                review_status: q.review_status,
                assigned_to: q.assigned_to,
                due_at: q.due_at,
                summary: q.summary,
                required_action: q.required_action,
                updated_at: q.updated_at,
              }
        ));
        return { rows };
      }

      // loadGrantResponsePacketEngagement
      if (/FROM kai\.engagements\b/.test(s)) {
        const [organizationId, engagementId] = params;
        const row = state.engagements.find((e) => e.organization_id === organizationId && e.engagement_id === engagementId);
        return { rows: row ? [row] : [] };
      }

      throw new Error(`unhandled fake query: ${s}`);
    },
  };
}

function withFakeTransaction(state) {
  return async (callback) => {
    // Snapshot/restore semantics matching the existing p14-09 boundary
    // suite's own withFakeTransaction: on success, mutations are kept; a
    // throw (rollback) still lets earlier-in-the-file state remain as it
    // was before this call, mirroring real transactional isolation closely
    // enough for these fixed, single-writer test scenarios.
    const draft = structuredClone(state);
    const result = await callback(makeFakeTx(draft));
    for (const key of Object.keys(draft)) state[key] = draft[key];
    return result;
  };
}

function makeEvaluator({ eligibleForClaim = () => true, callLog = [] } = {}) {
  return async (tx, { claimId, requestedAudience }) => {
    callLog.push({ claimId, requestedAudience });
    const claim = { claim_id: claimId };
    return {
      ok: true,
      data: {
        claim: {
          claim_id: claimId,
          claim_type: "finding",
          claim_status: "approved",
          claim_review_status: "approved",
          claim_strength: "strong",
          audience_gates: {},
        },
        evidence: {
          evidence_item_id: EVIDENCE,
          evidence_review_status: "approved",
          support_strength: "strong",
          review_queue_item_id: "10000000-0000-4000-8000-000000000021",
          review_queue_status: "resolved",
          review_status: "approved",
          updated_at: "2026-08-06T09:00:00.000Z",
          sensitivity_level: "unknown",
        },
        locator: { source_locator_id: "10000000-0000-4000-8000-000000000022" },
        source: { source_id: SOURCE, source_code: null },
        source_version: { source_version_id: SOURCE_VERSION, is_current: true },
        claim_review: { review_queue_item_id: "10000000-0000-4000-8000-000000000025", queue_status: "resolved", review_status: "approved" },
        candidate: { intake_source_candidate_id: "90000000-0000-4000-8000-000000000003" },
        promotion_decision: { intake_promotion_decision_id: "10000000-0000-4000-8000-000000000026" },
        dimensions: {},
        gap_items: [],
        client_followup_workflows: [],
        potential_conflict_groups: [],
        requestedAudience,
        eligible: eligibleForClaim(claimId),
        blockerCodes: eligibleForClaim(claimId) ? [] : ["evidence_superseded"],
        affectedDimensionKeys: [],
        affectedObjectIds: [],
        truncated: false,
      },
      error: null,
    };
  };
}

function auditRecorder() {
  return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
}

async function stubGetEngagementForOrganization(state) {
  return async ({ organizationId, engagementId }) => {
    const row = state.engagements.find((e) => e.organization_id === organizationId && e.engagement_id === engagementId);
    return row ? { engagement_id: row.engagement_id, organization_id: row.organization_id } : null;
  };
}

function makeRepository(state, evaluator) {
  return createPostgresGeneratedContentRepository({
    runInTransaction: withFakeTransaction(state),
    evaluator,
  });
}

function funderCreateInput(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    requestedAudience: "funder",
    claimIds: [CLAIM],
    idempotencyKey: "p14-09-assembled-proof-key",
    actorContext: reviewerActor,
    now: NOW,
    ...overrides,
  };
}

function draftGenerator(claimId = CLAIM) {
  return async () => ({
    blocks: [{ ordinal: 1, text: "Enrollment increased by 12% in 2025.", citations: [{ claimId, evidenceItemId: EVIDENCE }] }],
  });
}

// --------------------------------------------------------------------------
// Positive end-to-end assembled proof
// --------------------------------------------------------------------------

test("ASSEMBLED PROOF: authoritative funder-eligible claim -> real funder generation -> real review resolution -> exact draft appears as Grant Response Packet member", async () => {
  const state = emptyState();
  seedClaim(state);
  const callLog = [];
  const evaluator = makeEvaluator({ eligibleForClaim: () => true, callLog });
  const repository = makeRepository(state, evaluator);

  // Step 1: real service, real repository transaction code.
  const createResult = await createEvidenceSummaryDraft(funderCreateInput(), {
    env: enabledEnv,
    generatedContentRepository: repository,
    draftGenerator: draftGenerator(),
    metadataOnlyAudit: auditRecorder(),
    getEngagementForOrganization: await stubGetEngagementForOrganization(state),
  });
  assert.equal(createResult.ok, true);
  assert.equal(createResult.data.requestedAudience, "funder");
  assert.equal(createResult.data.draftStatus, "draft");
  const draftId = createResult.data.generatedContentDraftId;
  const reviewQueueItemId = createResult.data.reviewQueueItemId;

  // Engagement-id/audience binding proof: read the durable rows the real
  // repository transaction wrote, directly off the fixture store (not
  // re-derived by the test).
  const persistedRun = state.generationRuns.find((r) => r.generation_run_id === createResult.data.generationRunId);
  const persistedDraft = state.generatedContentDrafts.find((d) => d.generated_content_draft_id === draftId);
  assert.equal(persistedRun.engagement_id, ENGAGEMENT);
  assert.equal(persistedRun.requested_audience, "funder");
  assert.equal(persistedDraft.requested_audience, "funder");
  const openQueueRow = state.reviewQueueItems.find((q) => q.review_queue_item_id === reviewQueueItemId);
  assert.equal(openQueueRow.queue_status, "open");
  assert.equal(openQueueRow.review_status, "needs_gk_review");

  // Step 2: real review lifecycle - start (open -> in_progress).
  const startResult = await startGeneratedContentReview({
    organizationId: ORG,
    generatedContentDraftId: draftId,
    reviewQueueItemId,
    expectedUpdatedAt: openQueueRow.updated_at,
    actorContext: reviewerActor,
    now: LATER,
  }, {
    env: enabledEnv,
    generatedContentRepository: repository,
    metadataOnlyAudit: auditRecorder(),
  });
  assert.equal(startResult.ok, true);
  assert.equal(startResult.data.queueStatus, "in_progress");

  // Step 3: real review lifecycle - complete (in_progress -> resolved). This
  // is the actual, existing resolve mechanism (kaiGeneratedContentService.js
  // completeGeneratedContentReview, backed by the real repository UPDATE
  // with optimistic-concurrency preconditions) - no hand-written resolved row.
  const inProgressRow = state.reviewQueueItems.find((q) => q.review_queue_item_id === reviewQueueItemId);
  const completeResult = await completeGeneratedContentReview({
    organizationId: ORG,
    generatedContentDraftId: draftId,
    reviewQueueItemId,
    expectedUpdatedAt: inProgressRow.updated_at,
    actorContext: reviewerActor,
    now: LATEST,
  }, {
    env: enabledEnv,
    generatedContentRepository: repository,
    metadataOnlyAudit: auditRecorder(),
  });
  assert.equal(completeResult.ok, true);
  assert.equal(completeResult.data.queueStatus, "resolved");
  assert.equal(completeResult.data.reviewStatus, "resolved");

  // Step 4: real Grant Response Packet membership read - real service, real
  // repository, real evaluateGrantResponsePacketMembershipInTransaction. The
  // evaluator is re-invoked here too (current-use eligibility re-check),
  // proving eligibility is re-derived at read time, never cached from step 1.
  const beforePacketCallCount = callLog.length;
  const packetResult = await getGrantResponsePacket({
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    actorContext: reviewerActor,
  }, {
    env: enabledEnv,
    generatedContentRepository: repository,
  });
  assert.equal(packetResult.ok, true);
  assert.ok(callLog.length > beforePacketCallCount, "membership read must re-invoke the real eligibility evaluator, not reuse a cached result");

  const member = packetResult.data.drafts.find((d) => d.generatedContentDraftId === draftId);
  assert.ok(member, "the exact funder draft must appear as a Grant Response Packet member");
  assert.equal(member.requestedAudience, "funder");
  assert.equal(member.queueStatus, "resolved");
  assert.equal(member.reviewStatus, "resolved");
  assert.equal(member.currentUseEligible, true);
  assert.equal(packetResult.data.packetAudience, "funder");
  assert.equal(packetResult.data.engagementId, ENGAGEMENT);
});

// --------------------------------------------------------------------------
// Idempotency / replay proof
// --------------------------------------------------------------------------

test("ASSEMBLED PROOF: replaying the same idempotency_key does not re-invoke the generator or create a duplicate generation_run", async () => {
  const state = emptyState();
  seedClaim(state);
  const evaluator = makeEvaluator({ eligibleForClaim: () => true });
  const repository = makeRepository(state, evaluator);
  const generatorCalls = [];
  const generator = async (input) => {
    generatorCalls.push(input);
    return { blocks: [{ ordinal: 1, text: "Enrollment increased by 12% in 2025.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }] };
  };

  const deps = {
    env: enabledEnv,
    generatedContentRepository: repository,
    draftGenerator: generator,
    metadataOnlyAudit: auditRecorder(),
    getEngagementForOrganization: await stubGetEngagementForOrganization(state),
  };

  const first = await createEvidenceSummaryDraft(funderCreateInput(), deps);
  const second = await createEvidenceSummaryDraft(funderCreateInput(), deps);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.data.generatedContentDraftId, second.data.generatedContentDraftId);
  assert.equal(first.data.generationRunId, second.data.generationRunId);
  assert.equal(second.data.replayed, true);
  assert.equal(generatorCalls.length, 1, "replay must not re-invoke the generator");
  assert.equal(state.generationRuns.length, 1, "replay must not create a duplicate generation_run");
  assert.equal(state.generatedContentDrafts.length, 1, "replay must not create a duplicate draft");
});

// --------------------------------------------------------------------------
// Negative proofs (1-7): each excluded from packet membership, or fails
// closed, using the same real service/repository seams.
// --------------------------------------------------------------------------

async function resolveDraft(state, repository, { draftId, reviewQueueItemId, openUpdatedAt, actorContext = reviewerActor }) {
  const startResult = await startGeneratedContentReview({
    organizationId: ORG,
    generatedContentDraftId: draftId,
    reviewQueueItemId,
    expectedUpdatedAt: openUpdatedAt,
    actorContext,
    now: LATER,
  }, { env: enabledEnv, generatedContentRepository: repository, metadataOnlyAudit: auditRecorder() });
  assert.equal(startResult.ok, true);
  const inProgressRow = state.reviewQueueItems.find((q) => q.review_queue_item_id === reviewQueueItemId);
  const completeResult = await completeGeneratedContentReview({
    organizationId: ORG,
    generatedContentDraftId: draftId,
    reviewQueueItemId,
    expectedUpdatedAt: inProgressRow.updated_at,
    actorContext,
    now: LATEST,
  }, { env: enabledEnv, generatedContentRepository: repository, metadataOnlyAudit: auditRecorder() });
  assert.equal(completeResult.ok, true);
  return completeResult;
}

test("NEGATIVE 1: an unresolved (not-yet-reviewed) funder draft is excluded from packet membership", async () => {
  const state = emptyState();
  seedClaim(state);
  const repository = makeRepository(state, makeEvaluator({ eligibleForClaim: () => true }));
  const createResult = await createEvidenceSummaryDraft(funderCreateInput(), {
    env: enabledEnv,
    generatedContentRepository: repository,
    draftGenerator: draftGenerator(),
    metadataOnlyAudit: auditRecorder(),
    getEngagementForOrganization: await stubGetEngagementForOrganization(state),
  });
  assert.equal(createResult.ok, true);
  // No start/complete review - the draft stays open/needs_gk_review.

  const packetResult = await getGrantResponsePacket(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: reviewerActor },
    { env: enabledEnv, generatedContentRepository: repository },
  );
  assert.equal(packetResult.ok, true);
  assert.equal(packetResult.data.drafts.some((d) => d.generatedContentDraftId === createResult.data.generatedContentDraftId), false);
});

test("NEGATIVE 2: a resolved funder draft with currentUseEligible !== true (eligibility lost after resolution) is excluded", async () => {
  const state = emptyState();
  seedClaim(state);
  // Eligible at generation time (so funder creation succeeds), but the SAME
  // evaluator instance is shared with the packet-read step below, so its
  // eligibility can flip between generation and the later membership read -
  // exactly like a real claim losing current-use eligibility after a draft
  // was already generated and reviewed.
  let currentlyEligible = true;
  const evaluator = makeEvaluator({ eligibleForClaim: () => currentlyEligible });
  const repository = makeRepository(state, evaluator);

  const createResult = await createEvidenceSummaryDraft(funderCreateInput(), {
    env: enabledEnv,
    generatedContentRepository: repository,
    draftGenerator: draftGenerator(),
    metadataOnlyAudit: auditRecorder(),
    getEngagementForOrganization: await stubGetEngagementForOrganization(state),
  });
  assert.equal(createResult.ok, true);
  const openRow = state.reviewQueueItems.find((q) => q.review_queue_item_id === createResult.data.reviewQueueItemId);
  await resolveDraft(state, repository, {
    draftId: createResult.data.generatedContentDraftId,
    reviewQueueItemId: createResult.data.reviewQueueItemId,
    openUpdatedAt: openRow.updated_at,
  });

  // Eligibility lost AFTER resolution, before the packet read.
  currentlyEligible = false;

  const packetResult = await getGrantResponsePacket(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: reviewerActor },
    { env: enabledEnv, generatedContentRepository: repository },
  );
  assert.equal(packetResult.ok, true);
  assert.equal(packetResult.data.drafts.some((d) => d.generatedContentDraftId === createResult.data.generatedContentDraftId), false);
});

test("NEGATIVE 3: an internal-audience evidence-summary draft (requested_audience=internal) is excluded from packet membership even when resolved and eligible", async () => {
  const state = emptyState();
  seedClaim(state);
  const repository = makeRepository(state, makeEvaluator({ eligibleForClaim: () => true }));
  const createResult = await createEvidenceSummaryDraft(funderCreateInput({ requestedAudience: "internal" }), {
    env: enabledEnv,
    generatedContentRepository: repository,
    draftGenerator: draftGenerator(),
    metadataOnlyAudit: auditRecorder(),
    getEngagementForOrganization: await stubGetEngagementForOrganization(state),
  });
  assert.equal(createResult.ok, true);
  assert.equal(createResult.data.requestedAudience, "internal");
  const openRow = state.reviewQueueItems.find((q) => q.review_queue_item_id === createResult.data.reviewQueueItemId);
  await resolveDraft(state, repository, {
    draftId: createResult.data.generatedContentDraftId,
    reviewQueueItemId: createResult.data.reviewQueueItemId,
    openUpdatedAt: openRow.updated_at,
  });

  const packetResult = await getGrantResponsePacket(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: reviewerActor },
    { env: enabledEnv, generatedContentRepository: repository },
  );
  assert.equal(packetResult.ok, true);
  assert.equal(packetResult.data.drafts.some((d) => d.generatedContentDraftId === createResult.data.generatedContentDraftId), false);
});

test("NEGATIVE 4: an internal impact-narrative draft is excluded from packet membership, and requestedAudience!=internal is rejected outright for impact_narrative", async () => {
  const state = emptyState();
  seedClaim(state);
  const repository = makeRepository(state, makeEvaluator({ eligibleForClaim: () => true }));

  // impact_narrative can only ever be created as "internal" - the repository
  // rejects any other requestedAudience before a transaction even opens.
  const rejected = await repository.createImpactNarrativeDraft(funderCreateInput({ requestedAudience: "funder" }), {
    draftGenerator: draftGenerator(),
    metadataOnlyAudit: auditRecorder(),
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "validation_blocker");

  const createResult = await createImpactNarrativeDraft(funderCreateInput({ requestedAudience: "internal" }), {
    env: enabledEnv,
    generatedContentRepository: repository,
    draftGenerator: draftGenerator(),
    metadataOnlyAudit: auditRecorder(),
    getEngagementForOrganization: await stubGetEngagementForOrganization(state),
  });
  assert.equal(createResult.ok, true);
  const openRow = state.reviewQueueItems.find((q) => q.review_queue_item_id === createResult.data.reviewQueueItemId);
  await resolveDraft(state, repository, {
    draftId: createResult.data.generatedContentDraftId,
    reviewQueueItemId: createResult.data.reviewQueueItemId,
    openUpdatedAt: openRow.updated_at,
  });

  const packetResult = await getGrantResponsePacket(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: reviewerActor },
    { env: enabledEnv, generatedContentRepository: repository },
  );
  assert.equal(packetResult.ok, true);
  assert.equal(packetResult.data.drafts.some((d) => d.generatedContentDraftId === createResult.data.generatedContentDraftId), false);
});

test("NEGATIVE 5: a resolved, eligible funder draft generated under a DIFFERENT engagement is excluded from this engagement's packet", async () => {
  const state = emptyState();
  seedClaim(state);
  const repository = makeRepository(state, makeEvaluator({ eligibleForClaim: () => true }));
  const createResult = await createEvidenceSummaryDraft(funderCreateInput({ engagementId: OTHER_ENGAGEMENT }), {
    env: enabledEnv,
    generatedContentRepository: repository,
    draftGenerator: draftGenerator(),
    metadataOnlyAudit: auditRecorder(),
    getEngagementForOrganization: await stubGetEngagementForOrganization(state),
  });
  assert.equal(createResult.ok, true);
  const openRow = state.reviewQueueItems.find((q) => q.review_queue_item_id === createResult.data.reviewQueueItemId);
  await resolveDraft(state, repository, {
    draftId: createResult.data.generatedContentDraftId,
    reviewQueueItemId: createResult.data.reviewQueueItemId,
    openUpdatedAt: openRow.updated_at,
  });

  const packetForOtherEngagement = await getGrantResponsePacket(
    { organizationId: ORG, engagementId: OTHER_ENGAGEMENT, actorContext: reviewerActor },
    { env: enabledEnv, generatedContentRepository: repository },
  );
  assert.equal(packetForOtherEngagement.ok, true);
  assert.equal(packetForOtherEngagement.data.drafts.some((d) => d.generatedContentDraftId === createResult.data.generatedContentDraftId), true);

  const packetForOriginalEngagement = await getGrantResponsePacket(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: reviewerActor },
    { env: enabledEnv, generatedContentRepository: repository },
  );
  assert.equal(packetForOriginalEngagement.ok, true);
  assert.equal(packetForOriginalEngagement.data.drafts.some((d) => d.generatedContentDraftId === createResult.data.generatedContentDraftId), false);
});

test("NEGATIVE 6: cross-tenant state fails closed - a different organization's actor cannot read another organization's packet, and a draft never leaks across organization_id", async () => {
  const state = emptyState();
  seedClaim(state);
  const repository = makeRepository(state, makeEvaluator({ eligibleForClaim: () => true }));
  const createResult = await createEvidenceSummaryDraft(funderCreateInput(), {
    env: enabledEnv,
    generatedContentRepository: repository,
    draftGenerator: draftGenerator(),
    metadataOnlyAudit: auditRecorder(),
    getEngagementForOrganization: await stubGetEngagementForOrganization(state),
  });
  assert.equal(createResult.ok, true);
  const openRow = state.reviewQueueItems.find((q) => q.review_queue_item_id === createResult.data.reviewQueueItemId);
  await resolveDraft(state, repository, {
    draftId: createResult.data.generatedContentDraftId,
    reviewQueueItemId: createResult.data.reviewQueueItemId,
    openUpdatedAt: openRow.updated_at,
  });

  // A caller from OTHER_ORG requesting the SAME engagement id/uuid text -
  // loadGrantResponsePacketEngagement requires an exact
  // (organization_id, engagement_id) row, so this must fail not_found
  // (never a cross-tenant read of ORG's engagement/drafts).
  const otherOrgActor = actorWithRole("gk_reviewer", OTHER_ORG);
  const crossTenantResult = await getGrantResponsePacket(
    { organizationId: OTHER_ORG, engagementId: ENGAGEMENT, actorContext: otherOrgActor },
    { env: enabledEnv, generatedContentRepository: repository },
  );
  assert.equal(crossTenantResult.ok, false);
  assert.equal(crossTenantResult.error.code, "not_found");
});

test("NEGATIVE 7: a public-audience evidence-summary draft is excluded from Grant Response Packet membership (packet membership is funder-only)", async () => {
  const state = emptyState();
  seedClaim(state);
  const repository = makeRepository(state, makeEvaluator({ eligibleForClaim: () => true }));
  const createResult = await createEvidenceSummaryDraft(funderCreateInput({ requestedAudience: "public" }), {
    env: enabledEnv,
    generatedContentRepository: repository,
    draftGenerator: draftGenerator(),
    metadataOnlyAudit: auditRecorder(),
    getEngagementForOrganization: await stubGetEngagementForOrganization(state),
  });
  assert.equal(createResult.ok, true);
  assert.equal(createResult.data.requestedAudience, "public");
  const openRow = state.reviewQueueItems.find((q) => q.review_queue_item_id === createResult.data.reviewQueueItemId);
  await resolveDraft(state, repository, {
    draftId: createResult.data.generatedContentDraftId,
    reviewQueueItemId: createResult.data.reviewQueueItemId,
    openUpdatedAt: openRow.updated_at,
  });

  const packetResult = await getGrantResponsePacket(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: reviewerActor },
    { env: enabledEnv, generatedContentRepository: repository },
  );
  assert.equal(packetResult.ok, true);
  assert.equal(packetResult.data.drafts.some((d) => d.generatedContentDraftId === createResult.data.generatedContentDraftId), false);
});

// --------------------------------------------------------------------------
// NEGATIVE 8: no latest/default/preferred engagement fallback exists
// anywhere in the funder generation or packet membership path - engagement_id
// is always explicit, never inferred. Static source-code assertions, the
// same technique __tests__/kai-grant-response-packet-boundary.spec.js
// already uses for the membership query specifically; this additionally
// covers the funder generation path's own engagement handling.
// --------------------------------------------------------------------------

test("NEGATIVE 8: funder generation input contract requires an explicit engagementId with no default/optional/fallback handling", () => {
  const src = readFileSync(
    new URL("../Backend/kai/dictionary/postgresGeneratedContentRepository.js", import.meta.url),
    "utf8",
  );
  // validateInput requires engagementId as one of the exact allowed keys
  // (hasExactKeys), rejecting any input missing it or carrying extra keys -
  // there is no default/optional engagementId path.
  assert.ok(/hasExactKeys\(input, new Set\(\["organizationId", "engagementId", "requestedAudience", "claimIds", "idempotencyKey", "actorContext", "now"\]\)\)/.test(src));
  assert.ok(!/engagementId\s*=\s*input\.engagementId\s*\|\|/.test(src));
  assert.ok(!/engagementId\s*\?\?/.test(src));
});

test("NEGATIVE 8: Grant Response Packet membership query resolves engagement_id by plain equality only - never a NULL-matching or latest/newest guess (existing coverage, re-asserted here alongside the assembled proof)", () => {
  const src = readFileSync(
    new URL("../Backend/kai/dictionary/postgresGeneratedContentRepository.js", import.meta.url),
    "utf8",
  );
  const fnMatch = src.match(/async function loadGrantResponsePacketMemberDraftIds\([\s\S]*?\n}\n/);
  assert.ok(fnMatch, "loadGrantResponsePacketMemberDraftIds must exist");
  const fn = fnMatch[0];
  assert.ok(/r\.engagement_id\s*=\s*\$2::uuid/.test(fn));
  assert.ok(!/IS NOT DISTINCT FROM/.test(fn));
  assert.ok(!/COALESCE/.test(fn));
  assert.ok(!/ORDER BY.*created_at/.test(fn));
  assert.ok(!/LIMIT 1/.test(fn));
  assert.ok(/requested_audience\s*=\s*\$5/.test(fn), "membership must require an exact requested_audience match");
});
