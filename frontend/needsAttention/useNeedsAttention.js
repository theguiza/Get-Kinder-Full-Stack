import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getJson,
  impactHomeSummaryPath,
  projectImpactHomeSummary,
  organizationReviewQueuePath,
  projectReviewQueue,
  projectReviewQueueCompleteness,
  reviewQueueIsComplete,
  reviewQueueIsConclusivelyEmpty,
  reviewQueueBlockerActionability,
  blockerDisplayText,
  sensitivityCapabilitiesPath,
  sensitivityReviewQueuePath,
  projectSensitivityReviewQueueItems,
  sensitivityReviewQueueAttention,
} from "../impactEvidenceLibraryLogic.js";

/**
 * Needs Attention (Package H), MVP domains only, per owner authorization:
 * (1) claim/Impact Fact review, (2) evidence review, (3) source
 * sensitivity/allowed-use review, (4) client questions/follow-ups. All four
 * are already produced by the existing, already-governed Review Queue
 * rollup (organizationReviewQueuePath) and the existing Phase-5 sensitivity
 * rollup (sensitivityCapabilitiesPath/sensitivityReviewQueuePath) - the same
 * reads Knowledge Studio's Reviews tab already uses. No second review
 * truth, no new backend, no new persistence: this hook only re-fetches and
 * re-shapes the same authoritative state for the cross-product inbox
 * (accessed via the header bell) instead of Knowledge Studio's contextual
 * view.
 *
 * Domain 5 (intake/file problems requiring action) is intentionally NOT
 * included: no existing organization-wide read of "files/batches needing
 * action" was found in this repository. Rather than fabricate one, it is
 * omitted here and recorded as a smallest-missing-capability follow-up.
 *
 * Client organization members: the Review Queue rollup is GK-internal, so it
 * is requested only when the client-safe Impact Home summary reports
 * internalReviewAvailable for this actor. Otherwise domains 1-2 are not
 * applicable and domain 4 comes only from the summary's clientActions
 * (completable client follow-ups, present only for a client_reviewer).
 *
 * Excluded per owner instruction: ordinary successful processing status,
 * background system activity, GK-admin-only export/release review, and any
 * generic notification unrelated to a required human action.
 */
export function useNeedsAttention(organizationId) {
  const [reviewQueueItems, setReviewQueueItems] = useState([]);
  const [reviewQueueCompleteness, setReviewQueueCompleteness] = useState({ truncated: false, evaluationErrorCount: 0 });
  const [reviewQueueRequestState, setReviewQueueRequestState] = useState("idle");
  const [summary, setSummary] = useState(null);

  // The review-cockpit capabilities answer, keyed to the organization it was
  // read for: after an organization change the previous organization's answer
  // is never reported, not even for the render before the effect below runs.
  const [sensitivityCapabilityState, setSensitivityCapabilityState] = useState({
    organizationId: "",
    requestState: "idle",
    capability: null,
  });
  const capabilityIsCurrent = Boolean(organizationId) && sensitivityCapabilityState.organizationId === organizationId;
  const sensitivityCapability = capabilityIsCurrent ? sensitivityCapabilityState.capability : null;
  const sensitivityCapabilityRequestState = capabilityIsCurrent ? sensitivityCapabilityState.requestState : "idle";
  const [sensitivityReviewQueueItems, setSensitivityReviewQueueItems] = useState([]);
  const [loadingSensitivityReviewQueue, setLoadingSensitivityReviewQueue] = useState(false);
  const [sensitivityReviewQueueError, setSensitivityReviewQueueError] = useState("");
  const organizationIdRef = useRef(organizationId);
  organizationIdRef.current = organizationId;

  useEffect(() => {
    setReviewQueueItems([]);
    setReviewQueueCompleteness({ truncated: false, evaluationErrorCount: 0 });
    setReviewQueueRequestState("idle");
    setSummary(null);
    setSensitivityCapabilityState({ organizationId, requestState: organizationId ? "loading" : "idle", capability: null });
    setSensitivityReviewQueueItems([]);
    setSensitivityReviewQueueError("");
    if (!organizationId) return undefined;

    let cancelled = false;

    (async () => {
      setReviewQueueRequestState("loading");
      const summaryResult = await getJson(impactHomeSummaryPath(organizationId));
      if (cancelled) return;
      const projectedSummary =
        summaryResult.statusCode === 200 && summaryResult.body?.ok ? projectImpactHomeSummary(summaryResult.body.data) : null;
      if (!projectedSummary) {
        setReviewQueueRequestState("error");
        return;
      }
      setSummary(projectedSummary);
      if (!projectedSummary.internalReviewAvailable) {
        // Client-safe path: the summary is complete; no Review Queue call.
        setReviewQueueRequestState("success");
        return;
      }
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

    (async () => {
      const result = await getJson(sensitivityCapabilitiesPath(organizationId));
      if (cancelled) return;
      if (result.statusCode !== 200 || !result.body?.ok) {
        setSensitivityCapabilityState({ organizationId, requestState: "error", capability: false });
        return;
      }
      const capability = result.body.data?.can_manage_sensitivity_review === true;
      setSensitivityCapabilityState({ organizationId, requestState: "success", capability });
      if (!capability) return;
      setLoadingSensitivityReviewQueue(true);
      const queueResult = await getJson(sensitivityReviewQueuePath(organizationId));
      if (cancelled) return;
      setLoadingSensitivityReviewQueue(false);
      if (queueResult.statusCode !== 200 || !queueResult.body?.ok) {
        setSensitivityReviewQueueItems([]);
        setSensitivityReviewQueueError(queueResult.body?.error?.message || "Could not load sensitivity review.");
        return;
      }
      setSensitivityReviewQueueItems(projectSensitivityReviewQueueItems(queueResult.body.data));
    })();

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  // Re-reads the review-cockpit capabilities answer in place (no loading
  // state, so an unchanged answer changes nothing on screen) when the page
  // revalidates, e.g. on return after another session changed this actor's
  // roles. A failed read keeps the current answer; the server still decides
  // every request. A late answer for another organization is discarded.
  const revalidate = useCallback(async () => {
    const requestedOrganizationId = organizationId;
    if (!requestedOrganizationId) return;
    const result = await getJson(sensitivityCapabilitiesPath(requestedOrganizationId));
    if (organizationIdRef.current !== requestedOrganizationId) return;
    if (result.statusCode !== 200 || !result.body?.ok) return;
    const capability = result.body.data?.can_manage_sensitivity_review === true;
    setSensitivityCapabilityState((current) => (
      current.organizationId === requestedOrganizationId && current.requestState === "success" && current.capability === capability
        ? current
        : { organizationId: requestedOrganizationId, requestState: "success", capability }
    ));
    if (!capability) {
      setSensitivityReviewQueueItems([]);
      setSensitivityReviewQueueError("");
      return;
    }
    const queueResult = await getJson(sensitivityReviewQueuePath(requestedOrganizationId));
    if (organizationIdRef.current !== requestedOrganizationId) return;
    if (queueResult.statusCode === 200 && queueResult.body?.ok) {
      setSensitivityReviewQueueItems(projectSensitivityReviewQueueItems(queueResult.body.data));
      setSensitivityReviewQueueError("");
    }
  }, [organizationId]);

  const sensitivityAttention = useMemo(
    () =>
      sensitivityReviewQueueAttention({
        sensitivityCapability,
        loadingSensitivityReviewQueue,
        sensitivityReviewQueueError,
        sensitivityReviewQueueItems,
      }),
    [sensitivityCapability, loadingSensitivityReviewQueue, sensitivityReviewQueueError, sensitivityReviewQueueItems],
  );

  const reviewQueueComplete = reviewQueueRequestState === "success" && reviewQueueIsComplete(reviewQueueCompleteness);

  const clientActions = summary && !summary.internalReviewAvailable ? summary.clientActions : [];

  const conclusivelyEmpty = reviewQueueIsConclusivelyEmpty({
    reviewQueueRequestState,
    reviewQueueCompleteness,
    reviewQueueItemsLength: reviewQueueItems.length + clientActions.length,
    sensitivityCapabilityRequestState,
    sensitivityCapability,
    sensitivityAttentionStatus: sensitivityAttention.status,
    sensitivityAttentionItemsLength: sensitivityAttention.items.length,
  });

  // Claim review / evidence review / client follow-up items (domains 1, 2, 4)
  // are all present in reviewQueueItems already - split by blocker code.
  const claimReviewItems = [];
  const evidenceReviewItems = [];
  const followupItems = [];
  for (const item of reviewQueueItems) {
    for (const blockerCode of item.blockerCodes || []) {
      const actionability = reviewQueueBlockerActionability(blockerCode, item);
      const entry = { item, blockerCode, actionability, text: blockerDisplayText(blockerCode, item.requestedAudience) };
      if (blockerCode === "claim_review_unresolved") claimReviewItems.push(entry);
      else if (blockerCode === "evidence_review_unresolved") evidenceReviewItems.push(entry);
      else if (blockerCode === "client_followup_unresolved") followupItems.push(entry);
    }
  }
  for (const action of clientActions) {
    followupItems.push({
      item: {},
      blockerCode: "client_followup_unresolved",
      actionability: "ACTION_REQUIRED",
      title: "Client follow-up",
      text: action.questionText,
    });
  }

  // Resolved only once every rollup this hook depends on has conclusively
  // succeeded - never a positive or fabricated signal from partial/unknown
  // state (matches this codebase's existing "never show 0 while unknown"
  // convention, applied here to the bell's dot in both directions).
  const resolved = reviewQueueComplete && sensitivityAttention.status !== "loading" && sensitivityAttention.status !== "error";
  const totalCount = reviewQueueItems.length + clientActions.length + sensitivityAttention.items.length;
  const hasAttention = resolved && totalCount > 0;

  return {
    resolved,
    conclusivelyEmpty,
    hasAttention,
    totalCount: resolved ? totalCount : null,
    claimReviewItems,
    evidenceReviewItems,
    followupItems,
    sensitivityItems: sensitivityAttention.items,
    sensitivityStatus: sensitivityAttention.status,
    // The review-cockpit capabilities answer itself: "allowed" /
    // "not_allowed", or "unknown" while loading or after a failed read.
    sensitivityReviewAccess: sensitivityCapabilityRequestState === "success"
      ? (sensitivityCapability === true ? "allowed" : "not_allowed")
      : "unknown",
    // The organization that answer belongs to ("" while none is current).
    sensitivityReviewAccessOrganizationId: sensitivityCapabilityRequestState === "success" ? organizationId : "",
    reviewQueueRequestState,
    revalidate,
  };
}
