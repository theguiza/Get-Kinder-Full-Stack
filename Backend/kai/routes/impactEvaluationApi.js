import express from "express";
import { KAI_ERROR_STATUS, sendKaiError } from "../errors/kaiErrors.js";
import { requireKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import {
  requireKaiSprint2Authenticated,
  attachKaiSprint2ActorContext,
} from "../middleware/kaiSprint2Authentication.js";
import {
  evaluateImpactOutcomeContext,
  createImpactEvaluation,
} from "../services/kaiImpactEvaluationService.js";

/**
 * A2.3 authenticated internal Impact Library route. This is the smallest
 * safe existing KAI product convention available for A2: the controlled
 * assistant tool surface (Backend/kai/validators/assistantBoundaryValidators.js
 * `CLAIM_TRACEABILITY_METADATA_OPERATIONS`) is a fixed, already-tested
 * five-operation allowlist of read-only metadata operations that never
 * invoke an AI seam of their own and never write a table -- widening it to
 * add an AI-invoking (`/preview`) or persisting (`POST /`) operation would
 * both reopen already-completed, separately-tested work and hand an
 * assistant/system actor a path to a write it must never have
 * (Backend/kai/validators/assistantBoundaryValidators.js `P0_MUTATION_OPERATIONS`
 * / `FORBIDDEN_ASSISTANT_OPERATIONS` already forbid exactly this class of
 * operation for a non-human actor). So this instead follows the existing
 * authenticated-route convention used by every other Package 1/2/3 KAI
 * surface (see Backend/kai/routes/kaiAccessAdministrationApi.js): the same
 * requireKaiSprint2Enabled / requireKaiSprint2Authenticated /
 * attachKaiSprint2ActorContext chain, no new authentication mechanism, and
 * every handler validates/normalizes its own request shape and calls
 * exactly one service function -- no SQL, no kai.* DB helper, and no db pool
 * import appears anywhere in this file.
 */

const router = express.Router();

router.use(requireKaiSprint2Enabled);
router.use(requireKaiSprint2Authenticated);
router.use(attachKaiSprint2ActorContext);

let impactEvaluationServiceOverride = null;

function getImpactEvaluationService() {
  return (
    impactEvaluationServiceOverride || {
      evaluateImpactOutcomeContext,
      createImpactEvaluation,
    }
  );
}

function sendServiceResult(res, result, successStatus = 200) {
  if (result?.ok) {
    return res.status(successStatus).json({ ok: true, data: result.data ?? null, warnings: result.warnings || [] });
  }
  const requestedCode = result?.error?.code;
  const code = requestedCode && Object.hasOwn(KAI_ERROR_STATUS, requestedCode) ? requestedCode : "system_error";
  return sendKaiError(res, code, {
    data: null,
    blockers: Array.isArray(result?.blockers) ? result.blockers : [],
    warnings: [],
  });
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function parseClaimIds(raw) {
  return Array.isArray(raw) && raw.length > 0 && raw.every((claimId) => typeof claimId === "string")
    ? raw
    : null;
}

function parseEvaluationRequestBody(req) {
  const organizationId = req.params.organizationId;
  const impactOutcomeContextId = req.body?.impact_outcome_context_id;
  const frameworkVersionId = req.body?.framework_version_id;
  const requestedAudience = req.body?.requested_audience;
  const claimIds = parseClaimIds(req.body?.claim_ids);
  if (
    !isNonEmptyString(organizationId)
    || !isNonEmptyString(impactOutcomeContextId)
    || !isNonEmptyString(frameworkVersionId)
    || !isNonEmptyString(requestedAudience)
    || !claimIds
  ) return null;
  return { organizationId, impactOutcomeContextId, frameworkVersionId, requestedAudience, claimIds };
}

/**
 * A2.1 preview: read-only, non-persisting bounded AI evaluation. Runs the
 * exact same server-side id/eligibility revalidation and result validation
 * as `POST /impact-evaluations` below, but never writes
 * kai.impact_evaluations / kai.impact_evaluation_results / A1.4 provenance.
 */
router.post("/organizations/:organizationId/impact-evaluations/preview", async (req, res, next) => {
  try {
    const parsed = parseEvaluationRequestBody(req);
    if (!parsed) return sendKaiError(res, "validation_blocker");

    const result = await getImpactEvaluationService().evaluateImpactOutcomeContext({
      ...parsed,
      actorContext: req.kaiSprint2ActorContext,
    });
    return sendServiceResult(res, result, 200);
  } catch (error) {
    return next(error);
  }
});

/**
 * A2.2 create: persists a governed Impact Evaluation snapshot + criterion
 * results + A1.4 provenance links, then attaches the purely derived,
 * advisory interpretation/gap/recommendation/classification view. Reached
 * only through the same authenticated, mapped-human-actor path every other
 * KAI write route uses -- the AI seam inside the service has no route or DB
 * access of its own and cannot reach this route directly.
 */
router.post("/organizations/:organizationId/impact-evaluations", async (req, res, next) => {
  try {
    const parsed = parseEvaluationRequestBody(req);
    if (!parsed) return sendKaiError(res, "validation_blocker");

    const result = await getImpactEvaluationService().createImpactEvaluation({
      ...parsed,
      actorContext: req.kaiSprint2ActorContext,
      now: new Date().toISOString(),
    });
    return sendServiceResult(res, result, 201);
  } catch (error) {
    return next(error);
  }
});

export default router;

export const __testables = {
  setImpactEvaluationServiceForTest(service) {
    impactEvaluationServiceOverride = service;
    return () => {
      impactEvaluationServiceOverride = null;
    };
  },
};
