import React, { useEffect, useMemo, useState } from "react";

import {
  claimLibraryCandidatesPath,
  organizationReviewQueuePath,
  getJson,
  projectCandidateClaims,
  projectReviewQueue,
  projectReviewQueueCompleteness,
  reviewQueueIsComplete,
  reviewQueueBlockerActionability,
  blockerDisplayText,
  projectOrganizationGapsAndRisks,
} from "./impactEvidenceLibraryLogic.js";

const COLORS = Object.freeze({
  coral: "#FF5656",
  slate: "#455A7C",
  ink: "#2C2E3A",
  textSecondary: "#5B6478",
  textMuted: "#8890A0",
});

function StatTile({ n, label, alert }) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        borderRadius: 10,
        boxShadow: "0 1px 3px rgba(30,41,59,0.05), 0 8px 20px rgba(30,41,59,0.04)",
        padding: "18px 20px",
        border: `1px solid ${alert ? "rgba(255,86,86,0.3)" : "rgba(69,90,124,0.10)"}`,
      }}
    >
      <div style={{ fontSize: 26, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace", color: alert ? COLORS.coral : COLORS.ink }}>
        {n}
      </div>
      <div style={{ fontSize: 12.5, color: COLORS.textSecondary, marginTop: 4 }}>{label}</div>
    </div>
  );
}

/**
 * A short, plain but honest label for one Review Queue item, built only
 * from fields the server actually returns (claim id, blocker code). No
 * claim-statement/plain-language text is available in any DTO this
 * frontend receives today (tracked as a Package E dependency, not invented
 * here) - so this intentionally reads as identifiers/status, not marketing
 * copy, rather than fabricate prose the data does not support.
 */
function reviewQueueItemLabel(item) {
  const shortClaimId = typeof item.claim?.claim_id === "string" ? item.claim.claim_id.slice(0, 8) : "unknown";
  const blockerCode = item.blockerCodes?.[0];
  const blockerText = blockerCode ? blockerDisplayText(blockerCode, item.requestedAudience) : "needs attention";
  return { claimLabel: `Claim ${shortClaimId}`, blockerText };
}

/**
 * Impact Home (Package C, KAI Impact Library redesign). Every number and
 * list item here is a direct projection of an existing, already-governed
 * read path (governed Claim Library, Review Queue, Gaps and Risks) - no
 * fabricated "Programs" count, no invented "KAI recommends" copy, no
 * fabricated Recent Activity, per owner decision. Home is organization-wide:
 * none of its reads are gated on an engagement/Project.
 */
export default function ImpactHomeView({ organizationId, onGoToKnowledgeStudio }) {
  const [candidateClaims, setCandidateClaims] = useState([]);
  const [claimsLoaded, setClaimsLoaded] = useState(false);

  const [reviewQueueItems, setReviewQueueItems] = useState([]);
  const [reviewQueueCompleteness, setReviewQueueCompleteness] = useState({ truncated: false, evaluationErrorCount: 0 });
  const [reviewQueueRequestState, setReviewQueueRequestState] = useState("idle");

  useEffect(() => {
    setCandidateClaims([]);
    setClaimsLoaded(false);
    setReviewQueueItems([]);
    setReviewQueueCompleteness({ truncated: false, evaluationErrorCount: 0 });
    setReviewQueueRequestState("idle");
    if (!organizationId) return undefined;

    let cancelled = false;
    (async () => {
      const result = await getJson(claimLibraryCandidatesPath(organizationId));
      if (cancelled) return;
      setClaimsLoaded(true);
      if (result.statusCode !== 200 || !result.body?.ok) {
        setCandidateClaims([]);
        return;
      }
      setCandidateClaims(projectCandidateClaims(result.body.data));
    })();

    (async () => {
      setReviewQueueRequestState("loading");
      const result = await getJson(organizationReviewQueuePath(organizationId));
      if (cancelled) return;
      if (result.statusCode !== 200 || !result.body?.ok) {
        setReviewQueueRequestState("error");
        return;
      }
      setReviewQueueItems(projectReviewQueue(result.body.data));
      setReviewQueueCompleteness(projectReviewQueueCompleteness(result.body.data));
      setReviewQueueRequestState("success");
    })();

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const reviewedClaimsCount = useMemo(
    () => candidateClaims.filter((claim) => claim.claimReviewStatus === "reviewed").length,
    [candidateClaims],
  );

  const gapsAndRisks = useMemo(() => projectOrganizationGapsAndRisks(reviewQueueItems), [reviewQueueItems]);
  const recommendationsCount = gapsAndRisks.gapItems.length + gapsAndRisks.coverageFindings.length;

  const reviewQueueComplete = reviewQueueRequestState === "success" && reviewQueueIsComplete(reviewQueueCompleteness);
  const attentionCount = reviewQueueComplete ? reviewQueueItems.length : null;

  const attentionPreview = useMemo(
    () =>
      reviewQueueItems.slice(0, 3).map((item) => ({
        ...reviewQueueItemLabel(item),
        actionability: item.blockerCodes?.[0] ? reviewQueueBlockerActionability(item.blockerCodes[0], item) : null,
      })),
    [reviewQueueItems],
  );

  const nextAction = attentionPreview.find((item) => item.actionability === "ACTION_REQUIRED") || attentionPreview[0] || null;

  const isFirstTime = claimsLoaded && candidateClaims.length === 0 && reviewQueueComplete && reviewQueueItems.length === 0;

  if (!organizationId) {
    return <div style={{ color: COLORS.textMuted, fontSize: 14 }}>Select an organization to see its Impact Home.</div>;
  }

  if (isFirstTime) {
    return (
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: COLORS.ink, margin: "0 0 8px" }}>
          Welcome to your Impact workspace
        </h1>
        <p style={{ fontSize: 15, color: COLORS.textSecondary, margin: "0 0 32px", maxWidth: 640, lineHeight: 1.5 }}>
          Add your organization&rsquo;s information and KAI will help you understand your impact, find opportunities
          and guide your next steps.
        </p>
        <button
          type="button"
          onClick={onGoToKnowledgeStudio}
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
          }}
        >
          Add information
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: COLORS.ink, margin: "0 0 4px" }}>Your organization&rsquo;s impact picture</h1>
      <p style={{ fontSize: 14.5, color: COLORS.textSecondary, margin: "0 0 24px" }}>
        A summary of what KAI currently knows and what needs your attention.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16, marginBottom: 28 }}>
        <StatTile n={claimsLoaded ? reviewedClaimsCount : "…"} label="Impact Facts (reviewed)" />
        <StatTile n={reviewQueueComplete ? recommendationsCount : "…"} label="Recommendations" />
        <StatTile n={attentionCount === null ? "…" : attentionCount} label="Needs your attention" alert={Boolean(attentionCount)} />
      </div>

      {nextAction ? (
        <div
          style={{
            background: "#FFF6F5",
            border: "1px solid rgba(255,86,86,0.18)",
            borderRadius: 10,
            padding: 22,
            marginBottom: 24,
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 600, color: COLORS.coral, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.03em" }}>
            Next action
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.ink, marginBottom: 6 }}>{nextAction.claimLabel}</div>
          <div style={{ fontSize: 13.5, color: COLORS.textSecondary, maxWidth: 480, lineHeight: 1.5, marginBottom: 16 }}>
            {nextAction.blockerText}
          </div>
          <button
            type="button"
            onClick={onGoToKnowledgeStudio}
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
            }}
          >
            Review in Knowledge Studio
          </button>
        </div>
      ) : null}

      <div style={{ background: "#FFFFFF", border: "1px solid rgba(69,90,124,0.10)", borderRadius: 10, padding: 22 }}>
        <div style={{ fontWeight: 600, fontSize: 15, color: COLORS.ink, marginBottom: 14 }}>Needs your attention</div>
        {!reviewQueueComplete ? (
          <div style={{ fontSize: 13, color: COLORS.textMuted }}>
            {reviewQueueRequestState === "error" ? "Could not load current attention items." : "Loading…"}
          </div>
        ) : attentionPreview.length === 0 ? (
          <div style={{ fontSize: 13, color: COLORS.textMuted }}>Nothing currently needs attention for this organization.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            {attentionPreview.map((item, index) => (
              <div key={index} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: COLORS.coral, marginTop: 7, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 13.5, color: COLORS.ink, fontWeight: 500, lineHeight: 1.4 }}>{item.claimLabel}</div>
                  <div style={{ fontSize: 12.5, color: COLORS.textMuted, marginTop: 2 }}>{item.blockerText}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
