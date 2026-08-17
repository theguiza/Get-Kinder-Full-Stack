import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { resolveKaiActorContext } from "../auth/kaiActorContext.js";
import { GK_ORGANIZATION_ADMIN_ROLE } from "../auth/gkOrganizationBindingAuthority.js";
import { resolveOrgScopeForUserId } from "../../../services/orgScopeService.js";
import { listActiveGkOrganizationBindingsForGkOrganizationIds } from "../db/kaiOrganizationBindingQueries.js";
import {
  DEFAULT_INITIAL_ENGAGEMENT_CODE,
  acquireOrganizationEnablementLock,
  insertGkOrganizationBinding,
  insertInitialEngagement,
  insertKaiOrganization,
  selectGkOrganizationRow,
  selectInitialEngagementForOrganization,
  selectKaiOrganizationRow,
} from "../db/kaiOrganizationEnablementQueries.js";
import { createProductionMetadataOnlyAuditForOrganizationKaiEnablement } from "./kaiMetadataOnlyAuditComposition.js";
import { withTransaction } from "../db/kaiDb.js";

/**
 * Get Kinder organization -> KAI provisioning. Authorizes against the
 * CURRENT Get Kinder organization-admin authorization mechanism
 * (public.user_org_memberships.role === 'admin' for the requested
 * organization, resolved via services/orgScopeService.js#resolveOrgScopeForUserId) -
 * exactly the same role gkOrganizationBindingAuthority.js already treats as
 * authoritative for deriving client_admin, but checked directly here because
 * that derivation itself depends on a binding existing, which is not yet true
 * on a first enablement request.
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeGkOrganizationId(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function actorError(actorResult) {
  if (actorResult.error_code === "mapped_kai_user_required") return buildKaiError("mapped_kai_user_required");
  return buildKaiError(actorResult.error_code || "unauthorized");
}

async function resolveAuthorizedGkOrganizationAdminActor(input, dependencies) {
  if (!isPlainObject(input) || !isPlainObject(input.req)) {
    return { ok: false, error: buildKaiError("validation_blocker") };
  }
  const gkOrganizationId = normalizeGkOrganizationId(input.gkOrganizationId);
  if (!gkOrganizationId) {
    return { ok: false, error: buildKaiError("validation_blocker") };
  }

  const resolveActor = dependencies.resolveKaiActorContext || resolveKaiActorContext;
  const actorResult = await resolveActor(input.req, dependencies);
  if (!actorResult.ok) return { ok: false, error: actorError(actorResult) };
  const { actorContext } = actorResult;

  const resolveScope = dependencies.resolveOrgScopeForUserId || resolveOrgScopeForUserId;
  const scope = await resolveScope(actorContext.legacyPublicUserdataId);
  const isGkOrganizationAdmin = (Array.isArray(scope?.memberships) ? scope.memberships : []).some(
    (membership) =>
      Number(membership?.orgId) === gkOrganizationId &&
      membership?.role === GK_ORGANIZATION_ADMIN_ROLE &&
      membership?.is_active !== false,
  );
  if (!isGkOrganizationAdmin) {
    return { ok: false, error: buildKaiError("authorization_denied") };
  }

  return { ok: true, actorContext, gkOrganizationId };
}

/**
 * Maps an in-transaction failure to the API error code the caller should
 * see. Every branch of the write path below throws rather than returning, so
 * a single catch here always corresponds to a rolled-back transaction with
 * zero partial writes.
 */
function mapEnablementFailureErrorCode(errorCode) {
  if (errorCode === "invalid_organization_name" || errorCode === "invalid_gk_organization_id") {
    return "validation_blocker";
  }
  if (
    errorCode === "kai_organization_binding_inconsistent" ||
    errorCode === "conflicting_binding" ||
    errorCode === "conflicting_engagement"
  ) {
    return "conflict";
  }
  return "system_error";
}

function throwEnablementFailure(errorCode) {
  const error = new Error(errorCode || "system_error");
  error.enablementErrorCode = errorCode || "system_error";
  throw error;
}

/**
 * Read-only KAI-enablement status for a Get Kinder organization. Executes
 * only SELECTs - never creates or mutates a binding, organization, or
 * engagement row. Used by the organization-admin UI to decide between
 * "Not enabled" / "Enable KAI" and "Enabled" / "Open KAI".
 */
export async function getKaiEnablementStatusForOrganization(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }

  const authorized = await resolveAuthorizedGkOrganizationAdminActor(input, dependencies);
  if (!authorized.ok) return authorized.error;
  const { gkOrganizationId } = authorized;

  const listBindings =
    dependencies.listActiveGkOrganizationBindingsForGkOrganizationIds ||
    listActiveGkOrganizationBindingsForGkOrganizationIds;
  const bindings = await listBindings([gkOrganizationId]);
  const binding = bindings[0] || null;
  if (!binding) {
    return { ok: true, data: { kai_enabled: false, kai_organization_id: null }, error: null };
  }

  const selectKaiOrganization = dependencies.selectKaiOrganizationRow || selectKaiOrganizationRow;
  const kaiOrganizationRow = await selectKaiOrganization(binding.kai_organization_id);
  if (!kaiOrganizationRow) {
    // Active binding with no corresponding kai.organizations row: an
    // inconsistent state this read must fail closed on, not repair.
    return buildKaiError("conflict");
  }

  const selectEngagement = dependencies.selectInitialEngagementForOrganization || selectInitialEngagementForOrganization;
  const engagement = await selectEngagement({
    organizationId: binding.kai_organization_id,
    engagementCode: DEFAULT_INITIAL_ENGAGEMENT_CODE,
  });
  if (!engagement) {
    return { ok: true, data: { kai_enabled: false, kai_organization_id: binding.kai_organization_id }, error: null };
  }

  return {
    ok: true,
    data: {
      kai_enabled: true,
      kai_organization_id: binding.kai_organization_id,
      engagement_id: engagement.engagement_id,
      engagement_code: engagement.engagement_code,
    },
    error: null,
  };
}

/**
 * Get Kinder organization -> KAI provisioning write path. Executes the
 * complete first-enablement (or replay) sequence inside ONE transaction:
 *
 *   BEGIN
 *   -> advisory lock on gkOrganizationId
 *   -> re-read the active GK<->KAI binding inside this transaction
 *   -> if an active binding exists: reuse its kai_organization_id, and
 *      confirm a corresponding kai.organizations row actually exists
 *      (fail closed with zero writes if it does not - never repairs it)
 *   -> if no active binding exists: INSERT exactly one kai.organizations
 *      row (name sourced only from the authoritative public.organizations
 *      row; every other column left to its PostgreSQL default), then
 *      create the active binding against that returned organization_id
 *   -> reuse or INSERT the one initial kai.engagements row
 *   -> publish the required metadata-only audit through this same
 *      transaction context
 *   COMMIT
 *
 * Any failure in any of the above (organization insert, binding creation,
 * engagement creation, or required audit) throws, which rolls back the
 * entire transaction - there is no path that leaves a partially provisioned
 * (orphaned organization, binding without engagement, engagement without
 * audit) state.
 */
export async function enableKaiForOrganization(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }

  const authorized = await resolveAuthorizedGkOrganizationAdminActor(input, dependencies);
  if (!authorized.ok) return authorized.error;
  const { actorContext, gkOrganizationId } = authorized;

  const selectGkOrganization = dependencies.selectGkOrganizationRow || selectGkOrganizationRow;
  const gkOrganization = await selectGkOrganization(gkOrganizationId);
  if (!gkOrganization) {
    return buildKaiError("not_found");
  }

  const runInTransaction = dependencies.withTransaction || withTransaction;
  const acquireLock = dependencies.acquireOrganizationEnablementLock || acquireOrganizationEnablementLock;
  const listBindings =
    dependencies.listActiveGkOrganizationBindingsForGkOrganizationIds ||
    listActiveGkOrganizationBindingsForGkOrganizationIds;
  const selectKaiOrganization = dependencies.selectKaiOrganizationRow || selectKaiOrganizationRow;
  const insertOrganization = dependencies.insertKaiOrganization || insertKaiOrganization;
  const insertBinding = dependencies.insertGkOrganizationBinding || insertGkOrganizationBinding;
  const selectEngagement = dependencies.selectInitialEngagementForOrganization || selectInitialEngagementForOrganization;
  const insertEngagement = dependencies.insertInitialEngagement || insertInitialEngagement;
  const buildAudit =
    dependencies.createProductionMetadataOnlyAuditForOrganizationKaiEnablement ||
    createProductionMetadataOnlyAuditForOrganizationKaiEnablement;

  let transactionResult;
  try {
    transactionResult = await runInTransaction(async (client) => {
      await acquireLock(gkOrganizationId, client);

      const existingBindings = await listBindings([gkOrganizationId], client);
      const existingBinding = existingBindings[0] || null;

      let kaiOrganizationId;
      let bindingCreated = false;

      if (existingBinding) {
        const kaiOrganizationRow = await selectKaiOrganization(existingBinding.kai_organization_id, client);
        if (!kaiOrganizationRow) {
          throwEnablementFailure("kai_organization_binding_inconsistent");
        }
        kaiOrganizationId = existingBinding.kai_organization_id;
      } else {
        const organizationResult = await insertOrganization(
          { name: gkOrganization.name, legacyPublicOrganizationId: gkOrganizationId },
          client,
        );
        if (!organizationResult.ok) {
          throwEnablementFailure(organizationResult.error_code);
        }
        kaiOrganizationId = organizationResult.organizationId;

        const bindingResult = await insertBinding({ gkOrganizationId, kaiOrganizationId }, client);
        if (!bindingResult.ok) {
          throwEnablementFailure(bindingResult.error_code);
        }
        bindingCreated = true;
      }

      let engagement = await selectEngagement(
        { organizationId: kaiOrganizationId, engagementCode: DEFAULT_INITIAL_ENGAGEMENT_CODE },
        client,
      );
      let engagementCreated = false;
      if (!engagement) {
        const engagementResult = await insertEngagement(
          {
            organizationId: kaiOrganizationId,
            engagementCode: DEFAULT_INITIAL_ENGAGEMENT_CODE,
            createdByUserId: actorContext.actorUserId,
          },
          client,
        );
        if (!engagementResult.ok) {
          throwEnablementFailure(engagementResult.error_code);
        }
        engagement = engagementResult.engagement;
        engagementCreated = true;
      }

      if (bindingCreated || engagementCreated) {
        const audit = buildAudit({ kaiOrganizationId, actorContext, now: new Date().toISOString() });
        const prepared = audit.prepareMetadataOnlyAudit({
          payload: {
            attempted_operation: "enable_kai_for_organization",
            engagement_id: engagement.engagement_id,
          },
          db: client,
        });
        if (!prepared.ok) {
          throwEnablementFailure("audit_preparation_failed");
        }
        await prepared.publish();
      }

      return { kaiOrganizationId, engagement };
    });
  } catch (error) {
    return buildKaiError(mapEnablementFailureErrorCode(error?.enablementErrorCode));
  }

  return {
    ok: true,
    data: {
      kai_enabled: true,
      kai_organization_id: transactionResult.kaiOrganizationId,
      engagement_id: transactionResult.engagement.engagement_id,
      engagement_code: transactionResult.engagement.engagement_code,
    },
    error: null,
  };
}

export const __organizationEnablementServiceTestables = Object.freeze({
  resolveAuthorizedGkOrganizationAdminActor,
  mapEnablementFailureErrorCode,
});
