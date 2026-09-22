import React, { useEffect, useState } from "react";

import {
  claimLibraryCandidatesPath,
  getJson,
  projectCandidateClaims,
} from "../impactEvidenceLibraryLogic.js";

const COLORS = Object.freeze({
  coral: "#FF5656",
  slate: "#455A7C",
  ink: "#2C2E3A",
  textSecondary: "#5B6478",
  textMuted: "#8890A0",
});

const REVIEW_STATUS_LABELS = Object.freeze({
  reviewed: "Reviewed",
  needs_gk_review: "Needs review",
});

function StatusBadge({ status }) {
  const label = REVIEW_STATUS_LABELS[status] || status || "Status unknown";
  const isReviewed = status === "reviewed";
  return (
    <span
      style={{
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 600,
        background: isReviewed ? "#EAF4EC" : "#EEF1F6",
        color: isReviewed ? "#3E8E5A" : COLORS.slate,
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
}

/**
 * Impact Library (Package E). "Impact Fact" here is a user-facing
 * projection of the existing governed Claim Library - no kai.impact_facts
 * persistence, no second data model. Organization-wide read (same
 * claimLibraryCandidatesPath already used by Knowledge Studio's Evidence
 * tab and Impact Home) - not Project/Engagement-scoped, so this view does
 * not consume the shared C0 context.
 *
 * Only fields the read model actually returns are shown: no "Program" or
 * "Period" (no such data exists in KAI today), no tags (none exist), no
 * separate marketing description beyond the real evidence statement.
 */
export default function ImpactLibraryListView({ organizationId, onViewFact }) {
  const [claims, setClaims] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setClaims([]);
    setLoaded(false);
    setError("");
    if (!organizationId) return undefined;
    let cancelled = false;
    (async () => {
      const result = await getJson(claimLibraryCandidatesPath(organizationId));
      if (cancelled) return;
      setLoaded(true);
      if (result.statusCode !== 200 || !result.body?.ok) {
        setError("Could not load the Impact Library.");
        return;
      }
      setClaims(projectCandidateClaims(result.body.data));
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  if (!organizationId) {
    return <div style={{ color: COLORS.textMuted, fontSize: 14 }}>Select an organization to see its Impact Library.</div>;
  }

  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: COLORS.ink, margin: "0 0 4px" }}>Impact Library</h1>
      <p style={{ fontSize: 14.5, color: COLORS.textSecondary, margin: "0 0 22px" }}>
        Trusted, reusable knowledge about your organization&rsquo;s impact.
      </p>

      {!loaded ? <div style={{ fontSize: 13, color: COLORS.textMuted }}>Loading&hellip;</div> : null}
      {error ? <div style={{ fontSize: 13, color: COLORS.coral }}>{error}</div> : null}
      {loaded && !error && claims.length === 0 ? (
        <div style={{ fontSize: 13, color: COLORS.textMuted }}>No Impact Facts yet for this organization.</div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {claims.map((claim) => (
          <div
            key={claim.claimId}
            style={{
              background: "#FFFFFF",
              border: "1px solid rgba(69,90,124,0.10)",
              borderRadius: 10,
              boxShadow: "0 1px 3px rgba(30,41,59,0.05), 0 8px 20px rgba(30,41,59,0.04)",
              padding: 22,
              display: "flex",
              justifyContent: "space-between",
              gap: 16,
              alignItems: "flex-start",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 15.5, fontWeight: 600, color: COLORS.ink }}>
                  {claim.evidenceStatement || "Statement not yet available"}
                </span>
                <StatusBadge status={claim.claimReviewStatus} />
              </div>
              <div style={{ fontSize: 12.5, color: COLORS.textMuted, fontFamily: "'IBM Plex Mono', monospace" }}>
                {claim.claimType} &bull; {claim.claimStrength}
                {claim.evidenceSupportStrength ? ` • evidence: ${claim.evidenceSupportStrength}` : ""}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onViewFact(claim.claimId)}
              style={{
                fontFamily: "'Work Sans', sans-serif",
                fontWeight: 600,
                fontSize: 13.5,
                padding: "9px 18px",
                borderRadius: 8,
                cursor: "pointer",
                background: "#FFFFFF",
                color: COLORS.coral,
                border: `1px solid ${COLORS.coral}`,
                flexShrink: 0,
              }}
            >
              View
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
