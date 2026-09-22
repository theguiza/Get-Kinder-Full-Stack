import React from "react";

const COLORS = Object.freeze({
  coral: "#FF5656",
  slate: "#455A7C",
  ink: "#2C2E3A",
  textSecondary: "#5B6478",
  textMuted: "#8890A0",
});

function Row({ title, subtitle, badge }) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid rgba(69,90,124,0.10)",
        borderRadius: 10,
        boxShadow: "0 1px 3px rgba(30,41,59,0.05), 0 8px 20px rgba(30,41,59,0.04)",
        padding: "16px 20px",
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink, marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: COLORS.textMuted }}>{subtitle}</div>
      </div>
      <span
        style={{
          padding: "4px 10px",
          borderRadius: 999,
          fontSize: 11.5,
          fontWeight: 600,
          background: "#EEF1F6",
          color: COLORS.slate,
          flexShrink: 0,
        }}
      >
        {badge}
      </span>
    </div>
  );
}

/**
 * Needs Attention (Package H). Cross-product human-action inbox, reached
 * only via the header bell. Every row below is derived from the same
 * already-governed data Knowledge Studio's Reviews tab already shows
 * (useNeedsAttention.js) - this is a different presentation of one
 * authoritative state, not a second review truth.
 */
export default function NeedsAttentionView({
  organizationId,
  resolved,
  conclusivelyEmpty,
  claimReviewItems,
  evidenceReviewItems,
  followupItems,
  sensitivityItems,
  sensitivityStatus,
}) {
  if (!organizationId) {
    return <div style={{ color: COLORS.textMuted, fontSize: 14 }}>Select an organization to see what needs attention.</div>;
  }

  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: COLORS.ink, margin: "0 0 4px" }}>Needs Attention</h1>
      <p style={{ fontSize: 14.5, color: COLORS.textSecondary, margin: "0 0 22px" }}>
        Items that need your input, review, or follow-up.
      </p>

      {!resolved ? <div style={{ fontSize: 13, color: COLORS.textMuted }}>Loading&hellip;</div> : null}

      {resolved && conclusivelyEmpty ? (
        <div style={{ fontSize: 13, color: COLORS.textMuted }}>Nothing currently needs attention for this organization.</div>
      ) : null}

      {resolved && !conclusivelyEmpty ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {claimReviewItems.map((entry, index) => (
            <Row
              key={`claim-${index}`}
              title={`Claim ${entry.item.claim?.claim_id ? entry.item.claim.claim_id.slice(0, 8) : "review"}`}
              subtitle={entry.text}
              badge="Review"
            />
          ))}
          {evidenceReviewItems.map((entry, index) => (
            <Row
              key={`evidence-${index}`}
              title={`Evidence ${entry.item.claim?.claim_id ? entry.item.claim.claim_id.slice(0, 8) : "review"}`}
              subtitle={entry.text}
              badge="Review"
            />
          ))}
          {sensitivityStatus === "ready"
            ? sensitivityItems.map((item, index) => (
                <Row
                  key={`sensitivity-${index}`}
                  title={item.summary || "Sensitivity & allowed-use review"}
                  subtitle="Source sensitivity / allowed-use classification"
                  badge="Review"
                />
              ))
            : null}
          {followupItems.map((entry, index) => (
            <Row
              key={`followup-${index}`}
              title={`Claim ${entry.item.claim?.claim_id ? entry.item.claim.claim_id.slice(0, 8) : "follow-up"}`}
              subtitle={entry.text}
              badge="Follow-up"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
