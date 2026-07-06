import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";

export function validateActorAuthorization(context = {}) {
  return validateActorCanPerformOperation(
    context.actorContext,
    context.operation,
    context.organizationId,
    context.options,
  );
}
