import React, { useState } from "react";

import {
  FINDING_CATEGORY_DESCRIPTIONS,
  FINDING_CATEGORY_LABELS,
  IMPACT_SECTION_LIMIT,
  KNOWLEDGE_STUDIO_VIEWS,
  shortStatement,
} from "./knowledgeStudioViewsLogic.js";

/**
 * Shared presentation for the four-view Knowledge Studio (client and Get
 * Kinder). Display only: no reads, no writes, no authorization decisions.
 */

export function KnowledgeStudioNav({ view, onSelect, badges = {} }) {
  return (
    <ul className="nav nav-tabs mb-3" role="tablist" data-knowledge-studio-nav="">
      {KNOWLEDGE_STUDIO_VIEWS.map(([key, label]) => (
        <li className="nav-item" key={key} role="presentation">
          <button
            type="button"
            role="tab"
            aria-selected={view === key}
            className={`nav-link${view === key ? " active" : ""}`}
            data-knowledge-studio-tab={key}
            onClick={() => onSelect(key)}
          >
            {label}
            {badges[key] ? <span className="badge rounded-pill text-bg-primary ms-1">{badges[key]}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

// A view mounted once opened and kept mounted while hidden, so open panels,
// forms and in-progress feedback survive switching views.
export function ViewPane({ name, active, mounted, children }) {
  if (!mounted) return null;
  return (
    <div hidden={!active} data-knowledge-studio-view={name} data-knowledge-studio-view-active={active ? "true" : "false"}>
      {children}
    </div>
  );
}

export function ProjectHeading({ projectName, engagementId, subtitle }) {
  return (
    <div className="mb-3" data-knowledge-studio-project={engagementId || ""}>
      <div className="text-muted small text-uppercase">Knowledge Studio</div>
      <h1 className="admin-title mb-0">{engagementId ? (projectName || "Selected Project") : "No Project selected"}</h1>
      {subtitle ? <div className="small text-muted mt-1">{subtitle}</div> : null}
    </div>
  );
}

export function StatementText({ text, max = 220, className = "" }) {
  const [expanded, setExpanded] = useState(false);
  const short = shortStatement(text, max);
  if (!short.text) return <div className={`text-muted ${className}`}>Statement not available</div>;
  return (
    <div className={`text-break ${className}`}>
      {expanded || !short.shortened ? String(text).trim() : short.text}
      {short.shortened ? (
        <button type="button" className="btn btn-link btn-sm p-0 ms-1 align-baseline" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Show less" : "Show full statement"}
        </button>
      ) : null}
    </div>
  );
}

export function FindingMeta({ finding }) {
  return (
    <div className="d-flex flex-wrap gap-2 mt-1 small">
      <span className="badge text-bg-light border" data-finding-type={finding.evidenceType || ""}>{finding.typeLabel}</span>
      {finding.sourceFileName ? <span className="text-muted">Source: {finding.sourceFileName}</span> : null}
      {finding.sourceIsCurrent === false ? <span className="badge text-bg-warning">From an earlier source version</span> : null}
    </div>
  );
}

function ImpactFindingCard({ finding, status, onOpen }) {
  return (
    <li className="list-group-item" data-impact-finding={finding.evidenceItemId} data-impact-finding-category={finding.category}>
      <StatementText text={finding.statement} max={240} className="fw-semibold small" />
      <FindingMeta finding={finding} />
      {status ? <div className="small mt-1" data-impact-finding-status="">{status}</div> : null}
      {onOpen ? (
        <button type="button" className="btn btn-link btn-sm p-0 mt-1" data-impact-open-finding={finding.evidenceItemId} onClick={() => onOpen(finding)}>
          Evidence, definition and limitations
        </button>
      ) : null}
    </li>
  );
}

function ImpactSection({ category, title, entries, state, statusFor, onOpenFinding, onSeeAll, emptyText, description }) {
  const shown = entries.slice(0, IMPACT_SECTION_LIMIT);
  return (
    <div className="admin-card mb-3" data-impact-section={category}>
      <h5 className="mb-1">{title}</h5>
      <div className="small text-muted mb-2">{description || FINDING_CATEGORY_DESCRIPTIONS[category]}</div>
      {entries.length === 0 ? (
        <div className="small text-muted" data-impact-section-empty="">
          {state.complete ? emptyText : `${emptyText.replace(/\.$/, "")} in the evidence loaded so far.`}
        </div>
      ) : (
        <ul className="list-group">
          {shown.map((finding) => (
            <ImpactFindingCard key={finding.key} finding={finding} status={statusFor?.(finding)} onOpen={onOpenFinding} />
          ))}
        </ul>
      )}
      {entries.length > shown.length && onSeeAll ? (
        <button type="button" className="btn btn-sm btn-outline-secondary mt-2" onClick={onSeeAll}>
          See all {entries.length} loaded in Evidence
        </button>
      ) : null}
    </div>
  );
}

/**
 * What this Project tells us about our impact. `state` is
 * projectFindingsState(); `grouped` is buildFindings(). `attention` is a list
 * of { key, text, actionLabel?, onAction? } built by the owner from its own
 * reads. `intro` names where the results come from.
 */
export function ImpactView({
  projectName, engagementId, state, grouped, attention = [], statusFor, onOpenFinding, onOpenEvidence,
  onLoadMore, loadingMore = false, intro, children,
}) {
  return (
    <div data-knowledge-studio-impact="" data-knowledge-studio-impact-project={engagementId || ""} title={projectName || undefined}>
      <h2 className="h5 mb-2">What this Project tells us about our impact</h2>
      {intro ? <div className="small text-muted mb-3">{intro}</div> : null}
      {state.kind === "no_project" ? (
        <div className="admin-card" data-impact-state="no_project">
          Select a Project above to see what its evidence shows.
        </div>
      ) : null}
      {state.kind === "loading" ? <div className="admin-card text-muted small" data-impact-state="loading">Loading this Project&rsquo;s evidence...</div> : null}
      {state.kind === "error" ? (
        <div className="alert alert-warning small" data-impact-state="error">
          This Project&rsquo;s evidence could not be loaded, so nothing can be summarized right now. This does not mean the Project has no evidence. {state.message}
        </div>
      ) : null}
      {state.kind === "empty" ? (
        <div className="admin-card small" data-impact-state="empty">
          No findings or measurements are recorded for this Project yet. Add files in Sources and use them for impact to see results here.
        </div>
      ) : null}
      {state.kind === "incomplete_empty" ? (
        <div className="admin-card small" data-impact-state="incomplete_empty">
          No findings were found in the part of this Project&rsquo;s evidence loaded so far; more evidence exists.
          {onLoadMore ? (
            <button type="button" className="btn btn-sm btn-outline-secondary ms-2" disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? "Loading..." : "Load more evidence"}
            </button>
          ) : null}
        </div>
      ) : null}
      {state.kind === "ready" ? (
        <>
          {!state.complete ? (
            <div className="alert alert-secondary py-2 small" data-impact-state="incomplete">
              This summary covers the evidence loaded so far. This Project has more, so the sections below may be missing results.
              {onLoadMore ? (
                <button type="button" className="btn btn-sm btn-outline-secondary ms-2" disabled={loadingMore} onClick={onLoadMore}>
                  {loadingMore ? "Loading..." : "Load more evidence"}
                </button>
              ) : null}
            </div>
          ) : null}
          <ImpactSection category="outcomes" title="1. Outcomes and change" entries={grouped.outcomes} state={state}
            statusFor={statusFor} onOpenFinding={onOpenFinding} onSeeAll={onOpenEvidence}
            emptyText="No baseline and follow-up outcome measurement is recorded for this Project." />
          <ImpactSection category="reach" title="2. Reach and service delivery" entries={grouped.reach} state={state}
            statusFor={statusFor} onOpenFinding={onOpenFinding} onSeeAll={onOpenEvidence}
            emptyText="No linked reach measurement is recorded for this Project." />
          <ImpactSection category="other" title="3. Other findings" entries={[...grouped.measurements, ...grouped.findings]} state={state}
            statusFor={statusFor} onOpenFinding={onOpenFinding} onSeeAll={onOpenEvidence}
            description="Other measurements from your sources, each counting what its own definition says (not necessarily people), and statements found in your documents."
            emptyText="No other findings are recorded for this Project." />
        </>
      ) : null}
      {state.kind !== "no_project" ? <AttentionList items={attention} /> : null}
      {children}
    </div>
  );
}

export function AttentionList({ items }) {
  return (
    <div className="admin-card mb-3" data-impact-attention="">
      <h5 className="mb-2">4. What needs attention</h5>
      {items.length === 0 ? <div className="small text-muted">Nothing needs attention in what is loaded.</div> : (
        <ul className="list-unstyled small mb-0">
          {items.map((item) => (
            <li key={item.key} className="mb-2" data-impact-attention-item={item.key}>
              <div>{item.text}</div>
              {item.onAction ? (
                <button type="button" className="btn btn-sm btn-outline-primary mt-1" onClick={item.onAction}>{item.actionLabel}</button>
              ) : null}
              {item.href ? <a className="btn btn-sm btn-outline-primary mt-1" href={item.href}>{item.actionLabel}</a> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CategoryHeading({ category, count, complete }) {
  return (
    <div className="d-flex justify-content-between align-items-baseline mt-3 mb-1" data-evidence-category={category}>
      <h6 className="mb-0">{FINDING_CATEGORY_LABELS[category]}</h6>
      <span className="small text-muted">{count} {complete ? "" : "loaded"}</span>
    </div>
  );
}
