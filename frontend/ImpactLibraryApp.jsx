import React, { useCallback, useEffect, useState } from "react";

import ImpactLibraryShell, { ProjectContextBar } from "./impactLibraryShell.jsx";
import { organizationsPath, organizationProfilePath, engagementsPath, createEngagementPath, postJson } from "./kaiWebIntakeLogic.js";
import { getJson } from "./impactEvidenceLibraryLogic.js";
import ImpactEvidenceLibrary from "./ImpactEvidenceLibrary.jsx";
import ImpactHomeView from "./ImpactHomeView.jsx";
import ImpactLibraryListView from "./impactLibrary/ImpactLibraryListView.jsx";
import ImpactFactDetailView from "./impactLibrary/ImpactFactDetailView.jsx";
import ProjectsView from "./projects/ProjectsView.jsx";

/**
 * A single, honestly-labeled placeholder for approved-design sections that
 * are not yet built by this rollout. Never fabricates data or a working
 * interaction for the missing view - it only names the section and states
 * plainly that it is coming in a later update.
 */
function ComingSoonPanel({ title }) {
  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: "#2C2E3A", margin: "0 0 8px" }}>{title}</h1>
      <p style={{ fontSize: 14.5, color: "#5B6478", maxWidth: 560, lineHeight: 1.5 }}>
        This part of the redesigned Impact Library is being rolled out and isn&rsquo;t available yet.
      </p>
    </div>
  );
}

/**
 * Per-view classification of whether "All organizational knowledge" (no
 * Project/Engagement filter) is honest for that view's read paths (Package
 * C0). Knowledge Studio's primary content (claims, evidence, gaps/risks,
 * review queue, organization sources) is ORGANIZATION_WIDE - only its
 * Funder Requirements / Grant Response Packet / Board Reporting sub-features
 * are ENGAGEMENT_SCOPED_ONLY, and those already render their own existing
 * "select an organization/engagement" gate when no engagement is active.
 * Impact Library and Impact Fact Detail (Package E) are also
 * ORGANIZATION_WIDE: claimLibraryCandidatesPath and claimTraceabilityPath
 * take only organizationId (+ claimId/audience), never an engagementId.
 * Improvement Plan/Projects are not yet built (Packages G/F), so they are
 * not yet classified - this map is extended as each one lands, never
 * assumed.
 */
const SECTION_ALLOWS_ORGANIZATION_WIDE = Object.freeze({
  knowledgeStudio: true,
  impactLibrary: true,
});

// Sections whose content actually consumes the shared Project/Engagement
// context today. Home's and Impact Library's real reads are all
// organization-wide and do not yet take an engagement filter, so the
// selector is not shown there - showing it would imply a filtering
// behavior that does not exist.
const SECTION_SHOWS_PROJECT_CONTEXT_BAR = Object.freeze({
  knowledgeStudio: true,
});

/**
 * Top-level container for the approved /impact-library redesign (Packages
 * B1/B2 shell + C0 shared Project/Engagement context). Owns the one
 * authoritative organization and Project/Engagement selection for the whole
 * application and passes both down as controlled props to the existing,
 * otherwise-unmodified ImpactEvidenceLibrary component (which in turn passes
 * the engagement through to KaiWebIntake) - no view gets its own
 * independent, potentially-disagreeing selection.
 */
export default function ImpactLibraryApp({ initialSection = "home" } = {}) {
  const [activeSection, setActiveSection] = useState(initialSection);
  const [organizations, setOrganizations] = useState([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  // Keyed by organization_id, so the org switcher never has to fall back to
  // showing a raw UUID for any organization whose display profile has
  // already resolved - not only the currently active one.
  const [organizationProfiles, setOrganizationProfiles] = useState({});

  const [engagements, setEngagements] = useState([]);
  const [engagementsLoaded, setEngagementsLoaded] = useState(false);
  const [selectedEngagementId, setSelectedEngagementId] = useState("");

  // Package E: which Impact Fact (claimId), if any, Impact Library is
  // currently drilled into. Reset whenever the section or organization
  // changes so a stale selection from a prior organization can never leak.
  const [selectedImpactFactClaimId, setSelectedImpactFactClaimId] = useState(null);
  useEffect(() => {
    setSelectedImpactFactClaimId(null);
  }, [activeSection, selectedOrganizationId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getJson(organizationsPath());
      if (cancelled) return;
      if (result.statusCode !== 200 || !result.body?.ok) {
        setOrganizations([]);
        return;
      }
      const items = result.body.data?.items || [];
      setOrganizations(items);
      if (items.length > 0) {
        setSelectedOrganizationId(items[0].organization_id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (organizations.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        organizations.map(async (org) => {
          const result = await getJson(organizationProfilePath(org.organization_id));
          if (result.statusCode !== 200 || !result.body?.ok) return [org.organization_id, null];
          const data = result.body.data || {};
          return [
            org.organization_id,
            {
              name: typeof data.name === "string" ? data.name : "",
              logoUrl: typeof data.logo_url === "string" ? data.logo_url : "",
            },
          ];
        }),
      );
      if (cancelled) return;
      setOrganizationProfiles(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [organizations]);

  const [creatingEngagement, setCreatingEngagement] = useState(false);
  const [createEngagementError, setCreateEngagementError] = useState("");

  // Package C0: the one authoritative Project/Engagement list fetch for
  // the active organization, reused both by the organization-change effect
  // below and by Package F's "+ New Project" (so a newly created Project
  // appears through the exact same shared list, never a second one).
  const refetchEngagements = useCallback(async (organizationId, { preserveSelection = false } = {}) => {
    if (!organizationId) {
      setEngagements([]);
      setEngagementsLoaded(false);
      setSelectedEngagementId("");
      return;
    }
    const result = await getJson(engagementsPath(organizationId));
    setEngagementsLoaded(true);
    if (result.statusCode !== 200 || !result.body?.ok) {
      setEngagements([]);
      return;
    }
    const items = result.body.data?.items || [];
    setEngagements(items);
    if (preserveSelection) return;
    // Smallest honest auto-selection rule: exactly one authorized Project
    // selects itself; with more than one, the user chooses (or the view
    // stays at "All organizational knowledge" where that is honest).
    if (items.length === 1) {
      setSelectedEngagementId(items[0].engagement_id);
    }
  }, []);

  // Package C0: re-fetched, and the previous organization's selection
  // discarded, every time the active organization changes - an
  // Engagement/Project must never carry across organizations.
  useEffect(() => {
    setEngagements([]);
    setEngagementsLoaded(false);
    setSelectedEngagementId("");
    if (!selectedOrganizationId) return undefined;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await refetchEngagements(selectedOrganizationId);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedOrganizationId, refetchEngagements]);

  // Package F: "+ New Project". Reuses the existing authorized
  // create-engagement path; on success, re-fetches the one shared
  // Project/Engagement list (preserving whatever is currently selected)
  // and selects the newly created Project.
  const createEngagement = useCallback(async (engagementCode) => {
    if (!selectedOrganizationId) return { ok: false, error: "Select an organization first." };
    setCreatingEngagement(true);
    setCreateEngagementError("");
    const result = await postJson(createEngagementPath(selectedOrganizationId), { engagement_code: engagementCode });
    setCreatingEngagement(false);
    if (result.statusCode !== 201 || !result.body?.ok) {
      const message = result.body?.error?.message || "Could not create the Project.";
      setCreateEngagementError(message);
      return { ok: false, error: message };
    }
    await refetchEngagements(selectedOrganizationId, { preserveSelection: true });
    const createdEngagementId = result.body.data?.engagement_id;
    if (createdEngagementId) setSelectedEngagementId(createdEngagementId);
    return { ok: true };
  }, [selectedOrganizationId, refetchEngagements]);

  const activeProfile = organizationProfiles[selectedOrganizationId] || null;
  const organizationName = activeProfile?.name || "";
  const organizationLogoUrl = activeProfile?.logoUrl || "";
  const organizationsForSwitcher = organizations.map((org) => ({
    organization_id: org.organization_id,
    name: organizationProfiles[org.organization_id]?.name || "",
  }));

  const allowOrganizationWide = SECTION_ALLOWS_ORGANIZATION_WIDE[activeSection] === true;

  let sectionContent;
  if (activeSection === "knowledgeStudio") {
    sectionContent = (
      <ImpactEvidenceLibrary
        organizationId={selectedOrganizationId}
        onOrganizationIdChange={setSelectedOrganizationId}
        engagementId={selectedEngagementId}
        onEngagementIdChange={setSelectedEngagementId}
      />
    );
  } else if (activeSection === "home") {
    sectionContent = (
      <ImpactHomeView
        organizationId={selectedOrganizationId}
        onGoToKnowledgeStudio={() => setActiveSection("knowledgeStudio")}
      />
    );
  } else if (activeSection === "impactLibrary") {
    sectionContent = selectedImpactFactClaimId ? (
      <ImpactFactDetailView
        organizationId={selectedOrganizationId}
        claimId={selectedImpactFactClaimId}
        onBack={() => setSelectedImpactFactClaimId(null)}
      />
    ) : (
      <ImpactLibraryListView
        organizationId={selectedOrganizationId}
        onViewFact={setSelectedImpactFactClaimId}
      />
    );
  } else if (activeSection === "improvementPlan") {
    sectionContent = <ComingSoonPanel title="Improvement Plan" />;
  } else if (activeSection === "projects") {
    sectionContent = (
      <ProjectsView
        engagements={engagements}
        engagementsLoaded={engagementsLoaded}
        selectedEngagementId={selectedEngagementId}
        onSelectEngagement={setSelectedEngagementId}
        onCreateEngagement={createEngagement}
        creating={creatingEngagement}
        createError={createEngagementError}
      />
    );
  } else if (activeSection === "needsAttention") {
    sectionContent = <ComingSoonPanel title="Needs Attention" />;
  }

  return (
    <ImpactLibraryShell
      activeSection={activeSection}
      onNavigate={setActiveSection}
      organizationName={organizationName}
      organizationLogoUrl={organizationLogoUrl}
      organizations={organizationsForSwitcher}
      selectedOrganizationId={selectedOrganizationId}
      onSelectOrganization={setSelectedOrganizationId}
      hasAttention={false}
      onOpenNeedsAttention={() => setActiveSection("needsAttention")}
    >
      {SECTION_SHOWS_PROJECT_CONTEXT_BAR[activeSection] === true ? (
        <ProjectContextBar
          engagements={engagements}
          engagementsLoaded={engagementsLoaded}
          selectedEngagementId={selectedEngagementId}
          onSelectEngagement={setSelectedEngagementId}
          allowOrganizationWide={allowOrganizationWide}
        />
      ) : null}
      {sectionContent}
    </ImpactLibraryShell>
  );
}
