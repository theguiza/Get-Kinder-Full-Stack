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
  manageGlobalKaiRole,
} from "../services/kaiAccessAdministrationService.js";

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
      manageGlobalKaiRole,
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

    if (!organizationId || !targetLegacyPublicUserdataId || !roleName || !membershipStatus) {
      return sendKaiError(res, "validation_blocker");
    }

    const result = await getAccessAdministrationService().manageOrganizationMembership({
      actorContext: req.kaiSprint2ActorContext,
      organizationId,
      targetLegacyPublicUserdataId,
      roleName,
      membershipStatus,
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

export default router;

export const __testables = {
  setAccessAdministrationServiceForTest(service) {
    accessAdministrationServiceOverride = service;
    return () => {
      accessAdministrationServiceOverride = null;
    };
  },
};
