import React from "react";

const COLORS = Object.freeze({
  coral: "#FF5656",
  slate: "#455A7C",
  ink: "#2C2E3A",
  textSecondary: "#5B6478",
  textMuted: "#8890A0",
});

const CARD_STYLE = Object.freeze({
  background: "#FFFFFF",
  border: "1px solid rgba(69,90,124,0.10)",
  borderRadius: 10,
  boxShadow: "0 1px 3px rgba(30,41,59,0.05), 0 8px 20px rgba(30,41,59,0.04)",
  padding: 22,
});

function dimensionLabel(dimensionKey) {
  return String(dimensionKey || "").replace(/_/g, " ");
}

/**
 * Client Impact Library. Renders only the client-safe reviewed Impact Facts
 * (clientImpactFactsPath, fetched once per organization by
 * ImpactLibraryApp and shared with the client Knowledge Studio): claims the
 * governed evaluator marks eligible for the internal audience. The GK
 * ImpactLibraryListView/ImpactFactDetailView read the GK-internal
 * claim-library index and per-claim traceability (unreviewed claims,
 * evidence text, lineage, review decisions) and are never mounted for a
 * client. The detail view uses the already-loaded fact only - no second
 * request.
 */
export default function ClientImpactLibraryView({ facts, selectedClaimId, onViewFact, onBack }) {
  const status = facts?.status || "loading";
  const items = Array.isArray(facts?.items) ? facts.items : [];
  const selected = selectedClaimId ? items.find((item) => item.claimId === selectedClaimId) || null : null;

  if (selected) {
    return (
      <div>
        <div
          role="button"
          tabIndex={0}
          onClick={onBack}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") onBack?.();
          }}
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5, color: COLORS.slate, fontWeight: 600, cursor: "pointer", marginBottom: 18 }}
        >
          &larr; Back to Impact Library
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: COLORS.ink, margin: "0 0 22px" }}>
          {selected.statement || "Impact Fact"}
        </h1>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 }}>
          <div style={CARD_STYLE}>
            <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.slate, marginBottom: 10 }}>Key details</div>
            {[
              ["Type", selected.claimType || "Not yet available"],
              ["Status", "Reviewed for internal use"],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: COLORS.textMuted }}>{label}</span>
                <span style={{ fontSize: 13, color: COLORS.ink, fontWeight: 500 }}>{value}</span>
              </div>
            ))}
          </div>
          <div style={CARD_STYLE}>
            <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.slate, marginBottom: 10 }}>Limitations</div>
            {selected.limitationDimensionKeys.length === 0 ? (
              <div style={{ fontSize: 13, color: COLORS.textMuted }}>No accepted limitations are recorded for this Impact Fact.</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {selected.limitationDimensionKeys.map((key) => (
                  <li key={key} style={{ fontSize: 13.5, color: COLORS.ink, marginBottom: 8 }}>
                    Accepted with a known limitation: {dimensionLabel(key)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 14 }}>
          Reviewed for your organization&rsquo;s internal use. Funder or public use needs its own review.
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: COLORS.ink, margin: "0 0 4px" }}>Impact Library</h1>
      <p style={{ fontSize: 14.5, color: COLORS.textSecondary, margin: "0 0 22px" }}>
        Trusted, reusable knowledge about your organization&rsquo;s impact.
      </p>

      {status === "loading" ? <div style={{ fontSize: 13, color: COLORS.textMuted }}>Loading&hellip;</div> : null}
      {status === "error" ? <div style={{ fontSize: 13, color: COLORS.coral }}>Could not load the Impact Library.</div> : null}
      {status === "success" && items.length === 0 ? (
        <div style={{ fontSize: 13, color: COLORS.textMuted }}>
          No reviewed Impact Facts yet. Facts appear here once your organization&rsquo;s information has been reviewed.
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {status === "success" ? items.map((fact) => (
          <div
            key={fact.claimId}
            style={{ ...CARD_STYLE, display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15.5, fontWeight: 600, color: COLORS.ink, marginBottom: 6 }}>
                {fact.statement || "Statement not yet available"}
              </div>
              <div style={{ fontSize: 12.5, color: COLORS.textMuted }}>
                {fact.claimType || "Impact Fact"}
                {fact.limitationDimensionKeys.length > 0 ? " • has known limitations" : ""}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onViewFact?.(fact.claimId)}
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
        )) : null}
      </div>
      {status === "success" && facts?.truncated ? (
        <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 12 }}>Showing the first {items.length} reviewed Impact Facts.</div>
      ) : null}
    </div>
  );
}
