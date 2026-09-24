import { isKaiSprint2Enabled, isKaiGenerationEnabled } from "../config/kaiSprint2Config.js";
import { KAI_SPRINT2_P0_OPERATION_ROLES, KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { listGeneratedDraftLibraryIndex as readGeneratedDraftLibraryIndex } from "../db/kaiGeneratedDraftLibraryReadModels.js";
import { __generatedContentReviewPacketServiceTestables } from "./kaiGeneratedContentService.js";
import { __testables as generatedDraftLibraryTestables } from "./kaiGeneratedDraftLibraryService.js";
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
 * evaluateGrantResponsePacketMembershipInTransaction) - its GK
 * generated_content_review is resolved/resolved AND currentUseEligible is
 * true (every cited claim is currently eligible for the draft's requested
 * audience through the P2-06 evaluator). Not-yet-reviewed, blocked,
 * superseded-evidence, or audience-ineligible drafts are never shown; a
 * draft outside the organization is not_found. Packets are the repository's
 * own membership, which applies the same rule.
 *
 * Conditional client review is NOT generated_content_review (GK-only,
 * needs_gk_review). It is the existing P2-11 client follow-up on a cited
 * claim: an unresolved follow-up makes the claim ineligible, which holds the
 * draft back. The list reports how many GK-reviewed drafts are held only by
 * an unresolved client follow-up (a count, never their content), so a
 * client_reviewer can be pointed at the existing follow-up page.
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
const CLIENT_DRAFT_MAX_SCANNED = 50;
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

function admit(input, keys, dependencies) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env) || !isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled");
  if (!hasOnlyKeys(input, keys)) return buildKaiError("validation_blocker");
  for (const key of keys) {
    if (key !== "actorContext" && !isCanonicalUuid(input[key])) return buildKaiError("validation_blocker");
  }
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied");
  const auth = validateActorCanPerformOperation(
    input.actorContext,
    CLIENT_GENERATED_CONTENT_OPERATION,
    input.organizationId,
    { allowedRoles: CLIENT_GENERATED_CONTENT_ALLOWED_ROLES },
  );
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

export async function listClientGeneratedDrafts(input, dependencies = {}) {
  const denied = admit(input, ["organizationId", "actorContext"], dependencies);
  if (denied) return denied;
  const { organizationId } = input;

  const readIndex = dependencies.listGeneratedDraftLibraryIndex || readGeneratedDraftLibraryIndex;
  const repository = dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());

  const items = [];
  let awaitingClientInputCount = 0;
  let scanned = 0;
  let after = null;
  let truncated = false;
  for (;;) {
    const rows = await readIndex(organizationId, { limit: CLIENT_DRAFT_INDEX_PAGE_LIMIT, afterGeneratedContentDraftId: after });
    if (!Array.isArray(rows) || rows.length > CLIENT_DRAFT_INDEX_PAGE_LIMIT + 1) return buildKaiError("system_error");
    const page = rows.slice(0, CLIENT_DRAFT_INDEX_PAGE_LIMIT);
    for (const row of page) {
      if (scanned >= CLIENT_DRAFT_MAX_SCANNED) {
        truncated = true;
        break;
      }
      scanned += 1;
      // The GK index's own row contract, with export-review state withheld.
      const summary = responseDraftSummary(row, organizationId, false);
      if (!summary) return buildKaiError("system_error");
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
    if (truncated || rows.length <= CLIENT_DRAFT_INDEX_PAGE_LIMIT) break;
    after = page.at(-1).generated_content_draft_id;
  }

  return { ok: true, data: { items, awaitingClientInputCount, truncated }, error: null };
}

export async function getClientGeneratedDraft(input, dependencies = {}) {
  const denied = admit(input, ["organizationId", "generatedContentDraftId", "actorContext"], dependencies);
  if (denied) return denied;
  const repository = dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());
  const result = await repository.getGeneratedDraftReviewPacket({
    organizationId: input.organizationId,
    generatedContentDraftId: input.generatedContentDraftId,
  });
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

export const __clientGeneratedContentServiceContract = Object.freeze({
  CLIENT_GENERATED_CONTENT_OPERATION,
  CLIENT_GENERATED_CONTENT_ALLOWED_ROLES,
  CLIENT_DRAFT_MAX_SCANNED,
  CLIENT_DRAFT_REVIEW_STATE,
  CLIENT_FOLLOWUP_BLOCKER_CODE,
});
