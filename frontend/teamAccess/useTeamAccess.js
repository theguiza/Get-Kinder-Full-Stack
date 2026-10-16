import { useCallback, useEffect, useRef, useState } from "react";

import { getJson } from "../impactEvidenceLibraryLogic.js";
import {
  describeGlobalRoleError,
  describeRoleChangeError,
  describeTeamAccessReadError,
  describeStaffOnboardingError,
  projectTeamAccessAdministrableRoles,
  projectTeamAccessGlobalAdministration,
  projectTeamAccessStaffOnboardingRoles,
  staffOffboardingResultMessage,
  staffOnboardingResultMessage,
  teamAccessStaffOffboardingRequest,
  teamAccessStaffOnboardingByEmailRequest,
  teamAccessStaffOnboardingRequest,
  memberDisplayName,
  teamAccessAddPersonGrantRequest,
  teamAccessAddPersonLookupPath,
  teamAccessGlobalRoleRequest,
  teamAccessHandoffNotice,
  projectTeamAccessRoster,
  roleChangeSuccessMessage,
  roleGrantSuccessMessage,
  roleRevokeSuccessMessage,
  teamAccessErrorFromResult,
  teamAccessRoleChangeRequest,
  teamAccessRoleGrantRequest,
  teamAccessRoleRevokeRequest,
  teamAccessRosterPath,
  teamAccessRoleLabel as teamAccessRoleLabelText,
} from "./teamAccessLogic.js";

const IDLE = Object.freeze({
  organizationId: "", status: "idle", members: [], administrableRoles: [], globalRolesVisible: false, assignableGlobalRoles: [],
  staffOnboardingRoles: [], error: "",
});

// The access-administration role change is a PUT, and the role grant and
// revocation are POSTs; same { statusCode, body } shape as getJson.
async function sendJson(method, path, body) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let responseBody = null;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = null;
  }
  return { statusCode: response.status, body: responseBody };
}

// Staff onboarding (organization role plus, when it affects no other
// organization, the global role the work needs): the server's answer says
// whether it is complete or waits for platform approval of the global role.
function staffOnboardingNotice(data, displayName) {
  return { tone: data?.onboarding_status === "complete" ? "success" : "warning", text: staffOnboardingResultMessage(data, displayName) };
}

const staffOnboardingOutcome = (member) => (_members, data) => staffOnboardingNotice(data, memberDisplayName(member));

/**
 * Team & Access roster for one organization, read only while `enabled` (the
 * server's organizationAccessManagement answer for that organization). Every
 * response is keyed to the organization it was requested for, and a response
 * for an organization the user has since left is discarded, so switching
 * organizations can never show or change the previous organization's team.
 */
export function useTeamAccess(organizationId, enabled) {
  const [roster, setRoster] = useState(IDLE);
  const [savingKey, setSavingKey] = useState("");
  const [notice, setNotice] = useState(null);
  const requestRef = useRef(0);
  const currentOrganizationRef = useRef("");

  const load = useCallback(async (targetOrganizationId) => {
    const token = ++requestRef.current;
    setRoster((current) => ({
      organizationId: targetOrganizationId,
      status: current.organizationId === targetOrganizationId && current.status === "success" ? "success" : "loading",
      members: current.organizationId === targetOrganizationId ? current.members : [],
      administrableRoles: current.organizationId === targetOrganizationId ? current.administrableRoles : [],
      globalRolesVisible: current.organizationId === targetOrganizationId ? current.globalRolesVisible : false,
      assignableGlobalRoles: current.organizationId === targetOrganizationId ? current.assignableGlobalRoles : [],
      staffOnboardingRoles: current.organizationId === targetOrganizationId ? current.staffOnboardingRoles : [],
      error: "",
    }));
    const result = await getJson(teamAccessRosterPath(targetOrganizationId));
    if (requestRef.current !== token) return;
    if (result.statusCode === 200 && result.body?.ok) {
      const members = projectTeamAccessRoster(result.body.data);
      setRoster({
        organizationId: targetOrganizationId,
        status: "success",
        members,
        administrableRoles: projectTeamAccessAdministrableRoles(result.body.data),
        ...projectTeamAccessGlobalAdministration(result.body.data),
        staffOnboardingRoles: projectTeamAccessStaffOnboardingRoles(result.body.data),
        error: "",
      });
      return members;
    }
    setRoster({
      organizationId: targetOrganizationId,
      status: "error",
      members: [],
      administrableRoles: [],
      globalRolesVisible: false,
      assignableGlobalRoles: [],
      staffOnboardingRoles: [],
      error: describeTeamAccessReadError(teamAccessErrorFromResult(result)),
    });
    return null;
  }, []);

  useEffect(() => {
    currentOrganizationRef.current = organizationId || "";
    setSavingKey("");
    setNotice(null);
    if (!organizationId || !enabled) {
      requestRef.current += 1;
      setRoster(IDLE);
      return;
    }
    load(organizationId);
  }, [organizationId, enabled, load]);

  const refresh = useCallback(() => {
    if (currentOrganizationRef.current && enabled) load(currentOrganizationRef.current);
  }, [enabled, load]);

  // One role change (PUT replacement), grant, or revocation (POSTs) for one
  // member; the server answers, and the roster is always re-read from it.
  // `successText` may read the re-read roster (the post-grant handoff) and
  // the response data, and may return { tone, text } for a pending outcome.
  const mutate = useCallback(async (member, buildRequest, method, successText, describeError = describeRoleChangeError) => {
    const targetOrganizationId = currentOrganizationRef.current;
    if (!targetOrganizationId || !enabled || savingKey || !member) return { ok: false };
    let request;
    try {
      request = buildRequest(targetOrganizationId);
    } catch {
      setNotice({ tone: "error", text: "That role is not available." });
      return { ok: false };
    }
    setSavingKey(member.key);
    setNotice(null);
    const result = await sendJson(method, request.path, request.body);
    if (currentOrganizationRef.current !== targetOrganizationId) return { ok: false, stale: true };
    setSavingKey("");
    if (result.statusCode === 200 && result.body?.ok) {
      const members = await load(targetOrganizationId);
      if (currentOrganizationRef.current !== targetOrganizationId) return { ok: true, stale: true };
      const outcome = typeof successText === "function" ? successText(members, result.body.data) : successText;
      setNotice(typeof outcome === "string" ? { tone: "success", text: outcome } : outcome);
      return { ok: true };
    }
    const failure = teamAccessErrorFromResult(result);
    setNotice({ tone: "error", text: describeError(failure) });
    if (failure.status === 409 || failure.status === 404) await load(targetOrganizationId);
    return { ok: false, failure };
  }, [enabled, savingKey, load]);

  const changeRole = useCallback(async (member, roleName) => {
    if (!member?.canChangeRole) return { ok: false };
    return mutate(member, (orgId) => teamAccessRoleChangeRequest(orgId, member, roleName), "PUT", roleChangeSuccessMessage(member, roleName));
  }, [mutate]);

  // A delegated GK administrator's operator/reviewer grant is staff
  // onboarding (see staffOnboardingNotice). Any other added organization
  // role that still leaves an operation blocked only by a missing global
  // role says so, from the re-read server readiness.
  const grantRole = useCallback(
    (member, roleName) => (roster.staffOnboardingRoles.includes(roleName)
      ? mutate(member, (orgId) => teamAccessStaffOnboardingRequest(orgId, member, roleName, roster.staffOnboardingRoles), "POST",
        staffOnboardingOutcome(member), describeStaffOnboardingError)
      : mutate(member, (orgId) => teamAccessRoleGrantRequest(orgId, member, roleName), "POST", (members) => {
        const refreshed = (members || []).find((candidate) => candidate.key === member.key);
        return teamAccessHandoffNotice(refreshed) || roleGrantSuccessMessage(member, roleName);
      })),
    [mutate, roster.staffOnboardingRoles],
  );

  // Finish a staff assignment whose onboarding is pending (its global role
  // is not in place yet); the server re-decides everything.
  const completeStaffOnboarding = useCallback(
    (member, roleName) => mutate(member, (orgId) => teamAccessStaffOnboardingRequest(orgId, member, roleName, roster.staffOnboardingRoles), "POST",
      staffOnboardingOutcome(member), describeStaffOnboardingError),
    [mutate, roster.staffOnboardingRoles],
  );

  // A delegated GK administrator adds a person by the exact email of their
  // verified Get Kinder account; nothing is created for an unknown email.
  const addStaff = useCallback(async (email, roleName) => {
    const targetOrganizationId = currentOrganizationRef.current;
    if (!targetOrganizationId || !enabled || savingKey) return { ok: false };
    let request;
    try {
      request = teamAccessStaffOnboardingByEmailRequest(targetOrganizationId, email, roleName, roster.staffOnboardingRoles);
    } catch {
      setNotice({ tone: "error", text: "Enter the exact email of the person's verified Get Kinder account." });
      return { ok: false };
    }
    setSavingKey("add-staff");
    setNotice(null);
    const result = await sendJson("POST", request.path, request.body);
    if (currentOrganizationRef.current !== targetOrganizationId) return { ok: false, stale: true };
    setSavingKey("");
    if (result.statusCode === 200 && result.body?.ok) {
      await load(targetOrganizationId);
      if (currentOrganizationRef.current !== targetOrganizationId) return { ok: true, stale: true };
      setNotice(staffOnboardingNotice(result.body.data, request.body.email));
      return { ok: true };
    }
    setNotice({ tone: "error", text: describeStaffOnboardingError(teamAccessErrorFromResult(result)) });
    return { ok: false };
  }, [enabled, savingKey, load, roster.staffOnboardingRoles]);

  // Platform superuser only (the server decides): grant or revoke one global
  // Get Kinder role through the existing global-role service.
  const changeGlobalRole = useCallback(
    (member, roleName, action) => mutate(
      member,
      () => teamAccessGlobalRoleRequest(member, roleName, action, roster.assignableGlobalRoles),
      "PUT",
      `${action === "assign" ? "Granted" : "Revoked"} global ${teamAccessRoleLabelText(roleName)} ${action === "assign" ? "to" : "from"} ${member.email || "this person"}.`,
      describeGlobalRoleError,
    ),
    [mutate, roster.assignableGlobalRoles],
  );

  // Platform superuser only: add an existing Get Kinder account to this
  // organization by exact email (existing lookup, then the additive grant).
  const addPerson = useCallback(async (email, roleName) => {
    const targetOrganizationId = currentOrganizationRef.current;
    if (!targetOrganizationId || !enabled || savingKey) return { ok: false };
    let lookupPath;
    try {
      lookupPath = teamAccessAddPersonLookupPath(email);
    } catch {
      setNotice({ tone: "error", text: "Enter the person's exact email address." });
      return { ok: false };
    }
    setSavingKey("add-person");
    setNotice(null);
    const lookup = await getJson(lookupPath);
    if (currentOrganizationRef.current !== targetOrganizationId) return { ok: false, stale: true };
    const legacyUserId = lookup.statusCode === 200 ? lookup.body?.user?.id : null;
    if (!legacyUserId) {
      setSavingKey("");
      setNotice({ tone: "error", text: lookup.statusCode === 404 ? "No existing Get Kinder account has that email." : "The account could not be looked up." });
      return { ok: false };
    }
    let request;
    try {
      request = teamAccessAddPersonGrantRequest(targetOrganizationId, legacyUserId, roleName);
    } catch {
      setSavingKey("");
      setNotice({ tone: "error", text: "That role is not available." });
      return { ok: false };
    }
    const result = await sendJson("POST", request.path, request.body);
    if (currentOrganizationRef.current !== targetOrganizationId) return { ok: false, stale: true };
    setSavingKey("");
    if (result.statusCode === 200 && result.body?.ok) {
      await load(targetOrganizationId);
      setNotice({ tone: "success", text: `${String(email).trim().toLowerCase()} now has the ${teamAccessRoleLabelText(roleName)} role here.` });
      return { ok: true };
    }
    setNotice({ tone: "error", text: describeRoleChangeError(teamAccessErrorFromResult(result)) });
    return { ok: false };
  }, [enabled, savingKey, load]);

  // A delegated GK administrator's operator/reviewer removal is staff
  // offboarding: the server also removes the global role unless another
  // assignment or organization still needs it, and says which.
  const revokeRole = useCallback(
    (member, roleName) => (roster.staffOnboardingRoles.includes(roleName)
      ? mutate(member, (orgId) => teamAccessStaffOffboardingRequest(orgId, member, roleName, roster.staffOnboardingRoles), "POST",
        (_members, data) => staffOffboardingResultMessage(data, memberDisplayName(member)), describeStaffOnboardingError)
      : mutate(member, (orgId) => teamAccessRoleRevokeRequest(orgId, member, roleName), "POST", roleRevokeSuccessMessage(member, roleName))),
    [mutate, roster.staffOnboardingRoles],
  );

  const rosterForOrganization = roster.organizationId === organizationId ? roster : { ...IDLE, organizationId, status: enabled ? "loading" : "idle" };

  return {
    roster: rosterForOrganization, savingKey, notice, refresh, changeRole, grantRole, revokeRole, changeGlobalRole, addPerson, addStaff, completeStaffOnboarding,
  };
}
