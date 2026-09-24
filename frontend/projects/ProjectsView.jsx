import React, { useState } from "react";

const COLORS = Object.freeze({
  coral: "#FF5656",
  slate: "#455A7C",
  ink: "#2C2E3A",
  textSecondary: "#5B6478",
  textMuted: "#8890A0",
});

/**
 * Projects (Package F). "Project" is the user-facing term; the backend
 * object is kai.engagements - no new Project table/model/service. This
 * view presents the same shared Project/Engagement list and selection
 * ImpactLibraryApp owns (Package C0) - selecting a row here updates that
 * one shared context, the same one Knowledge Studio consumes, rather than
 * a second independent selector.
 *
 * Only real engagement fields are shown (engagement_code as the Project
 * name, engagement_type as its type, use_case_type, engagement_status/
 * project_status). No "reporting period" is shown - kai.engagements has no
 * such column today; inventing one was avoided rather than fabricated.
 *
 * "+ New Project" is wired to the real, newly-authorized create-engagement
 * capability (Package F) - never a dead button - and is offered only when
 * canCreate (the server's projectManagement capability) is true. Every
 * member can view and select Projects.
 */
export default function ProjectsView({
  engagements,
  engagementsLoaded,
  selectedEngagementId,
  onSelectEngagement,
  canCreate = false,
  onCreateEngagement,
  creating,
  createError,
}) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectType, setNewProjectType] = useState("");
  const [newProjectUseCase, setNewProjectUseCase] = useState("");

  const handleCreate = async (event) => {
    event.preventDefault();
    const name = newProjectName.trim();
    if (!name) return;
    const result = await onCreateEngagement(name, newProjectType.trim() || undefined, newProjectUseCase.trim() || undefined);
    if (result?.ok) {
      setNewProjectName("");
      setNewProjectType("");
      setNewProjectUseCase("");
      setShowCreateForm(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22, gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: COLORS.ink, margin: "0 0 4px" }}>Projects</h1>
          <p style={{ fontSize: 14.5, color: COLORS.textSecondary, margin: 0 }}>
            Use projects to focus on specific reporting needs or initiatives.
          </p>
        </div>
        {canCreate ? (
          <button
            type="button"
            onClick={() => setShowCreateForm((open) => !open)}
            style={{
              fontFamily: "'Work Sans', sans-serif",
              fontWeight: 600,
              fontSize: 14,
              padding: "10px 18px",
              borderRadius: 8,
              cursor: "pointer",
              background: COLORS.coral,
              color: "#FFFFFF",
              border: `1px solid ${COLORS.coral}`,
              flexShrink: 0,
            }}
          >
            + New Project
          </button>
        ) : null}
      </div>

      {canCreate && showCreateForm ? (
        <form
          onSubmit={handleCreate}
          style={{
            background: "#FFFFFF",
            border: "1px solid rgba(69,90,124,0.10)",
            borderRadius: 10,
            padding: 18,
            marginBottom: 20,
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <input
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
            placeholder="Project name"
            style={{ flex: 1, minWidth: 220, fontSize: 14, padding: "9px 12px", borderRadius: 8, border: "1px solid rgba(69,90,124,0.22)" }}
          />
          <input
            value={newProjectType}
            onChange={(event) => setNewProjectType(event.target.value)}
            placeholder="Type (optional)"
            style={{ flex: 1, minWidth: 160, fontSize: 14, padding: "9px 12px", borderRadius: 8, border: "1px solid rgba(69,90,124,0.22)" }}
          />
          <input
            value={newProjectUseCase}
            onChange={(event) => setNewProjectUseCase(event.target.value)}
            placeholder="Use case (optional)"
            style={{ flex: 1, minWidth: 160, fontSize: 14, padding: "9px 12px", borderRadius: 8, border: "1px solid rgba(69,90,124,0.22)" }}
          />
          <button
            type="submit"
            disabled={creating || !newProjectName.trim()}
            style={{
              fontFamily: "'Work Sans', sans-serif",
              fontWeight: 600,
              fontSize: 13.5,
              padding: "9px 18px",
              borderRadius: 8,
              cursor: creating ? "default" : "pointer",
              background: COLORS.coral,
              color: "#FFFFFF",
              border: `1px solid ${COLORS.coral}`,
              opacity: creating ? 0.7 : 1,
            }}
          >
            {creating ? "Creating…" : "Create"}
          </button>
          {createError ? <div style={{ fontSize: 12.5, color: COLORS.coral, width: "100%" }}>{createError}</div> : null}
        </form>
      ) : null}

      {!engagementsLoaded ? <div style={{ fontSize: 13, color: COLORS.textMuted }}>Loading&hellip;</div> : null}
      {engagementsLoaded && engagements.length === 0 ? (
        <div style={{ fontSize: 13, color: COLORS.textMuted }}>No Projects yet for this organization.</div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {engagements.map((engagement) => {
          const active = engagement.engagement_id === selectedEngagementId;
          return (
            <div
              key={engagement.engagement_id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectEngagement(engagement.engagement_id)}
              style={{
                background: "#FFFFFF",
                border: `1px solid ${active ? COLORS.coral : "rgba(69,90,124,0.10)"}`,
                borderRadius: 10,
                padding: "14px 18px",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: COLORS.ink }}>
                  {engagement.engagement_code || engagement.engagement_id}
                </div>
                <div style={{ fontSize: 12.5, color: COLORS.textMuted, marginTop: 2 }}>
                  {engagement.engagement_type || "Type not set"}
                  {engagement.use_case_type ? ` • ${engagement.use_case_type}` : ""}
                  {engagement.engagement_status ? ` • ${engagement.engagement_status}` : ""}
                </div>
              </div>
              {active ? (
                <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.coral }}>Active</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
