import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { validateExternalRequirementSetRegistrationPayload } from "../validators/kaiExternalRequirementSetRegistrationValidators.js";
import { withTransaction } from "../db/kaiDb.js";
import { insertRequiredSuccessfulAuditEvent } from "../db/kaiAuditQueries.js";
import { createPostgresExternalRequirementSetRegistrationRepository } from "../dictionary/postgresExternalRequirementSetRegistrationRepository.js";

const REGISTER_OPERATION = "register_external_requirement_set";
const REGISTER_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

function isRegisterInput(value) {
  const allowedKeys = new Set(["organizationId", "payload", "actorContext"]);
  return (
    isPlainObject(value) &&
    Object.keys(value).every((key) => allowedKeys.has(key)) &&
    isNonEmptyString(value.organizationId) &&
    isPlainObject(value.payload) &&
    isPlainObject(value.actorContext)
  );
}

function resultError(result) {
  return buildKaiError(result.error?.code || "system_error", { status: result.error?.status });
}

function registrationDto(repositoryData, organizationId) {
  return {
    organization_id: organizationId,
    replayed: Boolean(repositoryData.replayed),
    registration_state: "registered",
    applicability_created: false,
    assessment_created: false,
    requirement_source: {
      requirement_source_id: repositoryData.requirement_source.requirement_source_id,
      source_type: repositoryData.requirement_source.source_type,
      source_code: repositoryData.requirement_source.source_code,
      source_name: repositoryData.requirement_source.source_name,
      organization_id: repositoryData.requirement_source.organization_id,
    },
    requirement_framework_version: {
      requirement_framework_version_id: repositoryData.requirement_framework_version.requirement_framework_version_id,
      requirement_source_id: repositoryData.requirement_framework_version.requirement_source_id,
      framework_code: repositoryData.requirement_framework_version.framework_code,
      framework_name: repositoryData.requirement_framework_version.framework_name,
      version_label: repositoryData.requirement_framework_version.version_label,
      framework_status: repositoryData.requirement_framework_version.framework_status,
    },
    requirement_set: {
      requirement_set_id: repositoryData.requirement_set.requirement_set_id,
      requirement_framework_version_id: repositoryData.requirement_set.requirement_framework_version_id,
      set_key: repositoryData.requirement_set.set_key,
      set_name: repositoryData.requirement_set.set_name,
    },
    requirements: repositoryData.requirements.map((requirement) => ({
      requirement_id: requirement.requirement_id,
      requirement_set_id: requirement.requirement_set_id,
      requirement_key: requirement.requirement_key,
      requirement_label: requirement.requirement_label,
      requirement_description: requirement.requirement_description,
      display_order: requirement.display_order,
    })),
  };
}

export async function registerExternalRequirementSet(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isRegisterInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    REGISTER_OPERATION,
    input.organizationId,
    { allowedRoles: REGISTER_ALLOWED_ROLES, globalRolesOnly: true },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  const validation = validateExternalRequirementSetRegistrationPayload(input.payload);
  if (!validation.ok) {
    return buildKaiError("validation_blocker", { blockers: validation.blockers });
  }

  const repository = dependencies.registrationRepository || createPostgresExternalRequirementSetRegistrationRepository();
  const runInTransaction = dependencies.runInTransaction || withTransaction;
  const insertAudit = dependencies.insertRequiredSuccessfulAuditEvent || insertRequiredSuccessfulAuditEvent;

  let repositoryResult;
  try {
    repositoryResult = await runInTransaction(async (tx) => {
      const result = await repository.registerExternalRequirementSet(
        {
          source: validation.data.source,
          framework: validation.data.framework,
          requirementSet: validation.data.requirement_set,
          requirements: validation.data.requirements,
          actorUserId: actorContext.actorUserId,
        },
        tx,
      );
      if (!result.ok) {
        const error = new Error(result.error?.code || "system_error");
        error.kaiErrorCode = result.error?.code || "system_error";
        error.kaiErrorStatus = result.error?.status;
        throw error;
      }

      if (!result.data.replayed) {
        const auditResult = await insertAudit(
          {
            operation: REGISTER_OPERATION,
            operation_type: REGISTER_OPERATION,
            reason_code: "external_requirement_set_registered",
            object_type: "other",
            target_object_type: "other",
            object_id: result.data.requirement_set.requirement_set_id,
            organization_id: input.organizationId,
            actor_type: actorContext.actorType,
            actor_user_id: actorContext.actorUserId,
            created_by_service: "kaiExternalRequirementSetRegistrationService",
            metadata_only: true,
          },
          tx,
        );
        if (!auditResult?.ok) {
          const error = new Error("required audit rejected");
          error.kaiErrorCode = "audit_payload_rejected";
          throw error;
        }
      }

      return result;
    });
  } catch (error) {
    if (error?.kaiErrorCode) {
      return buildKaiError(error.kaiErrorCode, { status: error.kaiErrorStatus });
    }
    throw error;
  }

  if (!repositoryResult.ok) return resultError(repositoryResult);

  return {
    ok: true,
    data: registrationDto(repositoryResult.data, input.organizationId),
    error: null,
  };
}

export const __externalRequirementSetRegistrationServiceContract = Object.freeze({
  REGISTER_OPERATION,
  REGISTER_ALLOWED_ROLES,
});

export const __externalRequirementSetRegistrationServiceTestables = Object.freeze({
  isRegisterInput,
  isMappedHumanActor,
});
