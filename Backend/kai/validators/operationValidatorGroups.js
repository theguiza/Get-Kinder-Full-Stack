import { validateAssistantBoundary } from "./assistantBoundaryValidators.js";
import { validateActorAuthorization } from "./authorizationValidators.js";
import { validateReviewQueueType } from "./intakeValidators.js";
import { validateStoragePathPolicy } from "./storageValidators.js";
import { validateTenantBoundaryConsistency } from "./tenantValidators.js";

function validateTenantBoundaryFromOperationContext(context = {}) {
  return validateTenantBoundaryConsistency({
    expectedOrganizationId: context.expectedOrganizationId || context.organizationId,
    payload: context.payload,
    currentRecords: context.currentRecords,
    engagementRecord: context.engagementRecord,
  });
}

export const operationValidatorGroups = Object.freeze({
  create_intake_batch: [validateAssistantBoundary, validateActorAuthorization, validateTenantBoundaryFromOperationContext],
  create_intake_file: [
    validateAssistantBoundary,
    validateActorAuthorization,
    validateTenantBoundaryFromOperationContext,
    validateStoragePathPolicy,
  ],
  create_review_queue_item: [validateAssistantBoundary, validateActorAuthorization, validateReviewQueueType],
});

export function getValidatorsForOperation(operation) {
  return operationValidatorGroups[operation] || [];
}
