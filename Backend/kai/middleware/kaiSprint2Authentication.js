import { ensureAuthenticatedApi } from "../../../middleware/auth.js";
import { sendKaiError } from "../errors/kaiErrors.js";

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
