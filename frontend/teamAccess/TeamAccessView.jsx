import React, { useState } from "react";

import OrganizationJoinRequestsReviewPanel from "../impactLibrary/OrganizationJoinRequestsReviewPanel.jsx";
import {
  LAST_ADMINISTRATOR_MESSAGE,
  TEAM_ACCESS_ROLE_OPTIONS,
  describeMemberAuthority,
  memberDisplayName,
  roleChangeBlockedAsLastAdministrator,
  roleChangeRemovesAdministrator,
  teamAccessAccountStatusLabel,
  teamAccessRoleLabel,
} from "./teamAccessLogic.js";

const ROLE_DESCRIPTIONS = Object.freeze([
  ["client_admin", "Uploads files, manages Projects and the Improvement Plan, and manages team & access."],
  ["client_reviewer", "Views your organization's KAI workspace and answers client follow-ups."],
  ["client_contributor", "Views your organization's KAI workspace."],
]);

function MemberRow({ member, savingKey, onChangeRole }) {
  const [draftRole, setDraftRole] = useState(member.storedRole || "");
  const [confirming, setConfirming] = useState(false);
  const name = memberDisplayName(member);
  const authority = describeMemberAuthority(member);
  const accountStatus = teamAccessAccountStatusLabel(member);
  const busy = savingKey === member.key;
  const removesAdmin = roleChangeRemovesAdministrator(member, draftRole);
  const blockedAsSoleAdmin = roleChangeBlockedAsLastAdministrator(member, draftRole);
  const unchanged = draftRole === member.storedRole && member.storedStatus === "active";
  const selectId = `gk-team-access-role-${member.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  const save = () => {
    if (removesAdmin && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onChangeRole?.(member, draftRole);
  };

  return (
    <li className="gk-team-access-member" data-team-access-member={member.key}>
      <div className="gk-team-access-member-main">
        <span className="gk-team-access-member-name">{name}</span>
        <span className="gk-team-access-member-roles">
          <span className={`gk-team-access-role gk-team-access-role--${member.effectiveRole || "none"}`}>
            {teamAccessRoleLabel(member.effectiveRole)}
          </span>
          {member.effectiveStatus && member.effectiveStatus !== "active" ? (
            <span className="gk-team-access-role gk-team-access-role--inactive">Inactive</span>
          ) : null}
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
        {!member.canChangeRole && member.storedRole && !TEAM_ACCESS_ROLE_OPTIONS.includes(member.storedRole) ? (
          <p className="gk-team-access-member-note">Get Kinder manages this person's access.</p>
        ) : null}
      </div>
      {member.canChangeRole ? (
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
            {TEAM_ACCESS_ROLE_OPTIONS.map((role) => (
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
                key={`${member.key}:${member.storedRole || ""}:${member.storedStatus || ""}`}
                member={member}
                savingKey={savingKey}
                onChangeRole={onChangeRole}
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
          {ROLE_DESCRIPTIONS.map(([role, description]) => (
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
