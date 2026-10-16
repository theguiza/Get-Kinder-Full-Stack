import { useCallback, useEffect, useRef, useState } from "react";

import { getJson } from "../impactEvidenceLibraryLogic.js";
import {
  describeGlobalRoleError,
  describeRoleChangeError,
  describeTeamAccessReadError,
  projectTeamAccessAdministrableRoles,
  projectTeamAccessGlobalAdministration,
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
  organizationId: "", status: "idle", members: [], administrableRoles: [], globalRolesVisible: false, assignableGlobalRoles: [], error: "",
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
  // `successText` may read the re-read roster (the post-grant handoff).
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
      setNotice({ tone: "success", text: typeof successText === "function" ? successText(members) : successText });
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

  // An added organization role that still leaves an operation blocked only by
  // a missing global role says so, from the re-read server readiness.
  const grantRole = useCallback(
    (member, roleName) => mutate(member, (orgId) => teamAccessRoleGrantRequest(orgId, member, roleName), "POST", (members) => {
      const refreshed = (members || []).find((candidate) => candidate.key === member.key);
      return teamAccessHandoffNotice(refreshed) || roleGrantSuccessMessage(member, roleName);
    }),
    [mutate],
  );

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

  const revokeRole = useCallback(
    (member, roleName) => mutate(member, (orgId) => teamAccessRoleRevokeRequest(orgId, member, roleName), "POST", roleRevokeSuccessMessage(member, roleName)),
    [mutate],
  );

  const rosterForOrganization = roster.organizationId === organizationId ? roster : { ...IDLE, organizationId, status: enabled ? "loading" : "idle" };

  return { roster: rosterForOrganization, savingKey, notice, refresh, changeRole, grantRole, revokeRole, changeGlobalRole, addPerson };
}
