import React, { useCallback, useEffect, useRef, useState } from "react";
import { organizationsPath } from "./kaiWebIntakeLogic.js";

/**
 * KAI P1-09 internal review cockpit (GK-internal only).
 *
 * This component is not a client-facing surface: it renders nothing at all unless
 * the internal, GK-authenticated KAI Sprint 2 API answers its status probe, which
 * is itself gated by KAI_SPRINT2_ENABLED and by the mount-level authentication
 * stack. It performs no direct database access, holds no credential, and renders
 * only the allowlisted fields the internal API returns.
 *
 * Source-decision controls are rendered only when the source-candidate detail
 * response reports `decision_controls_enabled: true`, which mirrors
 * KAI_SPRINT2_ENABLED. When that flag is off, the controls are not rendered at
 * all - the read-only review detail remains fully available.
 */

const BASE_PATH = "/api/kai/sprint2/intake";
const COCKPIT_PATH = `${BASE_PATH}/admin/review-cockpit`;

const QUEUE_TYPE_OPTIONS = [
  { value: "", label: "All queues" },
  { value: "intake_file_review", label: "Intake file review" },
  { value: "sensitivity_review", label: "Sensitivity review" },
  { value: "source_candidate_review", label: "Source candidate review" },
];

const QUEUE_STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "waiting_on_client", label: "Waiting on client" },
  { value: "waiting_on_gk", label: "Waiting on GK" },
  { value: "resolved", label: "Resolved" },
  { value: "cancelled", label: "Cancelled" },
];

const DECISION_OUTCOME_OPTIONS = [
  { value: "needs_more_information", label: "Needs more information" },
  { value: "rejected", label: "Reject" },
  { value: "promoted", label: "Promote" },
];

const ORGANIZATION_BOOTSTRAP_ERROR = "Unable to load authorized KAI organizations.";
const UNSUPPORTED_DETAIL_TARGET_MESSAGE = "This review queue target is not supported by the cockpit.";

function detailRouteForQueueItem(item) {
  if (
    item?.queue_type === "source_candidate_review"
    && item?.target_object_type === "intake_source_candidate"
  ) {
    return {
      path: `${COCKPIT_PATH}/source-candidates/${item.target_object_id}`,
      kind: "source_candidate",
    };
  }
  if (
    item?.queue_type === "sensitivity_review"
    && item?.target_object_type === "intake_sensitivity_profile"
  ) {
    return {
      path: `${COCKPIT_PATH}/sensitivity-profiles/${item.target_object_id}`,
      kind: "file_profile",
    };
  }
  return null;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function getJson(path) {
  const response = await fetch(path, {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  return { statusCode: response.status, body: await readJson(response) };
}

async function postJson(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { statusCode: response.status, body: await readJson(response) };
}

function errorText(result) {
  return result?.body?.error?.message || `Request failed (${result?.statusCode ?? "unknown"}).`;
}

function FieldRow({ label, value }) {
  return (
    <div className="kai-cockpit-field">
      <span className="kai-cockpit-field-label">{label}</span>
      <span className="kai-cockpit-field-value">{String(value)}</span>
    </div>
  );
}

function FileProfileDetail({ detail }) {
  if (!detail) return null;
  const restrictions = detail.allowed_use_restrictions;
  const posture = detail.sensitivity_posture;
  return (
    <section className="kai-cockpit-detail">
      <h3>File profile (read-only)</h3>
      <FieldRow label="File profile" value={detail.file_profile.file_profile_id} />
      <FieldRow label="Intake file" value={detail.file_profile.intake_file_id} />
      <FieldRow label="Parser" value={`${detail.file_profile.parser_name} ${detail.file_profile.parser_version}`} />
      <FieldRow label="Profile checksum" value={detail.file_profile.profile_canonical_sha256} />

      <h4>Dictionary summary</h4>
      {detail.data_dictionary ? (
        <>
          <FieldRow label="Dictionary" value={detail.data_dictionary.data_dictionary_id} />
          <FieldRow label="Status" value={detail.data_dictionary.dictionary_status} />
          <FieldRow label="Fields" value={detail.data_dictionary.field_count} />
        </>
      ) : (
        <p>No data dictionary recorded for this profile.</p>
      )}

      <h4>Quality findings</h4>
      {detail.quality_findings.length === 0 ? (
        <p>No quality findings recorded.</p>
      ) : (
        <ul>
          {detail.quality_findings.map((finding) => (
            <li key={finding.data_quality_finding_id}>
              <strong>{finding.finding_type}</strong> ({finding.finding_status}) &mdash;{" "}
              {finding.profile_field_key}: {finding.finding_detail_safe}
            </li>
          ))}
        </ul>
      )}

      <h4>Sensitivity posture</h4>
      {posture ? (
        <>
          <FieldRow label="PII" value={posture.pii_status} />
          <FieldRow label="Minor data" value={posture.minor_data_status} />
          <FieldRow label="Health / housing / justice / immigration" value={posture.health_housing_justice_immigration_status} />
          <FieldRow label="Indigenous governance" value={posture.indigenous_governance_status} />
          <FieldRow label="Staff notes" value={posture.staff_notes_status} />
          <FieldRow label="Story / testimonial" value={posture.story_testimonial_status} />
          <FieldRow label="Small cell risk" value={posture.small_cell_risk_status} />
          <FieldRow label="Financial records" value={posture.financial_records_status} />
          <FieldRow label="Consent basis" value={posture.consent_basis_status} />
          <FieldRow label="Allowed use" value={posture.allowed_use_status} />
        </>
      ) : (
        <p>No sensitivity profile recorded for this file profile.</p>
      )}

      <h4>Allowed-use restrictions</h4>
      {restrictions ? (
        <>
          <FieldRow label="Human review required" value={restrictions.human_review_required} />
          <FieldRow label="LLM processing allowed" value={restrictions.llm_processing_allowed} />
          <FieldRow label="Product learning allowed" value={restrictions.product_learning_allowed} />
          <FieldRow label="Public use allowed" value={restrictions.public_use_allowed} />
          <FieldRow label="Funder use allowed" value={restrictions.funder_use_allowed} />
          <FieldRow label="Retention posture" value={restrictions.retention_posture} />
        </>
      ) : (
        <p>No allowed-use restrictions recorded for this file profile.</p>
      )}
    </section>
  );
}

function decisionSubmitLabel(outcome) {
  if (outcome === "promoted") return "Promote";
  if (outcome === "rejected") return "Reject";
  return "Record decision";
}

function SourceDecisionControls({ detail, onSubmit, busy }) {
  const [outcome, setOutcome] = useState("needs_more_information");
  const [reviewedSourceType, setReviewedSourceType] = useState("");

  // KAI_SPRINT2_ENABLED is off: the decision controls are not rendered at all,
  // not merely made non-functional.
  if (!detail?.decision_controls_enabled) {
    return <p className="kai-cockpit-note">Source-decision controls are disabled.</p>;
  }

  const allowedTypes = Array.isArray(detail.allowed_reviewed_source_types)
    ? detail.allowed_reviewed_source_types
    : [];
  const promotionSelected = outcome === "promoted";

  return (
    <form
      className="kai-cockpit-decision"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(promotionSelected ? { outcome, reviewed_source_type: reviewedSourceType } : { outcome });
      }}
    >
      <label>
        Decision outcome
        <select value={outcome} onChange={(event) => setOutcome(event.target.value)}>
          {DECISION_OUTCOME_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      {promotionSelected ? (
        <label>
          Reviewed source type
          <select
            value={reviewedSourceType}
            onChange={(event) => setReviewedSourceType(event.target.value)}
          >
            <option value="">Select a reviewed source type</option>
            {allowedTypes.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
      ) : null}
      <button type="submit" disabled={busy || (promotionSelected && !reviewedSourceType)}>
        {decisionSubmitLabel(outcome)}
      </button>
    </form>
  );
}

function SourceCandidateDetail({ detail, onSubmitDecision, busy, decisionResult }) {
  if (!detail) return null;
  const candidate = detail.source_candidate;
  const decision = detail.promotion_decision;
  return (
    <section className="kai-cockpit-detail">
      <h3>Source candidate</h3>
      <FieldRow label="Candidate" value={candidate.intake_source_candidate_id} />
      <FieldRow label="Intake file" value={candidate.intake_file_id} />
      <FieldRow label="File profile" value={candidate.file_profile_id} />
      <FieldRow label="Data dictionary" value={candidate.data_dictionary_id} />
      <FieldRow label="Sensitivity profile" value={candidate.intake_sensitivity_profile_id} />
      <FieldRow label="Profile checksum" value={candidate.profile_canonical_sha256} />
      <FieldRow label="Candidate status" value={candidate.candidate_status} />

      <h4>Queue state</h4>
      {detail.review_queue_item ? (
        <>
          <FieldRow label="Queue status" value={detail.review_queue_item.queue_status} />
          <FieldRow label="Review status" value={detail.review_queue_item.review_status ?? "none"} />
        </>
      ) : (
        <p>No review-queue item recorded for this candidate.</p>
      )}

      <h4>Decision state</h4>
      {decision ? (
        <>
          <FieldRow label="Decision status" value={decision.decision_status} />
          <FieldRow label="Reviewed source type" value={decision.reviewed_source_type ?? "none"} />
        </>
      ) : (
        <p>No decision recorded for this candidate.</p>
      )}

      <h4>Promotion result</h4>
      {detail.source ? (
        <>
          <FieldRow label="Source" value={detail.source.source_id} />
          <FieldRow label="Source code" value={detail.source.source_code} />
          <FieldRow label="Reviewed source type" value={detail.source.reviewed_source_type} />
        </>
      ) : (
        <p>No source created for this candidate.</p>
      )}
      {detail.source_version ? (
        <>
          <FieldRow label="Source version" value={detail.source_version.source_version_id} />
          <FieldRow label="Is current" value={detail.source_version.is_current} />
        </>
      ) : (
        <p>No source version created for this candidate.</p>
      )}

      <h4>Source decision</h4>
      <SourceDecisionControls detail={detail} onSubmit={onSubmitDecision} busy={busy} />
      {decisionResult ? <p className="kai-cockpit-note">{decisionResult}</p> : null}
    </section>
  );
}

export default function KaiReviewCockpit(props = {}) {
  const parentOrganizationId =
    typeof props.organizationId === "string" ? props.organizationId : "";
  const [featureEnabled, setFeatureEnabled] = useState(null);
  const [organizations, setOrganizations] = useState([]);
  const [localOrganization, setLocalOrganization] = useState("");
  const organization = parentOrganizationId || localOrganization;
  const activeOrganizationRef = useRef("");
  const [loadingOrganizations, setLoadingOrganizations] = useState(true);
  const [organizationsLoaded, setOrganizationsLoaded] = useState(false);
  const [organizationBootstrapError, setOrganizationBootstrapError] = useState("");
  const [queueType, setQueueType] = useState("");
  const [queueStatus, setQueueStatus] = useState("");
  const [queue, setQueue] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailKind, setDetailKind] = useState(null);
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [message, setMessage] = useState("");
  const [decisionResult, setDecisionResult] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // KAI_SPRINT2_ENABLED gate for the UI entry point: the internal status route is
    // itself feature-gated, so a non-ok answer means this cockpit must not render.
    getJson(`${BASE_PATH}/status`).then((result) => {
      if (cancelled) return;
      setFeatureEnabled(Boolean(result.statusCode === 200 && result.body?.ok));
    }).catch(() => {
      if (!cancelled) setFeatureEnabled(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    activeOrganizationRef.current = organization;
    setQueue(null);
    setDetail(null);
    setDetailKind(null);
    setSelectedItemId(null);
    setDecisionResult("");
    setBusy(false);
    setMessage("");
  }, [organization]);

  function clearTenantScopedState() {
    setQueue(null);
    setDetail(null);
    setDetailKind(null);
    setSelectedItemId(null);
    setDecisionResult("");
  }

  useEffect(() => {
    if (parentOrganizationId) {
      setOrganizations([]);
      setLocalOrganization("");
      setLoadingOrganizations(false);
      setOrganizationsLoaded(true);
      setOrganizationBootstrapError("");
      return undefined;
    }

    let cancelled = false;
    (async () => {
      setLoadingOrganizations(true);
      setOrganizationBootstrapError("");
      let result;
      try {
        result = await getJson(organizationsPath());
      } catch {
        if (cancelled) return;
        setLoadingOrganizations(false);
        setOrganizationsLoaded(true);
        setOrganizations([]);
        setLocalOrganization("");
        clearTenantScopedState();
        setOrganizationBootstrapError(`${ORGANIZATION_BOOTSTRAP_ERROR} Request failed (network error).`);
        return;
      }
      if (cancelled) return;
      setLoadingOrganizations(false);
      setOrganizationsLoaded(true);
      if (result.statusCode !== 200 || !result.body?.ok) {
        setOrganizations([]);
        setLocalOrganization("");
        clearTenantScopedState();
        setOrganizationBootstrapError(`${ORGANIZATION_BOOTSTRAP_ERROR} ${errorText(result)}`);
        return;
      }

      const items = Array.isArray(result.body.data?.items) ? result.body.data.items : [];
      setOrganizations(items);
      clearTenantScopedState();
      setMessage("");
      setLocalOrganization(items.length === 1 ? items[0].organization_id : "");
    })();
    return () => { cancelled = true; };
  }, [parentOrganizationId]);

  const loadQueue = useCallback(async () => {
    if (!organization) {
      setMessage("Select an authorized KAI organization first.");
      return;
    }
    setBusy(true);
    setMessage("");
    const params = new URLSearchParams({ organization_id: organization });
    if (queueType) params.set("queue_type", queueType);
    if (queueStatus) params.set("queue_status", queueStatus);
    const result = await getJson(`${COCKPIT_PATH}/queue?${params.toString()}`);
    if (activeOrganizationRef.current !== organization) return;
    setBusy(false);
    if (result.statusCode !== 200 || !result.body?.ok) {
      setQueue(null);
      setMessage(errorText(result));
      return;
    }
    setQueue(result.body.data);
  }, [organization, queueType, queueStatus]);

  const openDetail = useCallback(async (item) => {
    if (!organization) return;
    setDecisionResult("");
    setSelectedItemId(item.review_queue_item_id);
    const route = detailRouteForQueueItem(item);
    if (!route) {
      setDetail(null);
      setDetailKind(null);
      setMessage(UNSUPPORTED_DETAIL_TARGET_MESSAGE);
      return;
    }
    setBusy(true);
    const result = await getJson(`${route.path}?organization_id=${encodeURIComponent(organization)}`);
    if (activeOrganizationRef.current !== organization) return;
    setBusy(false);
    if (result.statusCode !== 200 || !result.body?.ok) {
      setDetail(null);
      setDetailKind(null);
      setMessage(errorText(result));
      return;
    }
    setMessage("");
    setDetail(result.body.data);
    setDetailKind(route.kind);
  }, [organization]);

  const submitDecision = useCallback(async (payload) => {
    if (!organization || !detail?.source_candidate) return;
    setBusy(true);
    const candidateId = detail.source_candidate.intake_source_candidate_id;
    const result = await postJson(
      `${COCKPIT_PATH}/source-candidates/${candidateId}/decision?organization_id=${encodeURIComponent(organization)}`,
      payload,
    );
    if (activeOrganizationRef.current !== organization) return;
    setBusy(false);
    if (result.statusCode !== 200 || !result.body?.ok) {
      // A stale/terminal conflict is displayed as its own typed result and is never
      // retried or re-sent with a different outcome from this component.
      setDecisionResult(errorText(result));
      return;
    }
    setDecisionResult(
      `Recorded ${result.body.data.promotion_decision.decision_status}` +
      `${result.body.data.replayed ? " (replayed, no new write)" : ""}.`,
    );
    const refreshed = await getJson(
      `${COCKPIT_PATH}/source-candidates/${candidateId}?organization_id=${encodeURIComponent(organization)}`,
    );
    if (activeOrganizationRef.current !== organization) return;
    if (refreshed.statusCode === 200 && refreshed.body?.ok) setDetail(refreshed.body.data);
  }, [detail, organization]);

  const handleOrganizationChange = useCallback((event) => {
    const nextOrganizationId = event.target.value;
    const authorized = organizations.some((item) => item.organization_id === nextOrganizationId);
    if (!authorized && nextOrganizationId !== "") return;
    setLocalOrganization(nextOrganizationId);
    clearTenantScopedState();
    setMessage("");
  }, [organizations]);

  if (featureEnabled !== true) return null;

  const organizationUnavailable =
    !parentOrganizationId && organizationsLoaded && organizations.length === 0;
  const organizationSelectionRequired =
    !parentOrganizationId && organizations.length > 1 && !organization;
  const queueDisabled =
    busy ||
    loadingOrganizations ||
    Boolean(organizationBootstrapError) ||
    organizationUnavailable ||
    organizationSelectionRequired ||
    !organization;

  return (
    <div className="kai-cockpit">
      <h2>KAI internal review cockpit</h2>
      <div className="kai-cockpit-controls">
        {parentOrganizationId ? null : (
          <label>
            Organization
            {loadingOrganizations ? (
              <span className="kai-cockpit-note">Loading authorized KAI organizations...</span>
            ) : organizationBootstrapError ? (
              <span className="kai-cockpit-note">{organizationBootstrapError}</span>
            ) : organizationUnavailable ? (
              <span className="kai-cockpit-note">No authorized KAI organization is available for this account.</span>
            ) : (
              <select
                value={organization}
                onChange={handleOrganizationChange}
                disabled={organizations.length <= 1}
              >
                {organizations.length > 1 ? <option value="">Select an organization</option> : null}
                {organizations.map((item) => (
                  <option key={item.organization_id} value={item.organization_id}>
                    {item.organization_id}
                  </option>
                ))}
              </select>
            )}
          </label>
        )}
        <label>
          Queue type
          <select value={queueType} onChange={(event) => setQueueType(event.target.value)}>
            {QUEUE_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          Queue status
          <select value={queueStatus} onChange={(event) => setQueueStatus(event.target.value)}>
            {QUEUE_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={loadQueue} disabled={queueDisabled}>Load queue</button>
      </div>

      {message ? <p className="kai-cockpit-note">{message}</p> : null}

      {queue ? (
        <table className="kai-cockpit-queue">
          <thead>
            <tr>
              <th>Queue type</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Summary</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {queue.items.map((item) => (
              <tr key={item.review_queue_item_id} className={item.review_queue_item_id === selectedItemId ? "is-selected" : ""}>
                <td>{item.queue_type}</td>
                <td>{item.queue_status}</td>
                <td>{item.priority}</td>
                <td>{item.summary}</td>
                <td>{item.created_at}</td>
                <td>
                  <button type="button" onClick={() => openDetail(item)} disabled={busy}>Open</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {detailKind === "file_profile" ? <FileProfileDetail detail={detail} /> : null}
      {detailKind === "source_candidate" ? (
        <SourceCandidateDetail
          detail={detail}
          onSubmitDecision={submitDecision}
          busy={busy}
          decisionResult={decisionResult}
        />
      ) : null}
    </div>
  );
}
