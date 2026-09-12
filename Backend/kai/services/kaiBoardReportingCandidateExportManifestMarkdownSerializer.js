import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import {
  CREATE_BOARD_REPORTING_CANDIDATE_EXPORT_MANIFEST_ALLOWED_ROLES,
  CREATE_BOARD_REPORTING_CANDIDATE_EXPORT_MANIFEST_OPERATION,
} from "../dictionary/boardReportingCandidateExportManifestContract.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { serializeBoardReportingRenderModelToMarkdown } from "./kaiBoardReportingMarkdownSerializer.js";

// ---------------------------------------------------------------------------
// Governed Board Summary FINAL Markdown delivery, authorized solely by an
// exact, existing boardReportingCandidateExportManifestId - never by
// organizationId+engagementId alone, a candidate id without its manifest, or
// a latest/newest/preferred selection. Mirrors the existing P14-08C
// kaiGrantResponsePacketExportManifestMarkdownSerializer.js pattern exactly:
// reuses the existing Board Markdown pure text-generation function
// unmodified (no new Markdown format) via its existing, additive delivery-
// class/contract-version override parameters, so this pipeline's output
// correctly self-labels as FINAL_MANIFEST_BOUND rather than as a preview.
// Delegates the entire manifest-bound render-model reconstruction (including
// the Board candidate/currentness fingerprint proof) to the new
// postgresBoardReportingCandidateExportManifestRenderModelRepository.js -
// this file reimplements none of that. Reuses the exact same gk_admin-only
// CREATE_BOARD_REPORTING_CANDIDATE_EXPORT_MANIFEST_ALLOWED_ROLES/_OPERATION
// gate the manifest-creation service already established for this manifest
// track. Produces no manifest, records no BR-04 decision, changes no review
// state, reruns no final eligibility, produces no candidate, and exposes no
// raw evidence/source body beyond the existing governed Board render-model
// contract.
// ---------------------------------------------------------------------------

const FINAL_MARKDOWN_CONTRACT_VERSION = "kai-sprint2-board-reporting-markdown-final-v1";
const FINAL_DELIVERY_CLASS = "FINAL_MANIFEST_BOUND";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function hasExactKeys(value, allowed) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human"
    && typeof actorContext?.actorUserId === "string"
    && actorContext.actorUserId.length > 0;
}

// Exact-keys input contract: organizationId + boardReportingCandidateExportManifestId
// + actorContext, and NOTHING else - no engagementId, candidate id,
// fingerprint, member list, eligibility, or authority state is ever accepted
// from a caller (an engagementId is never even needed - the manifest's own
// bound candidate resolves it).
function isSerializeBoardReportingCandidateExportManifestToMarkdownInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "boardReportingCandidateExportManifestId", "actorContext"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.boardReportingCandidateExportManifestId)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext);
}

async function createDefaultDependencies() {
  const { createPostgresBoardReportingCandidateExportManifestRenderModelRepository } = await import(
    "../dictionary/postgresBoardReportingCandidateExportManifestRenderModelRepository.js"
  );
  return { repository: createPostgresBoardReportingCandidateExportManifestRenderModelRepository() };
}

export async function serializeBoardReportingCandidateExportManifestToMarkdown(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isSerializeBoardReportingCandidateExportManifestToMarkdownInput(input)) {
    return buildKaiError("validation_blocker", { data: null });
  }
  // An assistant/system actorContext is refused here (before any repository
  // call) - only a mapped human actor may ever reach the gk_admin
  // authorization check below.
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied", { data: null });

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    CREATE_BOARD_REPORTING_CANDIDATE_EXPORT_MANIFEST_OPERATION,
    input.organizationId,
    { allowedRoles: CREATE_BOARD_REPORTING_CANDIDATE_EXPORT_MANIFEST_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers, data: null });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant], data: null });
  }

  const defaults = dependencies.repository ? null : await createDefaultDependencies();
  const repository = dependencies.repository || defaults.repository;

  const result = await repository.composeBoardReportingCandidateExportManifestRenderModel({
    organizationId: input.organizationId,
    boardReportingCandidateExportManifestId: input.boardReportingCandidateExportManifestId,
    actorContext: input.actorContext,
  }, dependencies.renderModelDependencies || {});
  if (!result.ok) return { ok: false, data: null, error: result.error };

  // Explicit allowlist projection - never a passthrough spread. No raw
  // render-model internals (blocks/citations bytes) are duplicated here
  // outside the markdown field itself.
  return {
    ok: true,
    data: {
      boardReportingCandidateExportManifestId: result.data.boardReportingCandidateExportManifestId,
      boardReportingCandidateId: result.data.boardReportingCandidateId,
      markdownContractVersion: FINAL_MARKDOWN_CONTRACT_VERSION,
      deliveryClass: FINAL_DELIVERY_CLASS,
      markdown: serializeBoardReportingRenderModelToMarkdown(result.data.renderModel, {
        markdownContractVersion: FINAL_MARKDOWN_CONTRACT_VERSION,
        deliveryClass: FINAL_DELIVERY_CLASS,
      }),
    },
    error: null,
  };
}

export const __boardReportingCandidateExportManifestMarkdownSerializerContract = Object.freeze({
  FINAL_MARKDOWN_CONTRACT_VERSION,
  FINAL_DELIVERY_CLASS,
  CREATE_BOARD_REPORTING_CANDIDATE_EXPORT_MANIFEST_ALLOWED_ROLES,
  CREATE_BOARD_REPORTING_CANDIDATE_EXPORT_MANIFEST_OPERATION,
});

export const __boardReportingCandidateExportManifestMarkdownSerializerTestables = Object.freeze({
  isSerializeBoardReportingCandidateExportManifestToMarkdownInput,
  isMappedHumanActor,
});
