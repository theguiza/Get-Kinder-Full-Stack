import { isKaiSprint2Enabled, isKaiGenerationEnabled, isKaiPublicExportEnabled } from "../config/kaiSprint2Config.js";
import { KAI_SPRINT2_P0_OPERATION_ROLES, KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import {
  listGeneratedDraftLibraryIndex as readGeneratedDraftLibraryIndex,
  readGeneratedDraftEngagementId,
} from "../db/kaiGeneratedDraftLibraryReadModels.js";
import { getEngagementForOrganization } from "../db/kaiQueries.js";
import { __generatedContentReviewPacketServiceTestables } from "./kaiGeneratedContentService.js";
import { __testables as generatedDraftLibraryTestables } from "./kaiGeneratedDraftLibraryService.js";
import { serializeExportManifestRenderModelToMarkdown, __exportManifestMarkdownSerializerTestables } from "./kaiExportManifestMarkdownSerializer.js";
import { BOARD_REPORTING_PACKET_AUDIENCE } from "./kaiBoardReportingPacketService.js";

/**
 * Client-safe Generated Drafts, Grant Response Packet preview, and Board
 * Reporting preview. The GK reads (Generated Drafts index, per-draft review
 * packet, Grant Response Packet, Board Reporting packet) keep their GK role
 * sets: they carry review-queue ids, generation-run ids, per-citation
 * evidence/source/version ids, GK review vocabulary, blocker codes,
 * export-review, candidate, final-release, and manifest state.
 *
 * Visibility rule (one rule for every surface): a draft is shown to a client
 * only when it satisfies the repository's own packet-membership rule
 * (postgresGeneratedContentRepository.js
 * evaluateGrantResponsePacketMembershipInTransaction) - its
 * generated_content_review is resolved/resolved (by Get Kinder, or for an
 * ordinary internal evidence summary by the organization's own administrator
 * under the 2026-10-23 amendment) AND currentUseEligible is
 * true (every cited claim is currently eligible for the draft's requested
 * audience through the P2-06 evaluator). Not-yet-reviewed, blocked,
 * superseded-evidence, or audience-ineligible drafts are never shown; a
 * draft outside the organization is not_found. Packets are the repository's
 * own membership, which applies the same rule.
 *
 * Conditional client review is NOT generated_content_review (GK, plus the
 * organization-owned review of ordinary internal evidence summaries below).
 * It is the existing P2-11 client follow-up on a cited
 * claim: an unresolved follow-up makes the claim ineligible, which holds the
 * draft back. The list reports how many GK-reviewed drafts are held only by
 * an unresolved client follow-up (a count, never their content), so a
 * client_reviewer can be pointed at the existing follow-up page.
 *
 * Generated Drafts are read for one selected engagement/project: only drafts
 * whose generation run is bound to that engagement (generation_runs, P14-01),
 * and the engagement must belong to the requested organization. The list is
 * bounded per request (CLIENT_DRAFT_SCAN_LIMIT index rows) and continues with
 * an opaque keyset cursor, so no draft is skipped or repeated.
 *
 * Per block the client gets the text and the cited claim ids, which match
 * the client-safe impact-facts claim ids; never evidence, source, version,
 * or citation ids, review statuses, or blocker codes.
 *
 * Admission: mapped human, the read_intake set with an active same-org
 * membership, tenant validation, before any read. Read-only; grants no
 * generation, review, export, or final-release authority.
 */
const CLIENT_GENERATED_CONTENT_OPERATION = "read_client_generated_content";
const CLIENT_GENERATED_CONTENT_ALLOWED_ROLES = new Set(KAI_SPRINT2_P0_OPERATION_ROLES.read_intake);
const CLIENT_DRAFT_INDEX_PAGE_LIMIT = 25;
// Index rows examined per request; a request never scans more.
const CLIENT_DRAFT_SCAN_LIMIT = 50;
const CLIENT_DRAFT_REVIEW_STATE = "reviewed";
const CLIENT_FOLLOWUP_BLOCKER_CODE = "client_followup_unresolved";
// Per-draft outcomes that mean "this draft is not currently presentable",
// never an error for the whole list.
const DRAFT_NOT_PRESENTABLE_CODES = new Set(["not_found", "conflict_current_state_changed"]);
const UUID_RE = KAI_SPRINT2_P0_PATTERNS.uuid;

const { isGeneratedDraftReviewPacketDto } = __generatedContentReviewPacketServiceTestables;
const { responseDraftSummary, isAudienceCompatible } = generatedDraftLibraryTestables;

class ClientProjectionError extends Error {}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCanonicalUuid(value) {
  return typeof value === "string" && value === value.toLowerCase() && UUID_RE.test(value);
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && typeof actorContext?.actorUserId === "string" && actorContext.actorUserId.length > 0;
}

function hasOnlyKeys(value, keys) {
  const allowed = new Set(keys);
  return isPlainObject(value) && Object.keys(value).every((key) => allowed.has(key)) && keys.every((key) => key in value);
}

async function createDefaultGeneratedContentRepository() {
  const { createPostgresGeneratedContentRepository } = await import("../dictionary/postgresGeneratedContentRepository.js");
  return createPostgresGeneratedContentRepository();
}

function admit(input, keys, dependencies, {
  operation = CLIENT_GENERATED_CONTENT_OPERATION,
  allowedRoles = CLIENT_GENERATED_CONTENT_ALLOWED_ROLES,
} = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env) || !isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled");
  if (!hasOnlyKeys(input, keys)) return buildKaiError("validation_blocker");
  for (const key of keys) {
    if (key !== "actorContext" && !isCanonicalUuid(input[key])) return buildKaiError("validation_blocker");
  }
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied");
  const auth = validateActorCanPerformOperation(input.actorContext, operation, input.organizationId, { allowedRoles });
  if (!auth.ok) return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  return null;
}

// A packet member as the single-draft review-packet contract defines it;
// packet reads may add export-manifest linkage, which is dropped unread.
function singleDraftPacket(packet) {
  if (!isPlainObject(packet)) return null;
  const { exportManifestId, exportManifestHistory, ...draft } = packet;
  return isGeneratedDraftReviewPacketDto(draft) ? draft : null;
}

function isGkReviewResolved(packet) {
  return packet.queueStatus === "resolved" && packet.reviewStatus === "resolved";
}

export function isClientVisibleDraftPacket(packet) {
  return isGkReviewResolved(packet)
    && packet.currentUseEligible === true
    && isAudienceCompatible(packet.contentType, packet.requestedAudience);
}

function isHeldOnlyByClientFollowup(packet) {
  if (!isGkReviewResolved(packet) || packet.currentUseEligible !== false) return false;
  const ineligible = packet.blocks.flatMap((block) => block.citations).filter((citation) => citation.currentEligible !== true);
  return ineligible.length > 0 && ineligible.every(
    (citation) => citation.blockerCodes.length > 0 && citation.blockerCodes.every((code) => code === CLIENT_FOLLOWUP_BLOCKER_CODE),
  );
}

function toClientDraft(packet) {
  return {
    generatedContentDraftId: packet.generatedContentDraftId,
    contentType: packet.contentType,
    audience: packet.requestedAudience,
    reviewState: CLIENT_DRAFT_REVIEW_STATE,
    blocks: packet.blocks.map((block) => ({
      ordinal: block.ordinal,
      text: block.text,
      supportingClaimIds: [...new Set(block.citations.map((citation) => citation.claimId))].sort(),
    })),
  };
}

// Continuation token: the keyset position after the last draft this page
// scanned (visible or not), so a following page never re-scans or skips a
// draft. Encoded so the browser treats it as opaque; decoding it grants
// nothing (a draft id is still read through the full visibility rule, and
// the scan stays inside the requested organization and engagement).
const CURSOR_PREFIX = "c1.";

function encodeCursor(generatedContentDraftId) {
  return CURSOR_PREFIX + Buffer.from(generatedContentDraftId, "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  if (typeof cursor !== "string" || !cursor.startsWith(CURSOR_PREFIX) || cursor.length > 64) return null;
  const decoded = Buffer.from(cursor.slice(CURSOR_PREFIX.length), "base64url").toString("utf8");
  return isCanonicalUuid(decoded) ? decoded : null;
}

// The selected project must be an engagement of the requested organization,
// checked against its own record (the engagement is project context inside
// the already-authorized organization, not a separate tenant).
async function resolveEngagement({ organizationId, engagementId }, dependencies) {
  const getEngagement = dependencies.getEngagementForOrganization || getEngagementForOrganization;
  const engagement = await getEngagement({ organizationId, engagementId });
  if (!engagement) return buildKaiError("not_found");
  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: organizationId,
    payload: { organization_id: organizationId, engagement_id: engagementId },
    engagementRecord: engagement,
  });
  if (tenant.severity === "blocker") return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  return null;
}

export async function listClientGeneratedDrafts(input, dependencies = {}) {
  const { cursor, ...required } = isPlainObject(input) ? input : {};
  const denied = admit(required, ["organizationId", "engagementId", "actorContext"], dependencies);
  if (denied) return denied;
  const after = cursor === undefined || cursor === null ? null : decodeCursor(cursor);
  if (cursor !== undefined && cursor !== null && after === null) return buildKaiError("validation_blocker");
  const { organizationId, engagementId } = required;
  const engagementError = await resolveEngagement({ organizationId, engagementId }, dependencies);
  if (engagementError) return engagementError;

  const readIndex = dependencies.listGeneratedDraftLibraryIndex || readGeneratedDraftLibraryIndex;
  const repository = dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());

  const items = [];
  let awaitingClientInputCount = 0;
  let scanned = 0;
  let position = after;
  let lastScanned = null;
  let moreRows = false;
  for (;;) {
    const rows = await readIndex(organizationId, {
      limit: CLIENT_DRAFT_INDEX_PAGE_LIMIT,
      afterGeneratedContentDraftId: position,
      engagementId,
    });
    if (!Array.isArray(rows) || rows.length > CLIENT_DRAFT_INDEX_PAGE_LIMIT + 1) return buildKaiError("system_error");
    const page = rows.slice(0, CLIENT_DRAFT_INDEX_PAGE_LIMIT);
    for (const [index, row] of page.entries()) {
      if (scanned >= CLIENT_DRAFT_SCAN_LIMIT) {
        moreRows = true;
        break;
      }
      // The GK index's own row contract, with export-review state withheld.
      const summary = responseDraftSummary(row, organizationId, false);
      if (!summary) return buildKaiError("system_error");
      scanned += 1;
      lastScanned = summary.generatedContentDraftId;
      if (index === page.length - 1 && rows.length > CLIENT_DRAFT_INDEX_PAGE_LIMIT) moreRows = true;
      if (summary.queueStatus !== "resolved" || summary.reviewStatus !== "resolved") continue;
      const result = await repository.getGeneratedDraftReviewPacket({
        organizationId,
        generatedContentDraftId: summary.generatedContentDraftId,
      });
      if (!result.ok) {
        if (DRAFT_NOT_PRESENTABLE_CODES.has(result.error?.code)) continue;
        return buildKaiError(result.error?.code || "system_error");
      }
      const packet = singleDraftPacket(result.data);
      if (!packet) return buildKaiError("system_error");
      if (isClientVisibleDraftPacket(packet)) {
        items.push({
          generatedContentDraftId: packet.generatedContentDraftId,
          contentType: packet.contentType,
          audience: packet.requestedAudience,
          reviewState: CLIENT_DRAFT_REVIEW_STATE,
          createdAt: summary.createdAt,
          blockCount: packet.blocks.length,
        });
      } else if (isHeldOnlyByClientFollowup(packet)) {
        awaitingClientInputCount += 1;
      }
    }
    if (scanned >= CLIENT_DRAFT_SCAN_LIMIT || rows.length <= CLIENT_DRAFT_INDEX_PAGE_LIMIT) break;
    moreRows = false;
    position = page.at(-1).generated_content_draft_id;
  }

  return {
    ok: true,
    data: {
      items,
      awaitingClientInputCount,
      nextCursor: moreRows && lastScanned ? encodeCursor(lastScanned) : null,
    },
    error: null,
  };
}

export async function getClientGeneratedDraft(input, dependencies = {}) {
  const denied = admit(input, ["organizationId", "engagementId", "generatedContentDraftId", "actorContext"], dependencies);
  if (denied) return denied;
  const { organizationId, engagementId, generatedContentDraftId } = input;
  const engagementError = await resolveEngagement({ organizationId, engagementId }, dependencies);
  if (engagementError) return engagementError;
  // A draft of another project in the same organization is not_found here,
  // exactly like a draft that does not exist.
  const readDraftEngagement = dependencies.readGeneratedDraftEngagementId || readGeneratedDraftEngagementId;
  if ((await readDraftEngagement(organizationId, generatedContentDraftId)) !== engagementId) return buildKaiError("not_found");
  const repository = dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());
  const result = await repository.getGeneratedDraftReviewPacket({ organizationId, generatedContentDraftId });
  if (!result.ok) {
    return buildKaiError(DRAFT_NOT_PRESENTABLE_CODES.has(result.error?.code) ? "not_found" : result.error?.code || "system_error");
  }
  const packet = singleDraftPacket(result.data);
  if (!packet) return buildKaiError("system_error");
  // A draft that exists but is not client-visible is indistinguishable from
  // one that does not exist.
  if (!isClientVisibleDraftPacket(packet)) return buildKaiError("not_found");
  return { ok: true, data: toClientDraft(packet), error: null };
}

function toClientPacketPreview(result, { engagementId, audience }) {
  const data = result.data;
  if (!isPlainObject(data) || data.engagementId !== engagementId || data.packetAudience !== audience || !Array.isArray(data.drafts)) {
    throw new ClientProjectionError("packet contract");
  }
  const drafts = data.drafts.map((member) => {
    const packet = singleDraftPacket(member);
    // The repository's membership already applies the visibility rule; a
    // member that does not satisfy it is a contract violation, not a skip.
    if (!packet || packet.requestedAudience !== audience || !isClientVisibleDraftPacket(packet)) {
      throw new ClientProjectionError("packet member contract");
    }
    return toClientDraft(packet);
  });
  return { engagementId, audience, status: drafts.length > 0 ? "available" : "no_reviewed_drafts", drafts };
}

async function readClientPacketPreview(input, dependencies, { method, audience }) {
  const denied = admit(input, ["organizationId", "engagementId", "actorContext"], dependencies);
  if (denied) return denied;
  const repository = dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());
  const result = await repository[method]({ organizationId: input.organizationId, engagementId: input.engagementId });
  // Repository blockers (execution bounds, Board Reporting diagnostics)
  // are internal; only the code crosses.
  if (!result.ok) return buildKaiError(result.error?.code || "system_error");
  try {
    return { ok: true, data: toClientPacketPreview(result, { engagementId: input.engagementId, audience }), error: null };
  } catch (error) {
    if (error instanceof ClientProjectionError) return buildKaiError("system_error");
    throw error;
  }
}

export async function getClientGrantResponsePacketPreview(input, dependencies = {}) {
  return readClientPacketPreview(input, dependencies, { method: "getGrantResponsePacket", audience: "funder" });
}

export async function getClientBoardReportingPreview(input, dependencies = {}) {
  return readClientPacketPreview(input, dependencies, { method: "getBoardReportingPacket", audience: BOARD_REPORTING_PACKET_AUDIENCE });
}

/**
 * The organization administrator's own internal drafts (owner decision
 * 2026-10-19). An active client_admin of the organization (stored or
 * binding-derived; the same organization-membership check that admits it to
 * generate them, CLIENT_ADMIN_DRAFT_ALLOWED_ROLES) may read the INTERNAL
 * evidence summaries and impact narratives of one selected Project, in any
 * Get Kinder review state, with their true review state. That is the content
 * the same administrator's generation response already returns; reading it
 * back grants nothing.
 *
 * - Only requested_audience 'internal' and content types evidence_summary /
 *   impact_narrative (the two an organization administrator generates);
 *   every other type and audience is not_found here.
 * - The draft's packet must be readable now: the repository re-runs P2-06
 *   for every cited claim (and so the effective allowed use), and a draft
 *   whose cited claim is no longer traceable is withheld, never shown stale.
 * - Projection: content type, audience, a client review state, whether
 *   every cited claim is currently eligible for internal use, fixed
 *   limitation codes, and per block its text and cited claim ids. Never
 *   queue/run/evidence/source ids, GK review vocabulary, validator results,
 *   prompts, or export-review/candidate state. The detail adds the release
 *   state (Plan A Prompt 8) and the factual-review view below.
 * - Review state (owner amendment 2026-10-23): an unreviewed ordinary
 *   internal evidence summary (postgresOrganizationInternalReviewRepository.js)
 *   is awaiting_organization_review; any other unreviewed draft is
 *   awaiting_get_kinder_review / in_get_kinder_review. A completed review is
 *   reviewed_by_your_organization when the organization-owned operation
 *   recorded it, otherwise reviewed_by_get_kinder.
 * - No release, funder/public eligibility, or export authority:
 *   `internal_use_only` and `not_approved_for_external_use` are always listed.
 */
const CLIENT_INTERNAL_DRAFT_OPERATION = "read_client_internal_drafts";
const CLIENT_INTERNAL_DRAFT_READ_ROLES = new Set(["client_admin"]);
const CLIENT_INTERNAL_DRAFT_CONTENT_TYPES = new Set(["evidence_summary", "impact_narrative"]);
const INTERNAL_AUDIENCE = "internal";
const CLIENT_INTERNAL_REVIEW_STATE = Object.freeze({
  AWAITING_GET_KINDER: "awaiting_get_kinder_review",
  IN_GET_KINDER: "in_get_kinder_review",
  AWAITING_ORGANIZATION: "awaiting_organization_review",
  REVIEWED_BY_GET_KINDER: "reviewed_by_get_kinder",
  REVIEWED_BY_ORGANIZATION: "reviewed_by_your_organization",
});
const REVIEWED_STATES = new Set([CLIENT_INTERNAL_REVIEW_STATE.REVIEWED_BY_GET_KINDER, CLIENT_INTERNAL_REVIEW_STATE.REVIEWED_BY_ORGANIZATION]);
const INTERNAL_DRAFT_ADMISSION = Object.freeze({
  operation: CLIENT_INTERNAL_DRAFT_OPERATION,
  allowedRoles: CLIENT_INTERNAL_DRAFT_READ_ROLES,
});

function queueLifecycle({ queueStatus, reviewStatus }) {
  if (queueStatus === "open" && reviewStatus === "needs_gk_review") return "open";
  if (queueStatus === "in_progress" && reviewStatus === "needs_gk_review") return "in_progress";
  if (queueStatus === "resolved" && reviewStatus === "resolved") return "resolved";
  return null;
}

async function organizationReviewRepository(dependencies) {
  return dependencies.organizationReviewRepository
    || (await import("../dictionary/postgresOrganizationInternalReviewRepository.js")).createPostgresOrganizationInternalReviewRepository();
}

// The draft's client review state and, while it is unreviewed, the
// organization-review evaluation it was derived from (null once reviewed).
async function internalReviewView({ organizationId, packet }, dependencies) {
  const lifecycle = queueLifecycle(packet);
  if (!lifecycle) return null;
  const organizationReview = await organizationReviewRepository(dependencies);
  if (lifecycle === "resolved") {
    const reviewer = await organizationReview.readCompletedReviewer({
      organizationId,
      generatedContentDraftId: packet.generatedContentDraftId,
      reviewQueueItemId: packet.reviewQueueItemId,
    });
    return {
      reviewState: reviewer === "organization"
        ? CLIENT_INTERNAL_REVIEW_STATE.REVIEWED_BY_ORGANIZATION
        : CLIENT_INTERNAL_REVIEW_STATE.REVIEWED_BY_GET_KINDER,
      evaluation: null,
    };
  }
  const evaluation = await organizationReview.evaluate({ organizationId, packet });
  if (evaluation.getKinderReviewReasons.length === 0) {
    return { reviewState: CLIENT_INTERNAL_REVIEW_STATE.AWAITING_ORGANIZATION, evaluation };
  }
  return {
    reviewState: lifecycle === "open" ? CLIENT_INTERNAL_REVIEW_STATE.AWAITING_GET_KINDER : CLIENT_INTERNAL_REVIEW_STATE.IN_GET_KINDER,
    evaluation,
  };
}

function isInternalDraftSummary(summary) {
  return CLIENT_INTERNAL_DRAFT_CONTENT_TYPES.has(summary.contentType) && summary.requestedAudience === INTERNAL_AUDIENCE;
}

function internalDraftLimitations(packet, reviewState) {
  return [
    "internal_use_only",
    "not_approved_for_external_use",
    ...(reviewState === CLIENT_INTERNAL_REVIEW_STATE.AWAITING_GET_KINDER || reviewState === CLIENT_INTERNAL_REVIEW_STATE.IN_GET_KINDER
      ? ["awaiting_get_kinder_review"]
      : []),
    ...(reviewState === CLIENT_INTERNAL_REVIEW_STATE.AWAITING_ORGANIZATION ? ["awaiting_organization_review"] : []),
    ...(packet.currentUseEligible === true ? [] : ["cited_claims_not_currently_eligible"]),
  ];
}

function toClientInternalDraft(packet, reviewState) {
  return {
    generatedContentDraftId: packet.generatedContentDraftId,
    contentType: packet.contentType,
    audience: INTERNAL_AUDIENCE,
    reviewState,
    citedClaimsCurrentlyEligible: packet.currentUseEligible === true,
    limitations: internalDraftLimitations(packet, reviewState),
    blocks: packet.blocks.map((block) => ({
      ordinal: block.ordinal,
      text: block.text,
      supportingClaimIds: [...new Set(block.citations.map((citation) => citation.claimId))].sort(),
    })),
  };
}

export async function listClientInternalDrafts(input, dependencies = {}) {
  const { cursor, ...required } = isPlainObject(input) ? input : {};
  const denied = admit(required, ["organizationId", "engagementId", "actorContext"], dependencies, INTERNAL_DRAFT_ADMISSION);
  if (denied) return denied;
  const after = cursor === undefined || cursor === null ? null : decodeCursor(cursor);
  if (cursor !== undefined && cursor !== null && after === null) return buildKaiError("validation_blocker");
  const { organizationId, engagementId } = required;
  const engagementError = await resolveEngagement({ organizationId, engagementId }, dependencies);
  if (engagementError) return engagementError;

  const readIndex = dependencies.listGeneratedDraftLibraryIndex || readGeneratedDraftLibraryIndex;
  const repository = dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());

  const items = [];
  let scanned = 0;
  let position = after;
  let lastScanned = null;
  let moreRows = false;
  for (;;) {
    const rows = await readIndex(organizationId, {
      limit: CLIENT_DRAFT_INDEX_PAGE_LIMIT,
      afterGeneratedContentDraftId: position,
      engagementId,
    });
    if (!Array.isArray(rows) || rows.length > CLIENT_DRAFT_INDEX_PAGE_LIMIT + 1) return buildKaiError("system_error");
    const page = rows.slice(0, CLIENT_DRAFT_INDEX_PAGE_LIMIT);
    for (const [index, row] of page.entries()) {
      if (scanned >= CLIENT_DRAFT_SCAN_LIMIT) {
        moreRows = true;
        break;
      }
      const summary = responseDraftSummary(row, organizationId, false);
      if (!summary) return buildKaiError("system_error");
      scanned += 1;
      lastScanned = summary.generatedContentDraftId;
      if (index === page.length - 1 && rows.length > CLIENT_DRAFT_INDEX_PAGE_LIMIT) moreRows = true;
      if (!isInternalDraftSummary(summary)) continue;
      if (!queueLifecycle(summary)) continue;
      const result = await repository.getGeneratedDraftReviewPacket({
        organizationId,
        generatedContentDraftId: summary.generatedContentDraftId,
      });
      if (!result.ok) {
        if (DRAFT_NOT_PRESENTABLE_CODES.has(result.error?.code)) continue;
        return buildKaiError(result.error?.code || "system_error");
      }
      const packet = singleDraftPacket(result.data);
      if (!packet) return buildKaiError("system_error");
      const view = await internalReviewView({ organizationId, packet }, dependencies);
      if (!view) continue;
      items.push({
        generatedContentDraftId: packet.generatedContentDraftId,
        contentType: packet.contentType,
        audience: INTERNAL_AUDIENCE,
        reviewState: view.reviewState,
        createdAt: summary.createdAt,
        blockCount: packet.blocks.length,
      });
    }
    if (scanned >= CLIENT_DRAFT_SCAN_LIMIT || rows.length <= CLIENT_DRAFT_INDEX_PAGE_LIMIT) break;
    moreRows = false;
    position = page.at(-1).generated_content_draft_id;
  }

  return {
    ok: true,
    data: { items, nextCursor: moreRows && lastScanned ? encodeCursor(lastScanned) : null },
    error: null,
  };
}

export async function getClientInternalDraft(input, dependencies = {}) {
  const denied = admit(input, ["organizationId", "engagementId", "generatedContentDraftId", "actorContext"], dependencies, INTERNAL_DRAFT_ADMISSION);
  if (denied) return denied;
  const { organizationId, engagementId, generatedContentDraftId } = input;
  const engagementError = await resolveEngagement({ organizationId, engagementId }, dependencies);
  if (engagementError) return engagementError;
  const readDraftEngagement = dependencies.readGeneratedDraftEngagementId || readGeneratedDraftEngagementId;
  if ((await readDraftEngagement(organizationId, generatedContentDraftId)) !== engagementId) return buildKaiError("not_found");
  const repository = dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());
  const result = await repository.getGeneratedDraftReviewPacket({ organizationId, generatedContentDraftId });
  if (!result.ok) {
    return buildKaiError(DRAFT_NOT_PRESENTABLE_CODES.has(result.error?.code) ? "not_found" : result.error?.code || "system_error");
  }
  const packet = singleDraftPacket(result.data);
  if (!packet) return buildKaiError("system_error");
  // Another audience or content type, or an unknown review state, is
  // indistinguishable from a draft that does not exist.
  if (!isInternalDraftSummary({ contentType: packet.contentType, requestedAudience: packet.requestedAudience }) || !queueLifecycle(packet)) {
    return buildKaiError("not_found");
  }
  const { reviewState, evaluation } = await internalReviewView({ organizationId, packet }, dependencies);
  const release = await clientReleaseState({
    organizationId, generatedContentDraftId, reviewState, actorContext: input.actorContext,
  }, dependencies);
  if (release.error) return release.error;
  return {
    ok: true,
    data: {
      ...toClientInternalDraft(packet, reviewState),
      release: release.value,
      factualReview: clientFactualReviewView({ reviewState, evaluation, actorContext: input.actorContext, organizationId }),
    },
    error: null,
  };
}

// What the detail shows about the factual review: whether this actor may
// approve it now, and the reason codes that hold it for Get Kinder or block
// it. Server-authoritative; the UI shows the approval action only when
// actorMayApprove is true.
function clientFactualReviewView({ reviewState, evaluation, actorContext, organizationId }) {
  const getKinderReviewReasons = evaluation ? [...evaluation.getKinderReviewReasons] : [];
  const blockedReasons = evaluation ? [...evaluation.blockedReasons] : [];
  const actorMayApprove = reviewState === CLIENT_INTERNAL_REVIEW_STATE.AWAITING_ORGANIZATION
    && evaluation?.organizationMayReview === true
    && validateActorCanPerformOperation(actorContext, CLIENT_INTERNAL_FACTUAL_REVIEW_OPERATION, organizationId, {
      allowedRoles: CLIENT_INTERNAL_FACTUAL_REVIEW_ROLES,
    }).ok === true;
  return { actorMayApprove, getKinderReviewReasons, blockedReasons };
}

/**
 * Organization-owned factual review of an ordinary internal Evidence Summary
 * (owner amendment 2026-10-23; Operating Model v0.2 section 11). An active
 * client_admin of this organization, for a draft generated under this
 * Project, records the factual approval through the existing generated-
 * content review lifecycle (start, then complete), with its transactions,
 * optimistic concurrency, replay and audit. Each transition re-evaluates the
 * review packet (P2-06 for every cited claim) and then the organization-
 * review admission (postgresOrganizationInternalReviewRepository.js) inside
 * its own transaction before writing, so a high-risk, unsupported, stale or
 * no-longer-permitted draft is refused with structured blockers and nothing
 * is written. The completion audit records the organization contract.
 *
 * Only `decision: "approved"` exists: the review lifecycle has no reject or
 * needs-changes outcome (it would need a new schema contract). Declining is
 * not approving; a corrected draft is generated anew.
 *
 * This is the factual review only. It grants no export review, limitation
 * snapshot, release authority or manifest: those stay Get Kinder's, because
 * limitation_snapshots.confirmed_by_role and the export_authority_granted
 * decided_by_role are schema-pinned to GK roles (P3-16, P3-17).
 */
const CLIENT_INTERNAL_FACTUAL_REVIEW_OPERATION = "record_client_internal_draft_factual_review";
const CLIENT_INTERNAL_FACTUAL_REVIEW_ROLES = new Set(["client_admin"]);
const CLIENT_INTERNAL_FACTUAL_REVIEW_DECISIONS = new Set(["approved"]);
const FACTUAL_REVIEW_ADMISSION = Object.freeze({
  operation: CLIENT_INTERNAL_FACTUAL_REVIEW_OPERATION,
  allowedRoles: CLIENT_INTERNAL_FACTUAL_REVIEW_ROLES,
});

function repositoryError(result) {
  return buildKaiError(result.error?.code || "system_error", result.blockers ? { blockers: result.blockers } : {});
}

export async function approveClientInternalDraftFactualReview(input, dependencies = {}) {
  const { decision, ...scope } = isPlainObject(input) ? input : {};
  const denied = admit(scope, ["organizationId", "engagementId", "generatedContentDraftId", "actorContext"], dependencies, FACTUAL_REVIEW_ADMISSION);
  if (denied) return denied;
  if (!CLIENT_INTERNAL_FACTUAL_REVIEW_DECISIONS.has(decision)) return buildKaiError("validation_blocker");
  if (typeof dependencies.createReviewAudit !== "function") return buildKaiError("system_error");
  const { organizationId, engagementId, generatedContentDraftId, actorContext } = scope;
  const engagementError = await resolveEngagement({ organizationId, engagementId }, dependencies);
  if (engagementError) return engagementError;
  const readDraftEngagement = dependencies.readGeneratedDraftEngagementId || readGeneratedDraftEngagementId;
  if ((await readDraftEngagement(organizationId, generatedContentDraftId)) !== engagementId) return buildKaiError("not_found");

  const repository = dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());
  const readPacket = async () => {
    const result = await repository.getGeneratedDraftReviewPacket({ organizationId, generatedContentDraftId });
    if (!result.ok) return { error: repositoryError(result) };
    const packet = singleDraftPacket(result.data);
    return packet ? { packet } : { error: buildKaiError("system_error") };
  };
  let current = await readPacket();
  if (current.error) return current.error;
  if (!isInternalDraftSummary({ contentType: current.packet.contentType, requestedAudience: current.packet.requestedAudience })) {
    return buildKaiError("not_found");
  }
  const lifecycle = queueLifecycle(current.packet);
  if (!lifecycle) return buildKaiError("conflict_current_state_changed");
  if (lifecycle === "resolved") {
    const { reviewState } = await internalReviewView({ organizationId, packet: current.packet }, dependencies);
    return { ok: true, data: { generatedContentDraftId, reviewState, replayed: true }, error: null };
  }

  const evaluateInTransaction = dependencies.evaluateOrganizationInternalReviewInTransaction
    || (await import("../dictionary/postgresOrganizationInternalReviewRepository.js")).evaluateOrganizationInternalReviewInTransaction;
  const { organizationReviewBlockers, ORGANIZATION_REVIEW_COMPLETION_AUDIT_CONTRACT } = await import(
    "../dictionary/postgresOrganizationInternalReviewRepository.js"
  );
  const reviewAdmission = async (tx, packet) => {
    const evaluation = await evaluateInTransaction(tx, { organizationId, packet });
    if (evaluation.organizationMayReview) return null;
    return { ok: false, data: null, error: { code: "blocked", status: 422 }, blockers: organizationReviewBlockers(evaluation) };
  };
  const clock = dependencies.now || (() => new Date().toISOString());
  const transition = (method, packet, extra = {}) => {
    const now = clock();
    return repository[method]({
      organizationId,
      generatedContentDraftId,
      reviewQueueItemId: packet.reviewQueueItemId,
      expectedUpdatedAt: packet.reviewUpdatedAt,
      actorContext,
      now,
    }, {
      metadataOnlyAudit: dependencies.createReviewAudit({ reviewQueueItemId: packet.reviewQueueItemId, now }),
      reviewAdmission,
      ...extra,
    });
  };

  if (lifecycle === "open") {
    const started = await transition("startGeneratedContentReview", current.packet);
    if (!started.ok) return repositoryError(started);
    current = await readPacket();
    if (current.error) return current.error;
  }
  const completed = await transition("completeGeneratedContentReview", current.packet, {
    completionAuditContract: ORGANIZATION_REVIEW_COMPLETION_AUDIT_CONTRACT,
  });
  if (!completed.ok) return repositoryError(completed);
  return {
    ok: true,
    data: { generatedContentDraftId, reviewState: CLIENT_INTERNAL_REVIEW_STATE.REVIEWED_BY_ORGANIZATION, replayed: completed.data?.replayed === true },
    error: null,
  };
}

/**
 * Read-only receipt of an already GK-released internal report (Plan A
 * Prompt 8). Final release stays Get Kinder's (factual review of an ordinary
 * internal evidence summary may be the organization's, above): the
 * organization administrator only reads the Markdown of a release Get Kinder
 * has already made, and only while it is still valid. Operating Model v0.2
 * section 11 ("GK reviews the relevant output ... Release") and section 7.1
 * ("generate internal/client drafts") cover delivering a GK-released internal
 * output to the organization; this grants no review, export, or release
 * authority.
 *
 * Admission: mapped human, client_admin with an active same-organization
 * membership, tenant validation, the Project (engagement) in this
 * organization, before any read. Then the manifest must be this
 * organization's, for the internal audience, of an internal draft type, and
 * its draft generated under this Project; anything else is not_found, never
 * disclosed. Every retrieval re-runs the existing render-model repository,
 * which checks candidate currentness and the P3-18 final export gate
 * (effective release authority, current-use eligibility, audience): a revoked
 * release or a stale source is conflict_current_state_changed. Markdown only.
 */
const CLIENT_RELEASED_REPORT_OPERATION = "read_client_released_internal_report";
const CLIENT_RELEASED_REPORT_READ_ROLES = new Set(["client_admin"]);
const RELEASED_REPORT_ADMISSION = Object.freeze({
  operation: CLIENT_RELEASED_REPORT_OPERATION,
  allowedRoles: CLIENT_RELEASED_REPORT_READ_ROLES,
});
const RELEASE_STATE = Object.freeze({
  AWAITING_REVIEW: "awaiting_get_kinder_review",
  AWAITING_ORGANIZATION_REVIEW: "awaiting_organization_review",
  AWAITING_RELEASE: "awaiting_get_kinder_release",
  RELEASED: "released_for_internal_use",
  NO_LONGER_AVAILABLE: "release_no_longer_valid",
  UNAVAILABLE: "release_status_unavailable",
});

async function releasedReportRepositories(dependencies) {
  const releasedReportRepository = dependencies.releasedReportRepository
    || (await import("../dictionary/postgresClientReleasedReportRepository.js")).createPostgresClientReleasedReportRepository();
  const renderModelRepository = dependencies.renderModelRepository
    || (await import("../dictionary/postgresExportManifestRenderModelRepository.js")).createPostgresExportManifestRenderModelRepository();
  return { releasedReportRepository, renderModelRepository };
}

function mayReceiveReleasedReports(actorContext, organizationId, env) {
  return isKaiPublicExportEnabled(env)
    && validateActorCanPerformOperation(actorContext, CLIENT_RELEASED_REPORT_OPERATION, organizationId, {
      allowedRoles: CLIENT_RELEASED_REPORT_READ_ROLES,
    }).ok === true;
}

// The draft's release state from the same authorities retrieval uses: its
// latest internal manifest, and whether that manifest renders now.
async function clientReleaseState({ organizationId, generatedContentDraftId, reviewState, actorContext }, dependencies) {
  const none = (state) => ({ value: { state, releasedReportId: null } });
  if (!REVIEWED_STATES.has(reviewState)) {
    return none(reviewState === CLIENT_INTERNAL_REVIEW_STATE.AWAITING_ORGANIZATION
      ? RELEASE_STATE.AWAITING_ORGANIZATION_REVIEW
      : RELEASE_STATE.AWAITING_REVIEW);
  }
  if (!mayReceiveReleasedReports(actorContext, organizationId, dependencies.env || process.env)) return none(RELEASE_STATE.UNAVAILABLE);
  const { releasedReportRepository, renderModelRepository } = await releasedReportRepositories(dependencies);
  const latest = await releasedReportRepository.readLatestInternalReleaseForDraft({ organizationId, generatedContentDraftId });
  if (!latest) return none(RELEASE_STATE.AWAITING_RELEASE);
  const rendered = await renderModelRepository.composeExportManifestRenderModel({ organizationId, exportManifestId: latest.exportManifestId });
  if (rendered.ok) return { value: { state: RELEASE_STATE.RELEASED, releasedReportId: latest.exportManifestId } };
  if (DRAFT_NOT_PRESENTABLE_CODES.has(rendered.error?.code)) return none(RELEASE_STATE.NO_LONGER_AVAILABLE);
  return { error: buildKaiError(rendered.error?.code || "system_error") };
}

export async function getClientReleasedReportMarkdown(input, dependencies = {}) {
  const denied = admit(input, ["organizationId", "engagementId", "exportManifestId", "actorContext"], dependencies, RELEASED_REPORT_ADMISSION);
  if (denied) return denied;
  if (!isKaiPublicExportEnabled(dependencies.env || process.env)) return buildKaiError("feature_disabled");
  const { organizationId, engagementId, exportManifestId } = input;
  const engagementError = await resolveEngagement({ organizationId, engagementId }, dependencies);
  if (engagementError) return engagementError;
  const { releasedReportRepository, renderModelRepository } = await releasedReportRepositories(dependencies);
  const scope = await releasedReportRepository.readReleasedReportScope({ organizationId, exportManifestId });
  if (!scope || scope.requestedAudience !== INTERNAL_AUDIENCE || !CLIENT_INTERNAL_DRAFT_CONTENT_TYPES.has(scope.contentType)) {
    return buildKaiError("not_found");
  }
  const readDraftEngagement = dependencies.readGeneratedDraftEngagementId || readGeneratedDraftEngagementId;
  if ((await readDraftEngagement(organizationId, scope.generatedContentDraftId)) !== engagementId) return buildKaiError("not_found");
  const rendered = await renderModelRepository.composeExportManifestRenderModel({ organizationId, exportManifestId });
  if (!rendered.ok) return buildKaiError(rendered.error?.code || "system_error");
  return {
    ok: true,
    data: {
      markdownContractVersion: __exportManifestMarkdownSerializerTestables.MARKDOWN_CONTRACT_VERSION,
      markdown: serializeExportManifestRenderModelToMarkdown(rendered.data),
    },
    error: null,
  };
}

export const __clientGeneratedContentServiceContract = Object.freeze({
  CLIENT_INTERNAL_FACTUAL_REVIEW_OPERATION,
  CLIENT_INTERNAL_FACTUAL_REVIEW_ROLES,
  CLIENT_INTERNAL_REVIEW_STATE,
  CLIENT_RELEASED_REPORT_OPERATION,
  CLIENT_RELEASED_REPORT_READ_ROLES,
  RELEASE_STATE,
  CLIENT_INTERNAL_DRAFT_OPERATION,
  CLIENT_INTERNAL_DRAFT_READ_ROLES,
  CLIENT_INTERNAL_DRAFT_CONTENT_TYPES,
  CLIENT_GENERATED_CONTENT_OPERATION,
  CLIENT_GENERATED_CONTENT_ALLOWED_ROLES,
  CLIENT_DRAFT_SCAN_LIMIT,
  CLIENT_DRAFT_REVIEW_STATE,
  CLIENT_FOLLOWUP_BLOCKER_CODE,
});
