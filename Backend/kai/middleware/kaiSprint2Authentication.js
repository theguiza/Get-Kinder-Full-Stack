import { ensureAuthenticatedApi } from "../../../middleware/auth.js";
import { sendKaiError } from "../errors/kaiErrors.js";
import { resolveKaiActorContext } from "../auth/kaiActorContext.js";

export function requireKaiSprint2Authenticated(req, res, next) {
  return ensureAuthenticatedApi(req, res, next, {
    onFailure({ status }) {
      return sendKaiError(res, status === 401 ? "unauthorized" : "authorization_denied", {
        data: null,
        blockers: [],
        warnings: [],
      });
    },
  });
}

/**
 * Attaches the full Sprint 2 actor context (roles, organization memberships,
 * etc.) resolved from the authenticated request. Must run after
 * requireKaiSprint2Authenticated so req.user is already present, and before
 * any route handler reads req.kaiSprint2ActorContext.
 */
export function createAttachKaiSprint2ActorContext({
  resolveActorContext = resolveKaiActorContext,
} = {}) {
  return async function attachKaiSprint2ActorContext(req, res, next) {
    // Idempotent: an upstream test harness (or future caller) may already have
    // attached an actor context. Nothing in production sets this property
    // before this middleware runs, so this only ever short-circuits work that
    // was already done, never masks a missing resolution.
    if (req.kaiSprint2ActorContext) return next();
    try {
      const resolved = await resolveActorContext(req);

      if (!resolved.ok) {
        return sendKaiError(res, resolved.error_code);
      }

      req.kaiSprint2ActorContext = resolved.actorContext;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export const attachKaiSprint2ActorContext = createAttachKaiSprint2ActorContext();
