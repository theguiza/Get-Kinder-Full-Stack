import React, { useEffect, useState } from "react";

import ImpactLibraryShell from "./impactLibraryShell.jsx";
import { organizationsPath, organizationProfilePath } from "./kaiWebIntakeLogic.js";
import { getJson } from "./impactEvidenceLibraryLogic.js";
import ImpactEvidenceLibrary from "./ImpactEvidenceLibrary.jsx";

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
 * Top-level container for the approved /impact-library redesign (Package
 * B1/B2). Owns the shared shell's organization display state and Needs
 * Attention affordance; the existing, unmodified ImpactEvidenceLibrary
 * component (governed evidence/claim/traceability tool) is composed inside
 * the shell under the Knowledge Studio section, preserving its own internal
 * organization-selection behavior exactly as before.
 *
 * Known interim limitation (tracked for Package D, which decomposes
 * ImpactEvidenceLibrary.jsx): the shell header's organization name/logo is
 * resolved independently of ImpactEvidenceLibrary's own in-page organization
 * picker, since that component's organization state is internal and used by
 * thirteen existing locked source-contract tests. For the common case (a
 * user authorized for exactly one organization) this is always correct. A
 * user authorized for multiple organizations can still switch organizations
 * both in the header (which will fetch a fresh display profile) and inside
 * Knowledge Studio's own picker; the two are not yet synchronized, and the
 * header does not automatically reflect a change made in the in-page
 * picker.
 */
export default function ImpactLibraryApp({ initialSection = "knowledgeStudio" } = {}) {
  const [activeSection, setActiveSection] = useState(initialSection);
  const [organizations, setOrganizations] = useState([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  // Keyed by organization_id, so the org switcher never has to fall back to
  // showing a raw UUID for any organization whose display profile has
  // already resolved - not only the currently active one.
  const [organizationProfiles, setOrganizationProfiles] = useState({});

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

  const activeProfile = organizationProfiles[selectedOrganizationId] || null;
  const organizationName = activeProfile?.name || "";
  const organizationLogoUrl = activeProfile?.logoUrl || "";
  const organizationsForSwitcher = organizations.map((org) => ({
    organization_id: org.organization_id,
    name: organizationProfiles[org.organization_id]?.name || "",
  }));

  let sectionContent;
  if (activeSection === "knowledgeStudio") {
    sectionContent = <ImpactEvidenceLibrary />;
  } else if (activeSection === "home") {
    sectionContent = <ComingSoonPanel title="Home" />;
  } else if (activeSection === "impactLibrary") {
    sectionContent = <ComingSoonPanel title="Impact Library" />;
  } else if (activeSection === "improvementPlan") {
    sectionContent = <ComingSoonPanel title="Improvement Plan" />;
  } else if (activeSection === "projects") {
    sectionContent = <ComingSoonPanel title="Projects" />;
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
      {sectionContent}
    </ImpactLibraryShell>
  );
}
