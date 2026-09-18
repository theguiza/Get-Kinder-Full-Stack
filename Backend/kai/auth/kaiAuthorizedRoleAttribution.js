/**
 * Shared post-authorization attribution helper for KAI human-review ledger
 * writes (decided_by_role / actor_role columns). This is an attribution
 * helper, not an authorization service: it must only be called after
 * validateActorCanPerformOperation has already returned auth.ok === true,
 * and it never grants access on its own.
 *
 * validateActorCanPerformOperation does not report which specific role
 * matched (only ok/memberships/platformSuperuserAuthorized), so the concrete
 * role recorded on the ledger is resolved here, independently, from the same
 * successful auth result:
 *
 *   1. an active org-scoped membership role that is in allowedRoles
 *   2. otherwise a global KAI role (actorContext.kaiRoles) that is in
 *      allowedRoles
 *   3. otherwise, only when authorization succeeded specifically via the
 *      existing Get Kinder platform-superuser authority AND "gk_admin" is
 *      itself one of allowedRoles for this operation: "gk_admin"
 *   4. otherwise: null (fail closed - callers must treat null as
 *      unattributable and not persist it)
 */
export function resolveAuthorizedHumanRole({ actorContext, auth, allowedRoles }) {
  if (!auth?.ok) return null;

  const membershipMatch = (auth.memberships || []).find((membership) =>
    allowedRoles.has(membership.role_name),
  );
  if (membershipMatch) return membershipMatch.role_name;

  const globalMatch = (actorContext?.kaiRoles || []).find((role) => allowedRoles.has(role));
  if (globalMatch) return globalMatch;

  if (
    auth.platformSuperuserAuthorized === true &&
    auth.platformSuperuserAuthority === "get_kinder_site_admin" &&
    allowedRoles.has("gk_admin")
  ) {
    return "gk_admin";
  }

  return null;
}
