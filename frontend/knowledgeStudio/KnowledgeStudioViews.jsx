import React, { useId, useState } from "react";

import {
  FINDING_CATEGORY_DESCRIPTIONS,
  FINDING_CATEGORY_LABELS,
  IMPACT_SECTION_LIMIT,
  KNOWLEDGE_STUDIO_VIEWS,
  findingDisplay,
  shortStatement,
  tabKeyTarget,
} from "./knowledgeStudioViewsLogic.js";

/**
 * Shared presentation for the four-view Knowledge Studio (client and Get
 * Kinder). Display only: no reads, no writes, no authorization decisions.
 */

export const knowledgeStudioTabId = (idPrefix, key) => `${idPrefix}-tab-${key}`;
export const knowledgeStudioPanelId = (idPrefix, key) => `${idPrefix}-panel-${key}`;

/**
 * The four tabs (WAI-ARIA tabs pattern): the selected tab is the one Tab stop;
 * Arrow Left/Right, Home and End move to and open another tab; Enter/Space on
 * a focused tab open it. Each tab names the panel it controls: one panel per
 * view (`singlePanelId` absent, ViewPane), or one shared panel that always
 * shows the selected view (`singlePanelId`, Get Kinder). On a narrow screen
 * the row stays on one line and scrolls instead of wrapping.
 */
export function KnowledgeStudioNav({ view, onSelect, badges = {}, idPrefix = "knowledge-studio", singlePanelId = "" }) {
  const onKeyDown = (event) => {
    const target = tabKeyTarget(event.key, view);
    if (!target) return;
    event.preventDefault();
    onSelect(target);
    globalThis.document?.getElementById(knowledgeStudioTabId(idPrefix, target))?.focus();
  };
  return (
    <ul className="nav nav-tabs mb-3 flex-nowrap knowledge-studio-nav" role="tablist" aria-label="Knowledge Studio views"
      data-knowledge-studio-nav="" style={{ overflowX: "auto", overflowY: "hidden" }} onKeyDown={onKeyDown}>
      {KNOWLEDGE_STUDIO_VIEWS.map(([key, label]) => (
        <li className="nav-item" key={key} role="presentation">
          <button
            type="button"
            role="tab"
            id={knowledgeStudioTabId(idPrefix, key)}
            aria-selected={view === key}
            aria-controls={singlePanelId ? (view === key ? singlePanelId : undefined) : knowledgeStudioPanelId(idPrefix, key)}
            tabIndex={view === key ? 0 : -1}
            className={`nav-link text-nowrap px-2 px-sm-3${view === key ? " active" : ""}`}
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
// forms and in-progress feedback survive switching views. It is the tab panel
// of its tab.
export function ViewPane({ name, active, mounted, children, idPrefix = "knowledge-studio" }) {
  if (!mounted) return null;
  return (
    <div hidden={!active} role="tabpanel" id={knowledgeStudioPanelId(idPrefix, name)} aria-labelledby={knowledgeStudioTabId(idPrefix, name)}
      data-knowledge-studio-view={name} data-knowledge-studio-view-active={active ? "true" : "false"}>
      {children}
    </div>
  );
}

/**
 * Detail on request. The content stays mounted while closed (hidden), so a
 * form, an open panel or an in-progress action inside it survives closing it.
 * `name` is a stable label for the reveal attributes used by the browser
 * acceptance harness; a per-instance suffix keeps each toggle unique.
 */
export function Disclosure({ name, label, openLabel, children, defaultOpen = false, className = "mt-1", buttonClassName = "btn btn-link btn-sm p-0 text-muted", bodyClassName = "" }) {
  const [open, setOpen] = useState(defaultOpen);
  const instance = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const revealKey = `${name}-${instance}`;
  return (
    <div className={className} data-knowledge-studio-disclosure={name}>
      <button type="button" className={buttonClassName} aria-expanded={open} aria-controls={`ks-disclosure-${revealKey}`}
        data-knowledge-studio-reveal-toggle={revealKey} onClick={() => setOpen((value) => !value)}>
        {open ? (openLabel || `Hide ${label.charAt(0).toLowerCase()}${label.slice(1)}`) : label}
      </button>
      <div id={`ks-disclosure-${revealKey}`} hidden={!open} data-knowledge-studio-reveal={revealKey} className={bodyClassName}>
        {children}
      </div>
    </div>
  );
}

/**
 * A recorded statement, readable first: the recorded label or counted value,
 * then the recorded result; the recorded column/worksheet wording and the
 * statement exactly as recorded on request (findingDisplay).
 */
export function FindingText({ statement, max = 240, headlineClassName = "fw-semibold" }) {
  const display = findingDisplay(statement);
  if (!display.full) return <div className="text-muted">Statement not available</div>;
  const reformatted = display.headline || display.neutral || display.location || display.summary !== display.full;
  return (
    <div data-finding-text="">
      {display.headline ? <div className={headlineClassName} data-finding-headline="">{display.headline}</div> : null}
      {display.summary ? (
        <StatementText text={display.summary} max={max} className={display.headline ? "" : headlineClassName} />
      ) : null}
      {display.neutral ? (
        <div className="text-muted" data-finding-neutral="">Recorded measurement. Its full statement names the columns and sources it uses.</div>
      ) : null}
      {display.note ? <div className="text-muted small" data-finding-note="">{display.note}</div> : null}
      {reformatted ? (
        <Disclosure name="recorded-statement" label="Full recorded statement" openLabel="Hide recorded statement">
          <div className="small text-muted border rounded p-2 mt-1 text-break" data-finding-recorded-statement="">
            {display.location ? <div className="mb-1">{display.location}</div> : null}
            <div>{display.full}</div>
          </div>
        </Disclosure>
      ) : null}
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
      <div className="small"><FindingText statement={finding.statement} max={240} /></div>
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
  onLoadMore, loadingMore = false, intro, children, projectEmpty = false, onOpenSources,
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
      {state.kind === "empty" && projectEmpty && onOpenSources ? (
        <div className="admin-card mb-3 border border-primary" data-impact-empty-project="">
          <h3 className="h5">Start building your impact picture</h3>
          <p>Add your existing reports, spreadsheets and other files so KAI can begin organizing your impact evidence.</p>
          <button type="button" className="btn btn-primary" onClick={onOpenSources}>Add files</button>
        </div>
      ) : state.kind === "empty" ? (
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
