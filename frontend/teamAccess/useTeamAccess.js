import { useCallback, useEffect, useRef, useState } from "react";

import { getJson } from "../impactEvidenceLibraryLogic.js";
import {
  describeRoleChangeError,
  describeTeamAccessReadError,
  projectTeamAccessAdministrableRoles,
  projectTeamAccessRoster,
  roleChangeSuccessMessage,
  roleGrantSuccessMessage,
  roleRevokeSuccessMessage,
  teamAccessErrorFromResult,
  teamAccessRoleChangeRequest,
  teamAccessRoleGrantRequest,
  teamAccessRoleRevokeRequest,
  teamAccessRosterPath,
} from "./teamAccessLogic.js";

const IDLE = Object.freeze({ organizationId: "", status: "idle", members: [], administrableRoles: [], error: "" });

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
      error: "",
    }));
    const result = await getJson(teamAccessRosterPath(targetOrganizationId));
    if (requestRef.current !== token) return;
    if (result.statusCode === 200 && result.body?.ok) {
      setRoster({
        organizationId: targetOrganizationId,
        status: "success",
        members: projectTeamAccessRoster(result.body.data),
        administrableRoles: projectTeamAccessAdministrableRoles(result.body.data),
        error: "",
      });
      return;
    }
    setRoster({
      organizationId: targetOrganizationId,
      status: "error",
      members: [],
      administrableRoles: [],
      error: describeTeamAccessReadError(teamAccessErrorFromResult(result)),
    });
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
  const mutate = useCallback(async (member, buildRequest, method, successText) => {
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
      setNotice({ tone: "success", text: successText });
      await load(targetOrganizationId);
      return { ok: true };
    }
    const failure = teamAccessErrorFromResult(result);
    setNotice({ tone: "error", text: describeRoleChangeError(failure) });
    if (failure.status === 409 || failure.status === 404) await load(targetOrganizationId);
    return { ok: false, failure };
  }, [enabled, savingKey, load]);

  const changeRole = useCallback(async (member, roleName) => {
    if (!member?.canChangeRole) return { ok: false };
    return mutate(member, (orgId) => teamAccessRoleChangeRequest(orgId, member, roleName), "PUT", roleChangeSuccessMessage(member, roleName));
  }, [mutate]);

  const grantRole = useCallback(
    (member, roleName) => mutate(member, (orgId) => teamAccessRoleGrantRequest(orgId, member, roleName), "POST", roleGrantSuccessMessage(member, roleName)),
    [mutate],
  );

  const revokeRole = useCallback(
    (member, roleName) => mutate(member, (orgId) => teamAccessRoleRevokeRequest(orgId, member, roleName), "POST", roleRevokeSuccessMessage(member, roleName)),
    [mutate],
  );

  const rosterForOrganization = roster.organizationId === organizationId ? roster : { ...IDLE, organizationId, status: enabled ? "loading" : "idle" };

  return { roster: rosterForOrganization, savingKey, notice, refresh, changeRole, grantRole, revokeRole };
}
