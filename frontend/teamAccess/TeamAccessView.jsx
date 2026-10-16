import React, { useState } from "react";

import OrganizationJoinRequestsReviewPanel from "../impactLibrary/OrganizationJoinRequestsReviewPanel.jsx";
import {
  GLOBAL_ROLE_EXPLANATIONS,
  LAST_ADMINISTRATOR_MESSAGE,
  TEAM_ACCESS_ROLE_OPTIONS,
  TEAM_ACCESS_SUPERUSER_ORGANIZATION_ROLE_OPTIONS,
  describeMemberAuthority,
  describeReadinessGap,
  teamAccessReadinessLabel,
  memberDisplayName,
  roleChangeBlockedAsLastAdministrator,
  roleChangeRemovesAdministrator,
  roleRevokeRemovesAdministrator,
  staffOnboardingStatusText,
  teamAccessAccountStatusLabel,
  teamAccessAssignmentMember,
  teamAccessRoleLabel,
} from "./teamAccessLogic.js";

const ROLE_DESCRIPTIONS = Object.freeze([
  ["client_admin", "Uploads files, manages Projects and the Improvement Plan, and manages team & access."],
  ["client_reviewer", "Views your organization's KAI workspace and answers client follow-ups."],
  ["client_contributor", "Views your organization's KAI workspace."],
  ["gk_operator", "Get Kinder staff who run intake, processing and source review for this organization (source review also needs the global Get Kinder operator role, which staff onboarding sets up)."],
  ["gk_reviewer", "Get Kinder staff who review evidence and claims for this organization (source and sensitivity review also need the global Get Kinder reviewer role, which staff onboarding sets up)."],
  ["gk_admin", "Get Kinder administrator of this organization: with the global Get Kinder administrator role, manages its operator and reviewer roles; also carries export and release authority."],
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
function RevokeRoleButton({ member, roleName, savingKey, onRevokeRole, staffOffboarding = false }) {
  const [confirming, setConfirming] = useState(false);
  const name = memberDisplayName(member);
  const label = teamAccessRoleLabel(roleName);
  const otherActiveRoles = member.assignments.filter((assignment) => assignment.roleName !== roleName && assignment.status === "active");
  const baseConsequence = roleRevokeRemovesAdministrator(member, roleName)
    ? `${name} will no longer be an administrator and will lose access to Team & Access.`
    : otherActiveRoles.length === 0 && !member.inheritedAdmin
      ? `${name} will lose access to this organization.`
      : `${name} keeps their other roles.`;
  const consequence = staffOffboarding
    ? `${baseConsequence} Their global ${label} role is removed too, unless another assignment or organization still needs it.`
    : baseConsequence;
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

// Platform superuser only: the person's global Get Kinder roles, kept
// separate from their organization assignments, with a confirmed grant (the
// explanation of what the role carries is shown first) and a confirmed
// revocation for each held role. The server decides every change.
function GlobalRolesControl({ member, assignableGlobalRoles, savingKey, onChangeGlobalRole }) {
  const grantable = assignableGlobalRoles.filter((role) => !member.globalRoles.includes(role));
  const [draftRole, setDraftRole] = useState(grantable[0] || "");
  const [confirming, setConfirming] = useState(null);
  const role = grantable.includes(draftRole) ? draftRole : grantable[0] || "";
  const selectId = `gk-team-access-global-role-${domId(member.key)}`;
  const busy = Boolean(savingKey);
  const act = (roleName, action) => {
    const key = `${action}:${roleName}`;
    if (confirming !== key) {
      setConfirming(key);
      return;
    }
    setConfirming(null);
    onChangeGlobalRole?.(member, roleName, action);
  };
  return (
    <div className="gk-team-access-member-global" data-team-access-global-roles={member.key}>
      <p className="gk-team-access-member-note">
        Global Get Kinder roles (all organizations): {member.globalRoles.length > 0 ? member.globalRoles.map(teamAccessRoleLabel).join(", ") : "none"}
      </p>
      {member.globalRoles.filter((held) => assignableGlobalRoles.includes(held)).map((held) => (
        <span key={held} className="gk-team-access-member-revoke">
          <button type="button" className="gk-organization-join-close" disabled={busy} onClick={() => act(held, "revoke")}>
            {confirming === `revoke:${held}` ? `Confirm revoking global ${teamAccessRoleLabel(held)}` : `Revoke global ${teamAccessRoleLabel(held)}`}
          </button>
          {confirming === `revoke:${held}` ? (
            <>
              <button type="button" className="gk-organization-join-close" onClick={() => setConfirming(null)}>Cancel</button>
              <p className="gk-team-access-member-warning" role="alert">
                {memberDisplayName(member)} loses the global {teamAccessRoleLabel(held)} role in every organization. Their organization assignments stay.
              </p>
            </>
          ) : null}
        </span>
      ))}
      {grantable.length > 0 && member.legacyUserId !== null ? (
        <div className="gk-team-access-member-edit">
          <label className="gk-team-access-visually-hidden" htmlFor={selectId}>Global role for {memberDisplayName(member)}</label>
          <select id={selectId} className="gk-team-access-select" value={role} disabled={busy} onChange={(event) => { setDraftRole(event.target.value); setConfirming(null); }}>
            {grantable.map((option) => <option key={option} value={option}>{`Global ${teamAccessRoleLabel(option)}`}</option>)}
          </select>
          <button type="button" className="gk-organization-join-request-btn" disabled={busy || !role} onClick={() => act(role, "assign")}>
            {savingKey === member.key ? "Saving..." : confirming === `assign:${role}` ? `Confirm granting global ${teamAccessRoleLabel(role)}` : "Grant global role"}
          </button>
          {confirming === `assign:${role}` ? (
            <button type="button" className="gk-organization-join-close" onClick={() => setConfirming(null)}>Cancel</button>
          ) : null}
          {role ? (
            <p className={confirming === `assign:${role}` ? "gk-team-access-member-warning" : "gk-team-access-member-note"} role={confirming === `assign:${role}` ? "alert" : undefined}
              data-global-role-explanation={role}>
              {GLOBAL_ROLE_EXPLANATIONS[role]}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// What this person's KAI roles let them do in this organization now, and
// for anything not yet possible, which assignment is missing and who can
// assign it - the server's readiness answer, never inferred from role names.
function ReadinessPanel({ member }) {
  const items = member.operationReadiness || [];
  const ready = items.filter((item) => item.ready);
  const blocked = items.filter((item) => !item.ready);
  return (
    <div className="gk-team-access-member-readiness" data-team-access-readiness={member.key}>
      <p className="gk-team-access-member-note">Get Kinder access here (from current roles; content and decision gates still apply):</p>
      <ul className="gk-team-access-readiness-list">
        {ready.map((item) => (
          <li key={item.key} data-readiness-key={item.key} data-ready="true" className="gk-team-access-member-note">
            {teamAccessReadinessLabel(item.key)}: available
          </li>
        ))}
        {blocked.map((item) => (
          <li key={item.key} data-readiness-key={item.key} data-ready="false" className="gk-team-access-member-note">
            {teamAccessReadinessLabel(item.key)}: not yet. {item.missing.map(describeReadinessGap).join(" ")}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Readiness is shown for people who hold any Get Kinder assignment (global,
// or an active organization Get Kinder role); client-only members have none
// to complete.
function holdsGetKinderAssignment(member) {
  return (member.globalRoles || []).length > 0
    || member.assignments.some((assignment) => assignment.roleName.startsWith("gk_") && assignment.status === "active");
}

// Each active operator/reviewer assignment whose staff onboarding is not
// finished: why, and - for a delegated GK administrator when nothing outside
// this organization is affected - the action that finishes it.
function StaffOnboardingStatus({ member, staffOnboardingRoles, savingKey, onCompleteStaffOnboarding }) {
  const pending = (member.staffOnboarding || []).filter((item) => item.status !== "complete");
  if (pending.length === 0) return null;
  return (
    <div className="gk-team-access-member-onboarding" data-team-access-staff-onboarding={member.key}>
      {pending.map((item) => (
        <div key={item.roleName} className="gk-team-access-member-edit" data-staff-onboarding-role={item.roleName} data-staff-onboarding-status={item.status}>
          <p className="gk-team-access-member-warning">{staffOnboardingStatusText(item)}</p>
          {item.status === "pending_completion" && staffOnboardingRoles.includes(item.roleName) ? (
            <button type="button" className="gk-organization-join-request-btn" disabled={Boolean(savingKey)}
              onClick={() => onCompleteStaffOnboarding?.(member, item.roleName)}>
              {savingKey === member.key ? "Saving..." : `Complete ${teamAccessRoleLabel(item.roleName)} onboarding`}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function MemberRow({
  member, savingKey, onChangeRole, onGrantRole, onRevokeRole, assignableGlobalRoles = [], onChangeGlobalRole,
  staffOnboardingRoles = [], onCompleteStaffOnboarding,
}) {
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
              <RevokeRoleButton member={member} roleName={assignment.roleName} savingKey={savingKey} onRevokeRole={onRevokeRole}
                staffOffboarding={staffOnboardingRoles.includes(assignment.roleName)} />
            ) : null}
          </div>
        );
      })}
      {member.grantableRoles.length > 0 ? (
        <AddRoleControl member={member} savingKey={savingKey} onGrantRole={onGrantRole} />
      ) : null}
      {Array.isArray(member.globalRoles) && assignableGlobalRoles.length > 0 ? (
        <GlobalRolesControl member={member} assignableGlobalRoles={assignableGlobalRoles} savingKey={savingKey} onChangeGlobalRole={onChangeGlobalRole} />
      ) : null}
      <StaffOnboardingStatus member={member} staffOnboardingRoles={staffOnboardingRoles} savingKey={savingKey}
        onCompleteStaffOnboarding={onCompleteStaffOnboarding} />
      {member.operationReadiness && holdsGetKinderAssignment(member) ? <ReadinessPanel member={member} /> : null}
    </li>
  );
}

// Delegated GK administrator: add Get Kinder staff by the exact email of
// their verified Get Kinder account. The server checks the account, grants the
// organization role and, when it affects no other organization, the global
// role the work needs; a person without an account registers first.
function AddStaffControl({ staffOnboardingRoles, savingKey, onAddStaff }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(staffOnboardingRoles[0] || "");
  const selectedRole = staffOnboardingRoles.includes(role) ? role : staffOnboardingRoles[0] || "";
  return (
    <section className="gk-organization-join gk-team-access-add-staff" aria-labelledby="gk-team-access-add-staff-heading">
      <h2 id="gk-team-access-add-staff-heading" className="gk-organization-join-title">Add Get Kinder staff</h2>
      <p className="gk-organization-join-hint">
        Enter the exact email of the person's verified Get Kinder account. Someone without an account must first register at
        Get Kinder and verify their email. They can sign in and start as soon as their onboarding is complete.
      </p>
      <form
        className="gk-team-access-member-edit"
        onSubmit={(event) => {
          event.preventDefault();
          onAddStaff?.(email, selectedRole);
        }}
      >
        <label className="gk-team-access-visually-hidden" htmlFor="gk-team-access-add-staff-email">Staff member's Get Kinder account email</label>
        <input id="gk-team-access-add-staff-email" type="email" className="gk-team-access-select" placeholder="Exact email of a verified Get Kinder account"
          value={email} disabled={Boolean(savingKey)} onChange={(event) => setEmail(event.target.value)} />
        <label className="gk-team-access-visually-hidden" htmlFor="gk-team-access-add-staff-role">Get Kinder staff role</label>
        <select id="gk-team-access-add-staff-role" className="gk-team-access-select" value={selectedRole} disabled={Boolean(savingKey)}
          onChange={(event) => setRole(event.target.value)}>
          {staffOnboardingRoles.map((option) => <option key={option} value={option}>{teamAccessRoleLabel(option)}</option>)}
        </select>
        <button type="submit" className="gk-organization-join-request-btn" disabled={Boolean(savingKey) || !email.trim() || !selectedRole}>
          {savingKey === "add-staff" ? "Adding..." : "Add staff member"}
        </button>
      </form>
    </section>
  );
}

// Platform superuser only: add an existing Get Kinder account to this
// organization by exact email, with any organization role.
function AddPersonControl({ savingKey, onAddPerson }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("client_contributor");
  return (
    <form
      className="gk-team-access-member-edit gk-team-access-add-person"
      onSubmit={(event) => {
        event.preventDefault();
        onAddPerson?.(email, role);
      }}
    >
      <label className="gk-team-access-visually-hidden" htmlFor="gk-team-access-add-person-email">Existing account email</label>
      <input id="gk-team-access-add-person-email" type="email" className="gk-team-access-select" placeholder="Exact email of an existing Get Kinder account"
        value={email} disabled={Boolean(savingKey)} onChange={(event) => setEmail(event.target.value)} />
      <label className="gk-team-access-visually-hidden" htmlFor="gk-team-access-add-person-role">Organization role</label>
      <select id="gk-team-access-add-person-role" className="gk-team-access-select" value={role} disabled={Boolean(savingKey)} onChange={(event) => setRole(event.target.value)}>
        {TEAM_ACCESS_SUPERUSER_ORGANIZATION_ROLE_OPTIONS.map((option) => <option key={option} value={option}>{teamAccessRoleLabel(option)}</option>)}
      </select>
      <button type="submit" className="gk-organization-join-request-btn" disabled={Boolean(savingKey) || !email.trim()}>
        {savingKey === "add-person" ? "Adding..." : "Add person"}
      </button>
    </form>
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
  administration = null,
  onSelectAdministrationOrganization,
  onChangeGlobalRole,
  onAddPerson,
  onAddStaff,
  onCompleteStaffOnboarding,
}) {
  const members = roster?.members || [];
  const title = organizationName ? `Team & Access for ${organizationName}` : "Team & Access";
  const platformAdministration = administration?.platformAdministration === true;
  const assignableGlobalRoles = roster?.globalRolesVisible ? roster.assignableGlobalRoles || [] : [];
  const staffOnboardingRoles = roster?.staffOnboardingRoles || [];

  return (
    <section className="gk-team-access" aria-labelledby="gk-team-access-heading">
      <header className="gk-team-access-header">
        <h1 id="gk-team-access-heading" className="gk-team-access-title">{title}</h1>
        <p className="gk-team-access-lede">
          See who can use KAI for this organization, review join requests, and change what each person can do.
        </p>
      </header>

      {platformAdministration ? (
        <section className="gk-organization-join gk-team-access-administration" aria-labelledby="gk-team-access-administration-heading">
          <h2 id="gk-team-access-administration-heading" className="gk-organization-join-title">Platform administration</h2>
          <label className="gk-organization-join-hint" htmlFor="gk-team-access-administration-organization">Organization to administer</label>
          <select
            id="gk-team-access-administration-organization"
            className="gk-team-access-select"
            value={administration.organizationId || ""}
            onChange={(event) => onSelectAdministrationOrganization?.(event.target.value)}
          >
            {administration.organizations.map((organization) => (
              <option key={organization.organizationId} value={organization.organizationId}>{organization.name}</option>
            ))}
          </select>
          <p className="gk-organization-join-hint">
            As a platform administrator you can manage KAI roles for any organization here. This does not open the organization's
            evidence, claims, files, drafts or reports, and it records no review decision.
          </p>
          <AddPersonControl savingKey={savingKey} onAddPerson={onAddPerson} />
        </section>
      ) : null}

      {staffOnboardingRoles.length > 0 ? (
        <AddStaffControl staffOnboardingRoles={staffOnboardingRoles} savingKey={savingKey} onAddStaff={onAddStaff} />
      ) : null}

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
            <span className={notice.tone === "success" ? "gk-organization-join-success" : notice.tone === "warning" ? "gk-team-access-member-warning" : "gk-organization-join-error"}>
              {notice.text}
            </span>
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
                assignableGlobalRoles={assignableGlobalRoles}
                onChangeGlobalRole={onChangeGlobalRole}
                staffOnboardingRoles={staffOnboardingRoles}
                onCompleteStaffOnboarding={onCompleteStaffOnboarding}
              />
            ))}
          </ul>
        ) : null}
        <p className="gk-organization-join-hint">
          {platformAdministration
            ? "Add an existing account above, or let people join through a join request. Global Get Kinder roles apply in every organization; organization roles apply here only."
            : staffOnboardingRoles.length > 0
              ? "Add Get Kinder operators and reviewers above, or give a member a staff role here. A global role is set up only when it affects no other organization; otherwise a platform administrator approves it."
              : "New people join through a join request and start as contributors. Get Kinder staff access is managed by Get Kinder."}
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
