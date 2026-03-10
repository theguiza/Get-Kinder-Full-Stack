import { isAdminRequest } from "../Backend/middleware/ensureAdmin.js";
import { resolveOrgScope } from "../services/orgScopeService.js";

export async function ensureOrgRep(req, res, next) {
  try {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const scope = await resolveOrgScope(req, {
      allowAdminPreview: false,
      includeOrgMembersForOrgRep: false,
    });
    if (!scope?.hasOrgRepAccess || !scope?.orgId) {
      return res.status(403).json({
        error: "forbidden",
        message: "Organization representative access required.",
      });
    }
    const activeMembership = Array.isArray(scope?.memberships)
      ? scope.memberships.find((entry) => Number(entry?.orgId) === Number(scope.orgId))
      : null;
    if (String(activeMembership?.org_status || "").trim().toLowerCase() === "suspended") {
      return res.status(403).json({
        error: "org_suspended",
        message: "Organization access is suspended. Please contact kai@getkinder.ai.",
      });
    }
    return next();
  } catch (error) {
    console.error("[ensureOrgRep] scope resolution error:", error);
    return res.status(500).json({ error: "server_error" });
  }
}

export async function ensureOrgRepPage(req, res, next) {
  try {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.redirect("/login");
    }
    if (isAdminRequest(req)) return next();

    const scope = await resolveOrgScope(req, {
      allowAdminPreview: false,
      includeOrgMembersForOrgRep: false,
    });
    if (!scope?.hasOrgRepAccess || !scope?.orgId) {
      return res.redirect("/org-apply");
    }
    return next();
  } catch (error) {
    console.error("[ensureOrgRepPage] scope resolution error:", error);
    return res.redirect("/org-apply");
  }
}
