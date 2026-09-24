import React, { useState } from "react";

// Approved design tokens (design_handoff_impact_library/README.md §2) - kept
// local to this shell rather than overloaded onto gk-design-tokens.css's
// existing --gk-* tokens, which back unrelated, already-shipped surfaces
// (Events, Org Workspace) with their own established values.
export const IMPACT_SHELL_COLORS = Object.freeze({
  coral: "#FF5656",
  coralHover: "#E84545",
  slate: "#455A7C",
  cream: "#F7F3ED",
  ink: "#2C2E3A",
  textSecondary: "#5B6478",
  textMuted: "#8890A0",
});

export const IMPACT_LIBRARY_NAV_SECTIONS = Object.freeze([
  {
    key: "home",
    label: "Home",
    icon: "M4 11.5 12 4l8 7.5 M6.5 10v9.5h11V10",
  },
  {
    key: "knowledgeStudio",
    label: "Knowledge Studio",
    icon: "M4 5.5c2-1 5.5-1 8 .5V19c-2.5-1.5-6-1.5-8-.5Z M20 5.5c-2-1-5.5-1-8 .5V19c2.5-1.5 6-1.5 8-.5Z",
  },
  {
    key: "impactLibrary",
    label: "Impact Library",
    icon: null, // rendered as a 2x2 grid below, matching the approved design
  },
  {
    key: "improvementPlan",
    label: "Improvement Plan",
    icon: "M6 3.5h9l3 3V20a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 5 20V4a.5.5 0 0 1 .5-.5Z M8.5 10.5h7M8.5 14h5",
  },
  {
    key: "projects",
    label: "Projects",
    icon: "M4 6.5a1 1 0 0 1 1-1h4.5l2 2.2H19a1 1 0 0 1 1 1V17a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z",
  },
]);

function NavIcon({ path, active }) {
  const stroke = active ? "#FFFFFF" : "rgba(255,255,255,0.72)";
  if (!path) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="7" height="7" rx="1.2" />
        <rect x="13" y="4" width="7" height="7" rx="1.2" />
        <rect x="4" y="13" width="7" height="7" rx="1.2" />
        <rect x="13" y="13" width="7" height="7" rx="1.2" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

/**
 * KAI Impact Library redesign, Package C0: the one shared Project/Engagement
 * context control, rendered once above whichever section is active so every
 * view (Home, Knowledge Studio, Impact Library, Improvement Plan) reads the
 * same selection - never a per-view picker that could disagree with it.
 * Purely presentational; `engagements` must already carry a human-readable
 * label (engagement_code) wherever available - this component never falls
 * back to showing a raw UUID unless no label exists at all.
 */
export function ProjectContextBar({
  engagements = [],
  engagementsLoaded = false,
  selectedEngagementId = "",
  onSelectEngagement,
  allowOrganizationWide = false,
}) {
  if (!engagementsLoaded) return null;
  if (engagements.length === 0) return null;
  return (
    <div className="gk-shell-project-bar">
      <label className="gk-shell-project-bar-label" htmlFor="gk-shell-project-select">Project</label>
      <select
        id="gk-shell-project-select"
        className="gk-shell-project-bar-select"
        value={selectedEngagementId}
        onChange={(event) => onSelectEngagement?.(event.target.value)}
      >
        {allowOrganizationWide ? <option value="">All organizational knowledge</option> : null}
        {engagements.map((eng) => (
          <option key={eng.engagement_id} value={eng.engagement_id}>
            {eng.engagement_code || eng.engagement_id}
          </option>
        ))}
      </select>
    </div>
  );
}

function OrgLogo({ logoUrl, name }) {
  if (logoUrl) {
    return <img src={logoUrl} alt="" className="gk-shell-org-logo" />;
  }
  const initial = typeof name === "string" && name.trim() ? name.trim()[0].toUpperCase() : "?";
  return (
    <div className="gk-shell-org-logo gk-shell-org-logo-fallback" aria-hidden="true">
      {initial}
    </div>
  );
}

/**
 * Approved /impact-library product shell (design_handoff_impact_library
 * README §3, "Impact Home.dc.html"): left navigation + header, no Get
 * Kinder branding, no footer. Purely presentational - organization display
 * data, navigation state, and Needs Attention state are all owned by the
 * caller (frontend/ImpactLibraryApp.jsx), which is also responsible for
 * preserving the existing organization-switching capability.
 */
export default function ImpactLibraryShell({
  activeSection,
  onNavigate,
  organizationName,
  organizationLogoUrl,
  organizations = [],
  selectedOrganizationId = "",
  onSelectOrganization,
  organizationActionHref = "/org-apply?source=impact-library",
  organizationActionLabel = "Request organization",
  hasAttention = false,
  onOpenNeedsAttention,
  children,
}) {
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const showOrgSwitcher = Array.isArray(organizations) && organizations.length > 1 && typeof onSelectOrganization === "function";
  const displayName = typeof organizationName === "string" && organizationName.trim() ? organizationName.trim() : "Your organization";

  return (
    <div className="gk-shell-root">
      <aside className="gk-shell-sidebar">
        <div className="gk-shell-nav-group">
          {IMPACT_LIBRARY_NAV_SECTIONS.map((section) => {
            const active = activeSection === section.key;
            return (
              <div
                key={section.key}
                role="button"
                tabIndex={0}
                onClick={() => onNavigate?.(section.key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") onNavigate?.(section.key);
                }}
                className={`gk-shell-nav-item${active ? " gk-shell-nav-item-active" : ""}`}
              >
                <NavIcon path={section.icon} active={active} />
                <span className="gk-shell-nav-label">{section.label}</span>
              </div>
            );
          })}
        </div>
        <div className="gk-shell-nav-footer">
          <a className="gk-shell-nav-item gk-shell-nav-footer-item" href="/contact">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M9.8 9.3a2.2 2.2 0 1 1 3.3 2c-.8.6-1.1 1-1.1 2.1" />
              <circle cx="12" cy="16.6" r="0.4" fill="rgba(255,255,255,0.65)" />
            </svg>
            <span className="gk-shell-nav-label gk-shell-nav-footer-label">Help</span>
          </a>
          <a className="gk-shell-nav-item gk-shell-nav-footer-item" href="/logout">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h3" />
              <path d="M13.5 8.5 17 12l-3.5 3.5M17 12H9" />
            </svg>
            <span className="gk-shell-nav-label gk-shell-nav-footer-label">Sign out</span>
          </a>
        </div>
      </aside>

      <div className="gk-shell-main">
        <header className="gk-shell-header">
          <div className="gk-shell-header-org">
            <OrgLogo logoUrl={organizationLogoUrl} name={displayName} />
            {showOrgSwitcher ? (
              <div className="gk-shell-org-switcher-wrap">
                <button
                  type="button"
                  className="gk-shell-org-switcher-btn"
                  onClick={() => setOrgMenuOpen((open) => !open)}
                  aria-expanded={orgMenuOpen}
                  aria-haspopup="listbox"
                >
                  <span className="gk-shell-header-org-name">{displayName}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#455A7C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {orgMenuOpen ? (
                  <div className="gk-shell-org-switcher-menu" role="listbox">
                    {organizations.map((org) => (
                      <button
                        type="button"
                        key={org.organization_id}
                        role="option"
                        aria-selected={org.organization_id === selectedOrganizationId}
                        className="gk-shell-org-switcher-option"
                        onClick={() => {
                          setOrgMenuOpen(false);
                          onSelectOrganization(org.organization_id);
                        }}
                      >
                        {org.name || org.organization_id}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <span className="gk-shell-header-org-name">{displayName}</span>
            )}
            {organizationActionHref ? (
              <a className="gk-shell-org-action" href={organizationActionHref}>
                {organizationActionLabel}
              </a>
            ) : null}
          </div>
          <button
            type="button"
            className="gk-shell-bell-btn"
            onClick={onOpenNeedsAttention}
            aria-label={hasAttention ? "Needs Attention (items pending)" : "Needs Attention"}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#455A7C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 10.5a6 6 0 0 1 12 0v3.2l1.5 2.3H4.5L6 13.7Z" />
              <path d="M10 18.5a2 2 0 0 0 4 0" />
            </svg>
            {hasAttention ? <span className="gk-shell-bell-dot" /> : null}
          </button>
        </header>

        <main className="gk-shell-content">{children}</main>
      </div>
    </div>
  );
}
