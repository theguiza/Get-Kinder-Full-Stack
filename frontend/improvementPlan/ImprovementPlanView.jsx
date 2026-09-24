import React, { useState } from "react";
import {
  IMPROVEMENT_PRACTICE_CADENCE_LABELS,
  humanizeImprovementPracticeStatus,
  humanizeImprovementPracticeCadence,
} from "./improvementPlanLogic.js";

const COLORS = Object.freeze({
  coral: "#FF5656",
  slate: "#455A7C",
  ink: "#2C2E3A",
  textSecondary: "#5B6478",
  textMuted: "#8890A0",
});

const STATUS_DOT_COLORS = Object.freeze({
  recommended: "#8890A0",
  active: "#2E9E6B",
  paused: "#C98A1B",
  completed: "#455A7C",
});

const CADENCE_OPTIONS = Object.keys(IMPROVEMENT_PRACTICE_CADENCE_LABELS);

/**
 * Improvement Plan (Package G2), over the real kai.improvement_practices
 * persistence Package G added. "Practice" is the user-facing term; every
 * row shown here is a real, persisted practice - no fabricated
 * recommendation or sample card. Organization-level practices (no Project)
 * and Project-scoped practices are both shown; the shared Project context
 * bar (Package C0) drives which are fetched (all vs. one Project).
 *
 * responsible_actor_user_id and gap_log_item_id are never rendered as raw
 * identifiers - only a "Originated from a data gap" tag and (for Projects)
 * the real engagement_code label are shown.
 *
 * canManage is the server's improvementPlanManagement capability (the
 * create/status policies). Without it the plan is read-only: no
 * "+ New Practice" and the status is shown as text, not a control.
 */
export default function ImprovementPlanView({
  practices,
  practicesLoaded,
  engagements,
  selectedEngagementId,
  canManage = false,
  onCreatePractice,
  creating,
  createError,
  onChangeStatus,
  changingStatusId,
  statusError,
}) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [title, setTitle] = useState("");
  const [rationale, setRationale] = useState("");
  const [cadence, setCadence] = useState("monthly");
  const [nextDueDate, setNextDueDate] = useState("");

  const engagementLabelById = new Map(
    (engagements || []).map((engagement) => [engagement.engagement_id, engagement.engagement_code || engagement.engagement_id]),
  );

  const handleCreate = async (event) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedRationale = rationale.trim();
    if (!trimmedTitle || !trimmedRationale) return;
    const result = await onCreatePractice({
      title: trimmedTitle,
      rationale: trimmedRationale,
      cadence,
      nextDueDate: nextDueDate || undefined,
      engagementId: selectedEngagementId || undefined,
    });
    if (result?.ok) {
      setTitle("");
      setRationale("");
      setCadence("monthly");
      setNextDueDate("");
      setShowCreateForm(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22, gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: COLORS.ink, margin: "0 0 4px" }}>Improvement Plan</h1>
          <p style={{ fontSize: 14.5, color: COLORS.textSecondary, margin: 0 }}>
            Recurring practices that turn a data or evidence gap into stronger impact evidence over time.
          </p>
        </div>
        {canManage ? (
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
            + New Practice
          </button>
        ) : null}
      </div>

      {canManage && showCreateForm ? (
        <form
          onSubmit={handleCreate}
          style={{
            background: "#FFFFFF",
            border: "1px solid rgba(69,90,124,0.10)",
            borderRadius: 10,
            padding: 18,
            marginBottom: 20,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Practice title"
            aria-label="Practice title"
            style={{ fontSize: 14, padding: "9px 12px", borderRadius: 8, border: "1px solid rgba(69,90,124,0.22)" }}
          />
          <textarea
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
            placeholder="Why this matters"
            aria-label="Why this matters"
            rows={2}
            style={{ fontSize: 14, padding: "9px 12px", borderRadius: 8, border: "1px solid rgba(69,90,124,0.22)", fontFamily: "inherit", resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ fontSize: 13, color: COLORS.textSecondary, display: "flex", flexDirection: "column", gap: 4 }}>
              Cadence
              <select
                value={cadence}
                onChange={(event) => setCadence(event.target.value)}
                style={{ fontSize: 14, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(69,90,124,0.22)" }}
              >
                {CADENCE_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {humanizeImprovementPracticeCadence(value)}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 13, color: COLORS.textSecondary, display: "flex", flexDirection: "column", gap: 4 }}>
              Next due (optional)
              <input
                type="date"
                value={nextDueDate}
                onChange={(event) => setNextDueDate(event.target.value)}
                style={{ fontSize: 14, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(69,90,124,0.22)" }}
              />
            </label>
            <button
              type="submit"
              disabled={creating || !title.trim() || !rationale.trim()}
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
                alignSelf: "flex-end",
              }}
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
          {createError ? <div style={{ fontSize: 12.5, color: COLORS.coral }}>{createError}</div> : null}
        </form>
      ) : null}

      {statusError ? <div style={{ fontSize: 12.5, color: COLORS.coral, marginBottom: 12 }}>{statusError}</div> : null}

      {!practicesLoaded ? <div style={{ fontSize: 13, color: COLORS.textMuted }}>Loading&hellip;</div> : null}
      {practicesLoaded && practices.length === 0 ? (
        <div style={{ fontSize: 13, color: COLORS.textMuted }}>No Improvement Practices yet for this organization.</div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {practices.map((practice) => (
          <div
            key={practice.improvement_practice_id}
            style={{
              background: "#FFFFFF",
              border: "1px solid rgba(69,90,124,0.10)",
              borderRadius: 10,
              padding: "14px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: COLORS.ink }}>{practice.title}</div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: STATUS_DOT_COLORS[practice.status] || COLORS.textMuted,
                  }}
                />
                {canManage ? (
                  <select
                    value={practice.status}
                    disabled={changingStatusId === practice.improvement_practice_id}
                    onChange={(event) => onChangeStatus(practice, event.target.value)}
                    aria-label="Practice status"
                    style={{
                      fontSize: 13,
                      padding: "10px 10px",
                      minHeight: 44,
                      borderRadius: 6,
                      border: "1px solid rgba(69,90,124,0.22)",
                    }}
                  >
                    <option value="recommended">{humanizeImprovementPracticeStatus("recommended")}</option>
                    <option value="active">{humanizeImprovementPracticeStatus("active")}</option>
                    <option value="paused">{humanizeImprovementPracticeStatus("paused")}</option>
                    <option value="completed">{humanizeImprovementPracticeStatus("completed")}</option>
                  </select>
                ) : (
                  <span style={{ color: COLORS.textSecondary }}>{humanizeImprovementPracticeStatus(practice.status)}</span>
                )}
              </label>
            </div>
            <div style={{ fontSize: 13, color: COLORS.textSecondary }}>{practice.rationale}</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, color: COLORS.textMuted }}>
              <span>{humanizeImprovementPracticeCadence(practice.cadence)}</span>
              {practice.next_due_date ? <span>Next due {practice.next_due_date}</span> : null}
              <span>
                {practice.engagement_id
                  ? engagementLabelById.get(practice.engagement_id) || "Project"
                  : "Organization-wide"}
              </span>
              {practice.gap_log_item_id ? <span>Originated from a data gap</span> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
