import React, { useEffect, useId, useRef, useState } from "react";

import { getJson } from "../impactEvidenceLibraryLogic.js";
import { postJson } from "../kaiWebIntakeLogic.js";
import {
  JOIN_SEARCH_DEBOUNCE_MS,
  JOIN_SEARCH_MAX_LENGTH,
  JOIN_SEARCH_MIN_LENGTH,
  buildOrganizationJoinRequestBody,
  describeJoinSearchError,
  describeJoinSubmissionError,
  joinableOrganizationsSearchPath,
  organizationJoinRequestsPath,
  pendingJoinRequestMessage,
  toJoinSearchResults,
} from "../kaiOrganizationJoinLogic.js";

/**
 * JOIN-4: the one Join Existing Organization search/request component,
 * used both by a zero-organization user's setup screen and by an existing
 * user's "Add or join organization" choice. It searches only once the
 * backend minimum term length is reached (debounced, never browse-all),
 * shows only the backend's organization_id + display_name, and sends only
 * the chosen organization_id. No role, invite, domain, or create-organization
 * fields exist here. Request state (pending/declined) and membership are
 * owned by the caller's authoritative reads, refreshed via onRequestSubmitted.
 */
export default function OrganizationJoinPanel({
  pendingOrganizationIds = [],
  onRequestSubmitted,
  onClose,
  headingLevel = "h2",
}) {
  const inputId = useId();
  const hintId = useId();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [submittingId, setSubmittingId] = useState("");
  const [message, setMessage] = useState({ kind: "", text: "" });
  const latestSearch = useRef(0);

  useEffect(() => {
    const path = joinableOrganizationsSearchPath(term);
    const token = ++latestSearch.current;
    if (!path) {
      setResults([]);
      setSearched(false);
      setSearching(false);
      setSearchError("");
      return undefined;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      const result = await getJson(path);
      if (latestSearch.current !== token) return;
      setSearching(false);
      setSearched(true);
      if (result.statusCode !== 200 || !result.body?.ok) {
        setResults([]);
        setSearchError(describeJoinSearchError(result));
        return;
      }
      setSearchError("");
      setResults(toJoinSearchResults(result.body.data?.items));
    }, JOIN_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const pending = new Set(pendingOrganizationIds);

  async function requestToJoin(organization) {
    if (submittingId) return;
    setSubmittingId(organization.organization_id);
    setMessage({ kind: "", text: "" });
    const result = await postJson(organizationJoinRequestsPath(), buildOrganizationJoinRequestBody(organization.organization_id));
    setSubmittingId("");
    if (result.statusCode !== 200 || !result.body?.ok) {
      setMessage({ kind: "error", text: describeJoinSubmissionError(result) });
      return;
    }
    const name = result.body.data?.join_request?.organization_display_name || organization.display_name;
    setMessage({ kind: "success", text: pendingJoinRequestMessage(name) });
    await onRequestSubmitted?.();
  }

  const Heading = headingLevel;
  const showNoResults = searched && !searching && !searchError && results.length === 0;

  return (
    <section className="gk-organization-join" aria-label="Join an existing organization">
      <div className="gk-organization-join-header">
        <Heading className="gk-organization-join-title">Join an existing organization</Heading>
        {onClose ? (
          <button type="button" className="gk-organization-join-close" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>
      <label className="gk-organization-join-label" htmlFor={inputId}>
        Search organizations
      </label>
      <input
        id={inputId}
        type="search"
        className="gk-organization-join-input"
        value={term}
        maxLength={JOIN_SEARCH_MAX_LENGTH}
        autoComplete="off"
        aria-describedby={hintId}
        onChange={(event) => setTerm(event.target.value)}
      />
      <p id={hintId} className="gk-organization-join-hint">
        Type at least {JOIN_SEARCH_MIN_LENGTH} characters of the organization name.
      </p>
      <div className="gk-organization-join-status" role="status" aria-live="polite">
        {searching ? "Searching..." : null}
        {searchError ? <span className="gk-organization-join-error">{searchError}</span> : null}
        {showNoResults ? "No matching organizations found." : null}
        {message.text ? (
          <span className={message.kind === "error" ? "gk-organization-join-error" : "gk-organization-join-success"}>
            {message.text}
          </span>
        ) : null}
      </div>
      {results.length > 0 ? (
        <ul className="gk-organization-join-results">
          {results.map((organization) => {
            const isPending = pending.has(organization.organization_id);
            return (
              <li key={organization.organization_id} className="gk-organization-join-result">
                <span className="gk-organization-join-result-name">{organization.display_name}</span>
                {isPending ? (
                  <span className="gk-organization-join-result-state">Request pending</span>
                ) : (
                  <button
                    type="button"
                    className="gk-organization-join-request-btn"
                    onClick={() => requestToJoin(organization)}
                    disabled={Boolean(submittingId)}
                    aria-label={`Request to join ${organization.display_name}`}
                  >
                    {submittingId === organization.organization_id ? "Sending..." : "Request to join"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
