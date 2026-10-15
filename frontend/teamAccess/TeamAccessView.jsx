import React, { useState } from "react";

import OrganizationJoinRequestsReviewPanel from "../impactLibrary/OrganizationJoinRequestsReviewPanel.jsx";
import {
  LAST_ADMINISTRATOR_MESSAGE,
  TEAM_ACCESS_ROLE_OPTIONS,
  describeMemberAuthority,
  memberDisplayName,
  roleChangeBlockedAsLastAdministrator,
  roleChangeRemovesAdministrator,
  roleRevokeRemovesAdministrator,
  teamAccessAccountStatusLabel,
  teamAccessAssignmentMember,
  teamAccessRoleLabel,
} from "./teamAccessLogic.js";

const ROLE_DESCRIPTIONS = Object.freeze([
  ["client_admin", "Uploads files, manages Projects and the Improvement Plan, and manages team & access."],
  ["client_reviewer", "Views your organization's KAI workspace and answers client follow-ups."],
  ["client_contributor", "Views your organization's KAI workspace."],
  ["gk_operator", "Get Kinder staff who run source review for this organization (also needs the global Get Kinder operator role)."],
  ["gk_reviewer", "Get Kinder staff who review evidence and claims for this organization."],
]);

const domId = (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "-");

// Explicit replacement (B/E C05) of one stored assignment: `member` is that
// assignment's view (teamAccessAssignmentMember), so storedRole is the exact
// assignment replaced and roleOptions are the roles the server offered for it.
function AssignmentEditor({ member, savingKey, onChangeRole }) {
  const [draftRole, setDraftRole] = useState(member.storedRole || "");
  const [confirming, setConfirming] = useState(false);
  const name = memberDisplayName(member);
  const busy = savingKey === member.key;
  const removesAdmin = roleChangeRemovesAdministrator(member, draftRole);
  const blockedAsSoleAdmin = roleChangeBlockedAsLastAdministrator(member, draftRole);
  const unchanged = draftRole === member.storedRole && member.storedStatus === "active";
  const selectId = `gk-team-access-role-${domId(member.key)}-${domId(member.storedRole || "none")}`;

  const save = () => {
    if (removesAdmin && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onChangeRole?.(member, draftRole);
  };

  return member.canChangeRole ? (
    <div className="gk-team-access-member-edit">
      <label className="gk-team-access-visually-hidden" htmlFor={selectId}>Role for {name}</label>
      <select
        id={selectId}
        className="gk-team-access-select"
        value={draftRole}
        disabled={Boolean(savingKey)}
        onChange={(event) => {
          setDraftRole(event.target.value);
          setConfirming(false);
        }}
      >
        {member.roleOptions.map((role) => (
          <option key={role} value={role}>{teamAccessRoleLabel(role)}</option>
        ))}
      </select>
      <button
        type="button"
        className="gk-organization-join-request-btn"
        disabled={Boolean(savingKey) || unchanged || blockedAsSoleAdmin}
        onClick={save}
      >
        {busy ? "Saving..." : confirming ? "Confirm change" : member.storedStatus === "active" ? "Save role" : "Restore access"}
      </button>
      {confirming ? (
        <button type="button" className="gk-organization-join-close" onClick={() => setConfirming(false)}>
          Cancel
        </button>
      ) : null}
      {blockedAsSoleAdmin ? (
        <p className="gk-team-access-member-warning">{LAST_ADMINISTRATOR_MESSAGE}</p>
      ) : confirming ? (
        <p className="gk-team-access-member-warning" role="alert">
          {name} will no longer be an administrator and will lose access to Team & Access.
        </p>
      ) : null}
    </div>
  ) : null;
}

// Targeted revocation (B/E C06) of one assignment; every other role stays.
// Always confirmed first, naming what the person loses.
function RevokeRoleButton({ member, roleName, savingKey, onRevokeRole }) {
  const [confirming, setConfirming] = useState(false);
  const name = memberDisplayName(member);
  const label = teamAccessRoleLabel(roleName);
  const otherActiveRoles = member.assignments.filter((assignment) => assignment.roleName !== roleName && assignment.status === "active");
  const consequence = roleRevokeRemovesAdministrator(member, roleName)
    ? `${name} will no longer be an administrator and will lose access to Team & Access.`
    : otherActiveRoles.length === 0 && !member.inheritedAdmin
      ? `${name} will lose access to this organization.`
      : `${name} keeps their other roles.`;
  return (
    <span className="gk-team-access-member-revoke">
      <button
        type="button"
        className="gk-organization-join-close"
        disabled={Boolean(savingKey)}
        onClick={() => {
          if (!confirming) {
            setConfirming(true);
            return;
          }
          setConfirming(false);
          onRevokeRole?.(member, roleName);
        }}
      >
        {confirming ? `Confirm removing ${label}` : `Remove ${label} role`}
      </button>
      {confirming ? (
        <>
          <button type="button" className="gk-organization-join-close" onClick={() => setConfirming(false)}>Cancel</button>
          <p className="gk-team-access-member-warning" role="alert">{consequence}</p>
        </>
      ) : null}
    </span>
  );
}

// Additive grant (B/E C04) of a role the server offered for this member.
function AddRoleControl({ member, savingKey, onGrantRole }) {
  const [draftRole, setDraftRole] = useState(member.grantableRoles[0] || "");
  const role = member.grantableRoles.includes(draftRole) ? draftRole : member.grantableRoles[0] || "";
  const selectId = `gk-team-access-add-role-${domId(member.key)}`;
  return (
    <div className="gk-team-access-member-edit">
      <label className="gk-team-access-visually-hidden" htmlFor={selectId}>Add a role for {memberDisplayName(member)}</label>
      <select id={selectId} className="gk-team-access-select" value={role} disabled={Boolean(savingKey)} onChange={(event) => setDraftRole(event.target.value)}>
        {member.grantableRoles.map((option) => (
          <option key={option} value={option}>{teamAccessRoleLabel(option)}</option>
        ))}
      </select>
      <button type="button" className="gk-organization-join-request-btn" disabled={Boolean(savingKey) || !role} onClick={() => onGrantRole?.(member, role)}>
        {savingKey === member.key ? "Saving..." : "Add role"}
      </button>
    </div>
  );
}

function MemberRow({ member, savingKey, onChangeRole, onGrantRole, onRevokeRole }) {
  const name = memberDisplayName(member);
  const authority = describeMemberAuthority(member);
  const accountStatus = teamAccessAccountStatusLabel(member);
  const effectiveRoles = member.effectiveRoles.length > 0 ? member.effectiveRoles : [member.effectiveRole];
  const inactiveAssignments = member.assignments.filter((assignment) => assignment.status !== "active");
  const severalAssignments = member.assignments.length > 1;

  return (
    <li className="gk-team-access-member" data-team-access-member={member.key}>
      <div className="gk-team-access-member-main">
        <span className="gk-team-access-member-name">{name}</span>
        <span className="gk-team-access-member-roles">
          {effectiveRoles.map((role) => (
            <span key={role || "none"} className={`gk-team-access-role gk-team-access-role--${role || "none"}`}>
              {teamAccessRoleLabel(role)}
            </span>
          ))}
          {member.effectiveStatus && member.effectiveStatus !== "active" ? (
            <span className="gk-team-access-role gk-team-access-role--inactive">Inactive</span>
          ) : null}
          {member.effectiveStatus === "active" && inactiveAssignments.map((assignment) => (
            <span key={`inactive-${assignment.roleName}`} className="gk-team-access-role gk-team-access-role--inactive">
              {teamAccessRoleLabel(assignment.roleName)} (inactive)
            </span>
          ))}
          {accountStatus ? (
            <span className="gk-team-access-role gk-team-access-role--inactive">{accountStatus}</span>
          ) : null}
          {member.inheritedAdmin ? (
            <span className="gk-team-access-source">Get Kinder organization admin</span>
          ) : null}
        </span>
        {authority ? <p className="gk-team-access-member-note">{authority}</p> : null}
        {member.authoritySource === "both" && member.storedRole ? (
          <p className="gk-team-access-member-note">KAI role: {teamAccessRoleLabel(member.storedRole)}</p>
        ) : null}
        {!member.canChangeRole && member.storedRole && !TEAM_ACCESS_ROLE_OPTIONS.includes(member.storedRole) && member.grantableRoles.length === 0 ? (
          <p className="gk-team-access-member-note">Get Kinder manages this person's access.</p>
        ) : null}
      </div>
      {member.assignments.map((assignment) => {
        const assignmentMember = teamAccessAssignmentMember(member, assignment);
        if (!assignmentMember.canChangeRole && !assignment.canRevoke) return null;
        return (
          <div key={`${assignment.roleName}:${assignment.status}`} className="gk-team-access-member-assignment">
            {severalAssignments ? (
              <span className="gk-team-access-member-note">{teamAccessRoleLabel(assignment.roleName)}</span>
            ) : null}
            <AssignmentEditor member={assignmentMember} savingKey={savingKey} onChangeRole={onChangeRole} />
            {assignment.canRevoke ? (
              <RevokeRoleButton member={member} roleName={assignment.roleName} savingKey={savingKey} onRevokeRole={onRevokeRole} />
            ) : null}
          </div>
        );
      })}
      {member.grantableRoles.length > 0 ? (
        <AddRoleControl member={member} savingKey={savingKey} onGrantRole={onGrantRole} />
      ) : null}
    </li>
  );
}

/**
 * Team & Access: the selected organization's KAI members, their effective
 * roles, and pending join requests, for an organization administrator.
 * Purely presentational. ImpactLibraryApp.jsx mounts it only when the
 * server's access-capabilities read reports organizationAccessManagement for
 * the selected organization, and owns every request (useTeamAccess and the
 * JOIN-5 join-review state). The backend authorizes every read and change.
 */
export default function TeamAccessView({
  organizationName = "",
  roster,
  savingKey = "",
  notice = null,
  onChangeRole,
  onGrantRole,
  onRevokeRole,
  onRefresh,
  joinReview,
  onDecideJoinRequest,
}) {
  const members = roster?.members || [];
  const title = organizationName ? `Team & Access for ${organizationName}` : "Team & Access";

  return (
    <section className="gk-team-access" aria-labelledby="gk-team-access-heading">
      <header className="gk-team-access-header">
        <h1 id="gk-team-access-heading" className="gk-team-access-title">{title}</h1>
        <p className="gk-team-access-lede">
          See who can use KAI for this organization, review join requests, and change what each person can do.
        </p>
      </header>

      {joinReview?.available ? (
        <OrganizationJoinRequestsReviewPanel
          items={joinReview.items}
          loading={joinReview.loading}
          error={joinReview.error}
          actionId={joinReview.actionId}
          onDecide={onDecideJoinRequest}
        />
      ) : null}

      <section className="gk-organization-join gk-team-access-members" aria-labelledby="gk-team-access-members-heading">
        <div className="gk-organization-join-header">
          <h2 id="gk-team-access-members-heading" className="gk-organization-join-title">Members</h2>
          <button type="button" className="gk-organization-join-close" onClick={onRefresh} disabled={roster?.status === "loading"}>
            Refresh
          </button>
        </div>
        <div className="gk-organization-join-status" role="status" aria-live="polite">
          {roster?.status === "loading" ? "Loading team members..." : null}
          {roster?.status === "error" ? <span className="gk-organization-join-error">{roster.error}</span> : null}
          {notice ? (
            <span className={notice.tone === "success" ? "gk-organization-join-success" : "gk-organization-join-error"}>{notice.text}</span>
          ) : null}
          {roster?.status === "success" && members.length === 0 ? "No members yet." : null}
        </div>
        {members.length > 0 ? (
          <ul className="gk-team-access-list">
            {members.map((member) => (
              <MemberRow
                key={`${member.key}:${member.assignments.map((assignment) => `${assignment.roleName}=${assignment.status}`).join(",")}`}
                member={member}
                savingKey={savingKey}
                onChangeRole={onChangeRole}
                onGrantRole={onGrantRole}
                onRevokeRole={onRevokeRole}
              />
            ))}
          </ul>
        ) : null}
        <p className="gk-organization-join-hint">
          New people join through a join request and start as contributors. Get Kinder staff access is managed by Get Kinder.
        </p>
      </section>

      <section className="gk-team-access-legend" aria-label="Roles">
        <dl>
          {ROLE_DESCRIPTIONS.filter(([role]) => TEAM_ACCESS_ROLE_OPTIONS.includes(role) || (roster?.administrableRoles || []).includes(role)).map(([role, description]) => (
            <div key={role} className="gk-team-access-legend-item">
              <dt>{teamAccessRoleLabel(role)}</dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>
      </section>
    </section>
  );
}
