import express from "express";
import { KAI_ERROR_STATUS, sendKaiError } from "../errors/kaiErrors.js";
import { requireKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import {
  requireKaiSprint2Authenticated,
  attachKaiSprint2ActorContext,
} from "../middleware/kaiSprint2Authentication.js";
import {
  viewEffectiveKaiAccess,
  manageOrganizationMembership,
  grantOrganizationRole,
  revokeOrganizationRole,
  manageGlobalKaiRole,
  getAccessAdministrationContext,
  onboardGkStaffMember,
  offboardGkStaffRole,
} from "../services/kaiAccessAdministrationService.js";
import {
  listPendingOrganizationJoinRequestsForReviewer,
  approveOrganizationJoinRequest,
  declineOrganizationJoinRequest,
} from "../services/kaiOrganizationJoinRequestReviewService.js";
import { KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";

/**
 * Package 2 governed role/organization-access administration routes. Every
 * handler validates/normalizes its own request shape and calls exactly one
 * service function - no SQL, no kai.* DB helper, and no db pool import
 * appears anywhere in this file.
 */

const router = express.Router();

router.use(requireKaiSprint2Enabled);
router.use(requireKaiSprint2Authenticated);
router.use(attachKaiSprint2ActorContext);

const LEGACY_USER_ID_PATTERN = /^[1-9][0-9]*$/;
const ROLE_NAME_PATTERN = /^[a-z][a-z_]{0,63}$/;

// Test-only service-boundary override, following the same
// setXServiceForTest(service)/getXService() idiom already established for
// every other Package 1/2/3 KAI route (see Backend/kai/routes/sprint2IntakeApi.js).
// When unset (the only state in production), getAccessAdministrationService()
// returns exactly the real imported service functions - zero production
// behavior change.
let accessAdministrationServiceOverride = null;

function getAccessAdministrationService() {
  return (
    accessAdministrationServiceOverride || {
      viewEffectiveKaiAccess,
      manageOrganizationMembership,
      grantOrganizationRole,
      revokeOrganizationRole,
      manageGlobalKaiRole,
      getAccessAdministrationContext,
      onboardGkStaffMember,
      offboardGkStaffRole,
      listPendingOrganizationJoinRequestsForReviewer,
      approveOrganizationJoinRequest,
      declineOrganizationJoinRequest,
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

function parseLegacyUserId(raw) {
  if (typeof raw !== "string" || !LEGACY_USER_ID_PATTERN.test(raw)) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

// Prompt 4: the Team & Access administration context (platform superuser:
// the organizations it may administer; anyone else: not available). No query
// or body fields.
router.get("/administration-context", async (req, res, next) => {
  try {
    if (Object.keys(req.query || {}).length !== 0) return sendKaiError(res, "validation_blocker");
    const result = await getAccessAdministrationService().getAccessAdministrationContext({
      actorContext: req.kaiSprint2ActorContext,
    });
    return sendServiceResult(res, result, 200);
  } catch (error) {
    return next(error);
  }
});

router.get("/organizations/:organizationId/access", async (req, res, next) => {
  try {
    const organizationId = typeof req.params.organizationId === "string" ? req.params.organizationId : null;
    if (!organizationId) return sendKaiError(res, "validation_blocker");

    const result = await getAccessAdministrationService().viewEffectiveKaiAccess({
      actorContext: req.kaiSprint2ActorContext,
      organizationId,
    });
    return sendServiceResult(res, result, 200);
  } catch (error) {
    return next(error);
  }
});

router.put("/organizations/:organizationId/memberships/:legacyPublicUserdataId", async (req, res, next) => {
  try {
    const organizationId = typeof req.params.organizationId === "string" ? req.params.organizationId : null;
    const targetLegacyPublicUserdataId = parseLegacyUserId(req.params.legacyPublicUserdataId);
    const roleName = typeof req.body?.role_name === "string" ? req.body.role_name : null;
    const membershipStatus = typeof req.body?.membership_status === "string" ? req.body.membership_status : null;
    // Optional: the exact existing assignment an explicit replacement removes.
    const hasPreviousRoleName = req.body?.previous_role_name !== undefined;
    const previousRoleName = typeof req.body?.previous_role_name === "string" ? req.body.previous_role_name : null;

    if (!organizationId || !targetLegacyPublicUserdataId || !roleName || !membershipStatus || (hasPreviousRoleName && !previousRoleName)) {
      return sendKaiError(res, "validation_blocker");
    }

    const result = await getAccessAdministrationService().manageOrganizationMembership({
      actorContext: req.kaiSprint2ActorContext,
      organizationId,
      targetLegacyPublicUserdataId,
      roleName,
      membershipStatus,
      ...(hasPreviousRoleName ? { previousRoleName } : {}),
      now: new Date().toISOString(),
    });
    return sendServiceResult(res, result, 200);
  } catch (error) {
    return next(error);
  }
});

// B/E C04: additive grant of one organization role. Body: { role_name } only.
router.post("/organizations/:organizationId/memberships/:legacyPublicUserdataId/roles", async (req, res, next) => {
  try {
    const organizationId = typeof req.params.organizationId === "string" ? req.params.organizationId : null;
    const targetLegacyPublicUserdataId = parseLegacyUserId(req.params.legacyPublicUserdataId);
    const body = req.body;
    const bodyKeysValid = body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).every((key) => key === "role_name");
    const roleName = bodyKeysValid && typeof body.role_name === "string" ? body.role_name : null;

    if (!organizationId || !targetLegacyPublicUserdataId || !roleName) {
      return sendKaiError(res, "validation_blocker");
    }

    const result = await getAccessAdministrationService().grantOrganizationRole({
      actorContext: req.kaiSprint2ActorContext,
      organizationId,
      targetLegacyPublicUserdataId,
      roleName,
      now: new Date().toISOString(),
    });
    return sendServiceResult(res, result, 200);
  } catch (error) {
    return next(error);
  }
});

// B/E C06: targeted revocation of one organization-role assignment, named
// entirely by the path. Accepts no body fields.
router.post("/organizations/:organizationId/memberships/:legacyPublicUserdataId/roles/:roleName/revoke", async (req, res, next) => {
  try {
    const organizationId = typeof req.params.organizationId === "string" ? req.params.organizationId : null;
    const targetLegacyPublicUserdataId = parseLegacyUserId(req.params.legacyPublicUserdataId);
    const roleName = typeof req.params.roleName === "string" && ROLE_NAME_PATTERN.test(req.params.roleName) ? req.params.roleName : null;

    if (!organizationId || !targetLegacyPublicUserdataId || !roleName || !hasNoBodyFields(req)) {
      return sendKaiError(res, "validation_blocker");
    }

    const result = await getAccessAdministrationService().revokeOrganizationRole({
      actorContext: req.kaiSprint2ActorContext,
      organizationId,
      targetLegacyPublicUserdataId,
      roleName,
      now: new Date().toISOString(),
    });
    return sendServiceResult(res, result, 200);
  } catch (error) {
    return next(error);
  }
});

// Repair 1: delegated GK staff onboarding. A person is identified by the
// exact email of their verified Get Kinder account (body { email, role_name })
// or, already on the roster, by their account id in the path (body
// { role_name }). No other body field is accepted.
function hasOnlyBodyKeys(req, allowedKeys) {
  const body = req.body;
  return Boolean(body) && typeof body === "object" && !Array.isArray(body) && Object.keys(body).every((key) => allowedKeys.includes(key));
}

router.post("/organizations/:organizationId/gk-staff", async (req, res, next) => {
  try {
    const organizationId = typeof req.params.organizationId === "string" ? req.params.organizationId : null;
    const valid = hasOnlyBodyKeys(req, ["email", "role_name"]);
    const email = valid && typeof req.body.email === "string" ? req.body.email : null;
    const roleName = valid && typeof req.body.role_name === "string" ? req.body.role_name : null;
    if (!organizationId || !email || !roleName) return sendKaiError(res, "validation_blocker");

    const result = await getAccessAdministrationService().onboardGkStaffMember({
      actorContext: req.kaiSprint2ActorContext,
      organizationId,
      targetEmail: email,
      roleName,
      now: new Date().toISOString(),
    });
    return sendServiceResult(res, result, 200);
  } catch (error) {
    return next(error);
  }
});

router.post("/organizations/:organizationId/gk-staff/:legacyPublicUserdataId", async (req, res, next) => {
  try {
    const organizationId = typeof req.params.organizationId === "string" ? req.params.organizationId : null;
    const targetLegacyPublicUserdataId = parseLegacyUserId(req.params.legacyPublicUserdataId);
    const valid = hasOnlyBodyKeys(req, ["role_name"]);
    const roleName = valid && typeof req.body.role_name === "string" ? req.body.role_name : null;
    if (!organizationId || !targetLegacyPublicUserdataId || !roleName) return sendKaiError(res, "validation_blocker");

    const result = await getAccessAdministrationService().onboardGkStaffMember({
      actorContext: req.kaiSprint2ActorContext,
      organizationId,
      targetLegacyPublicUserdataId,
      roleName,
      now: new Date().toISOString(),
    });
    return sendServiceResult(res, result, 200);
  } catch (error) {
    return next(error);
  }
});

// Repair 1: delegated GK staff offboarding of one staff role, named entirely
// by the path. Accepts no body fields.
router.post("/organizations/:organizationId/gk-staff/:legacyPublicUserdataId/roles/:roleName/revoke", async (req, res, next) => {
  try {
    const organizationId = typeof req.params.organizationId === "string" ? req.params.organizationId : null;
    const targetLegacyPublicUserdataId = parseLegacyUserId(req.params.legacyPublicUserdataId);
    const roleName = typeof req.params.roleName === "string" && ROLE_NAME_PATTERN.test(req.params.roleName) ? req.params.roleName : null;
    if (!organizationId || !targetLegacyPublicUserdataId || !roleName || !hasNoBodyFields(req)) {
      return sendKaiError(res, "validation_blocker");
    }

    const result = await getAccessAdministrationService().offboardGkStaffRole({
      actorContext: req.kaiSprint2ActorContext,
      organizationId,
      targetLegacyPublicUserdataId,
      roleName,
      now: new Date().toISOString(),
    });
    return sendServiceResult(res, result, 200);
  } catch (error) {
    return next(error);
  }
});

router.put("/global-roles/:legacyPublicUserdataId", async (req, res, next) => {
  try {
    const targetLegacyPublicUserdataId = parseLegacyUserId(req.params.legacyPublicUserdataId);
    const roleName = typeof req.body?.role_name === "string" ? req.body.role_name : null;
    const action = typeof req.body?.action === "string" ? req.body.action : null;

    if (!targetLegacyPublicUserdataId || !roleName || !action) {
      return sendKaiError(res, "validation_blocker");
    }

    const result = await getAccessAdministrationService().manageGlobalKaiRole({
      actorContext: req.kaiSprint2ActorContext,
      targetLegacyPublicUserdataId,
      roleName,
      action,
      now: new Date().toISOString(),
    });
    return sendServiceResult(res, result, 200);
  } catch (error) {
    return next(error);
  }
});

/**
 * JOIN-3 join-request review routes. Reviewer authority (platform superuser,
 * or effective client_admin of this exact organization) is enforced in
 * kaiOrganizationJoinRequestReviewService.js. Identifiers must be canonical
 * lowercase UUIDs; the decision routes accept no body fields at all - the
 * requester, reviewer, role, and membership status are never
 * browser-supplied. The service fails closed when the request does not
 * belong to the route's organization.
 */
function canonicalUuidParam(raw) {
  return typeof raw === "string" && KAI_SPRINT2_P0_PATTERNS.uuid.test(raw) && raw === raw.toLowerCase() ? raw : null;
}

function hasNoBodyFields(req) {
  const body = req.body;
  if (body === undefined || body === null) return true;
  return typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0;
}

router.get("/organizations/:organizationId/join-requests", async (req, res, next) => {
  try {
    const organizationId = canonicalUuidParam(req.params.organizationId);
    if (!organizationId) return sendKaiError(res, "validation_blocker");

    const result = await getAccessAdministrationService().listPendingOrganizationJoinRequestsForReviewer({
      actorContext: req.kaiSprint2ActorContext,
      organizationId,
    });
    return sendServiceResult(res, result, 200);
  } catch (error) {
    return next(error);
  }
});

for (const [decisionPath, serviceMethod] of [
  ["approve", "approveOrganizationJoinRequest"],
  ["decline", "declineOrganizationJoinRequest"],
]) {
  router.post(`/organizations/:organizationId/join-requests/:organizationJoinRequestId/${decisionPath}`, async (req, res, next) => {
    try {
      const organizationId = canonicalUuidParam(req.params.organizationId);
      const organizationJoinRequestId = canonicalUuidParam(req.params.organizationJoinRequestId);
      if (!organizationId || !organizationJoinRequestId || !hasNoBodyFields(req)) {
        return sendKaiError(res, "validation_blocker");
      }

      const result = await getAccessAdministrationService()[serviceMethod]({
        actorContext: req.kaiSprint2ActorContext,
        organizationId,
        organizationJoinRequestId,
        now: new Date().toISOString(),
      });
      return sendServiceResult(res, result, 200);
    } catch (error) {
      return next(error);
    }
  });
}

export default router;

export const __testables = {
  setAccessAdministrationServiceForTest(service) {
    accessAdministrationServiceOverride = service;
    return () => {
      accessAdministrationServiceOverride = null;
    };
  },
};
