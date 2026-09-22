import React, { useEffect, useMemo, useState } from "react";

import {
  claimTraceabilityPath,
  getJson,
  projectTraceability,
  blockerDisplayText,
  LIBRARY_AUDIENCES,
} from "../impactEvidenceLibraryLogic.js";

const COLORS = Object.freeze({
  coral: "#FF5656",
  slate: "#455A7C",
  ink: "#2C2E3A",
  textSecondary: "#5B6478",
  textMuted: "#8890A0",
});

const TABS = Object.freeze([
  ["overview", "Overview"],
  ["sources", "Sources"],
  ["limitations", "Limitations"],
  ["allowedUse", "Allowed use"],
  ["history", "History"],
]);

function SectionLabel({ children }) {
  return <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.slate, marginBottom: 10 }}>{children}</div>;
}

/**
 * Impact Fact Detail (Package E). Built entirely over the existing governed
 * per-claim Traceability read (claimTraceabilityPath / projectTraceability)
 * - the same data the Knowledge Studio Traceability panel already fetches
 * and shows, just organized into the approved tabs instead of one flat
 * panel. No new fetch beyond re-requesting per selected audience, no second
 * data source, no fabricated field.
 *
 * "Use this" is intentionally not wired: no existing general-purpose
 * "reuse this claim" action was found (existing generation actions -
 * Evidence Summary, Grant Response Packet, Board Reporting - are
 * engagement-scoped and specific to those destinations, not a generic
 * action). Recorded NOT_CONFIRMED rather than fabricated.
 *
 * History is intentionally minimal: no human-readable, timestamped history
 * read path exists for a claim today - only its current review decision
 * state, which is shown as "Current state," not a fabricated timeline.
 */
export default function ImpactFactDetailView({ organizationId, claimId, onBack }) {
  const [audience, setAudience] = useState("internal");
  const [traceability, setTraceability] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    setTraceability(null);
    setLoaded(false);
    setError("");
    if (!organizationId || !claimId) return undefined;
    let cancelled = false;
    (async () => {
      const result = await getJson(claimTraceabilityPath(organizationId, claimId, audience));
      if (cancelled) return;
      setLoaded(true);
      if (result.statusCode !== 200 || !result.body?.ok) {
        setError("Could not load this Impact Fact.");
        return;
      }
      setTraceability(projectTraceability(result.body.data));
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, claimId, audience]);

  const limitations = useMemo(() => {
    if (!traceability) return [];
    const items = [];
    for (const dimension of traceability.dimensions) {
      if (dimension.displayStatus === "known_limitation") {
        items.push(`Known limitation: ${dimension.dimensionKey.replace(/_/g, " ")}`);
      } else if (dimension.assessmentStatus === "unresolved") {
        items.push(`Unresolved: ${dimension.dimensionKey.replace(/_/g, " ")}`);
      }
    }
    for (const gap of traceability.gapItems) {
      if (gap.is_current === true) items.push(`Open gap: ${(gap.dimension_key || "").replace(/_/g, " ")}`);
    }
    for (const conflict of traceability.potentialConflictGroups) {
      if (conflict.is_current === true) items.push("A potential conflict with another claim has not yet been reviewed.");
    }
    return items;
  }, [traceability]);

  if (!claimId) return null;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={onBack}
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5, color: COLORS.slate, fontWeight: 600, cursor: "pointer", marginBottom: 18 }}
      >
        &larr; Back to Impact Library
      </div>

      {!loaded ? <div style={{ fontSize: 13, color: COLORS.textMuted }}>Loading&hellip;</div> : null}
      {error ? <div style={{ fontSize: 13, color: COLORS.coral }}>{error}</div> : null}

      {loaded && !error && traceability ? (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 22, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: COLORS.ink, margin: 0 }}>
              {traceability.evidence?.statement || "Impact Fact"}
            </h1>
            <select
              value={audience}
              onChange={(event) => setAudience(event.target.value)}
              style={{ fontSize: 13, padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(69,90,124,0.22)" }}
            >
              {LIBRARY_AUDIENCES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>

          <div style={{ display: "flex", gap: 24, borderBottom: "1px solid rgba(69,90,124,0.14)", marginBottom: 24 }}>
            {TABS.map(([key, label]) => (
              <div
                key={key}
                role="button"
                tabIndex={0}
                onClick={() => setActiveTab(key)}
                style={{
                  paddingBottom: 12,
                  fontSize: 14,
                  fontWeight: activeTab === key ? 600 : 500,
                  color: activeTab === key ? COLORS.ink : COLORS.textMuted,
                  borderBottom: `2px solid ${activeTab === key ? COLORS.coral : "transparent"}`,
                  cursor: "pointer",
                }}
              >
                {label}
              </div>
            ))}
          </div>

          {activeTab === "overview" ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div style={{ background: "#FFFFFF", border: "1px solid rgba(69,90,124,0.10)", borderRadius: 10, padding: 22 }}>
                <SectionLabel>Key details</SectionLabel>
                {[
                  ["Evidence strength", traceability.evidence?.support_strength || "Not yet available"],
                  ["Review status", traceability.evidenceReviewDecision?.decisionOutcome || traceability.evidence?.evidence_review_status || "Not yet available"],
                  ["Eligible for requested audience", traceability.eligible ? "Yes" : "Not currently"],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                    <span style={{ fontSize: 13, color: COLORS.textMuted }}>{k}</span>
                    <span style={{ fontSize: 13, color: COLORS.ink, fontWeight: 500 }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ background: "#FFFFFF", border: "1px solid rgba(69,90,124,0.10)", borderRadius: 10, padding: 22 }}>
                <SectionLabel>Statement</SectionLabel>
                <p style={{ fontSize: 14, color: COLORS.ink, lineHeight: 1.6, margin: 0 }}>
                  {traceability.evidence?.statement || "This evidence statement is not yet available."}
                </p>
              </div>
            </div>
          ) : null}

          {activeTab === "sources" ? (
            <div style={{ background: "#FFFFFF", border: "1px solid rgba(69,90,124,0.10)", borderRadius: 10, padding: 22 }}>
              <SectionLabel>Why can KAI say this?</SectionLabel>
              {traceability.source ? (
                <div style={{ fontSize: 14, color: COLORS.ink, marginBottom: 6 }}>
                  Source: {traceability.source.reviewed_source_type || traceability.source.source_id}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: COLORS.textMuted }}>No source information is available yet.</div>
              )}
              {traceability.sourceVersion ? (
                <div style={{ fontSize: 13, color: COLORS.textSecondary }}>
                  Version {traceability.sourceVersion.is_current ? "(current)" : "(historical)"}
                </div>
              ) : null}
              {traceability.locator ? (
                <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 6 }}>
                  Location: {traceability.locator.locator_type || "column"} {traceability.locator.coordinates?.column_name || ""}
                </div>
              ) : null}
            </div>
          ) : null}

          {activeTab === "limitations" ? (
            <div style={{ background: "#FFFFFF", border: "1px solid rgba(69,90,124,0.10)", borderRadius: 10, padding: 22 }}>
              <SectionLabel>What this fact does not demonstrate</SectionLabel>
              {limitations.length === 0 ? (
                <div style={{ fontSize: 13, color: COLORS.textMuted }}>No known limitations recorded for this Impact Fact.</div>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {limitations.map((text, index) => (
                    <li key={index} style={{ fontSize: 13.5, color: COLORS.ink, marginBottom: 8 }}>{text}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {activeTab === "allowedUse" ? (
            <div style={{ background: "#FFFFFF", border: "1px solid rgba(69,90,124,0.10)", borderRadius: 10, padding: 22 }}>
              <SectionLabel>Allowed use</SectionLabel>
              {[
                ["Internal planning", traceability.evidence?.internal_only === false || traceability.evidence?.internal_only === undefined ? "Suitable" : "Internal only"],
                ["Funder reporting", traceability.evidence?.funder_use_allowed ? "Suitable" : "Not currently allowed"],
                ["Public use", traceability.evidence?.public_use_allowed ? "Suitable" : "Requires review"],
              ].map(([context, note]) => (
                <div key={context} style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
                  <span style={{ fontSize: 13.5, color: COLORS.ink }}>{context}</span>
                  <span style={{ fontSize: 12.5, color: COLORS.textMuted }}>{note}</span>
                </div>
              ))}
              {!traceability.eligible && traceability.blockerCodes.length > 0 ? (
                <div style={{ fontSize: 12.5, color: COLORS.coral, marginTop: 8 }}>
                  Not currently eligible for the "{audience}" audience: {traceability.blockerCodes.map((code) => blockerDisplayText(code, audience)).join("; ")}
                </div>
              ) : null}
              <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 14 }}>
                Suitability reflects evidence quality, not final publication authority. Confirm any public release
                through your organization&rsquo;s usual sign-off.
              </div>
            </div>
          ) : null}

          {activeTab === "history" ? (
            <div style={{ background: "#FFFFFF", border: "1px solid rgba(69,90,124,0.10)", borderRadius: 10, padding: 22 }}>
              <SectionLabel>Current state</SectionLabel>
              {traceability.claimReviewDecision?.decisionOutcome || traceability.evidenceReviewDecision?.decisionOutcome ? (
                <div style={{ fontSize: 13.5, color: COLORS.ink }}>
                  {traceability.claimReviewDecision?.decisionOutcome
                    ? `Claim review: ${traceability.claimReviewDecision.decisionOutcome}`
                    : `Evidence review: ${traceability.evidenceReviewDecision.decisionOutcome}`}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: COLORS.textMuted }}>
                  A timestamped history is not yet available for this Impact Fact - only its current review state is shown here.
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
