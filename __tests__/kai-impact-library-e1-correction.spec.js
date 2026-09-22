import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  listOrganizationEvidenceLibrary,
  __evidenceLibraryServiceContract,
  __testables as evidenceLibraryTestables,
} from "../Backend/kai/services/kaiEvidenceLibraryService.js";

/**
 * Impact Library redesign, E1 correction: (1) Knowledge Studio Evidence
 * must not be enumerated through kai.claims, since a governed evidence item
 * can exist before any claim is proposed for it; (2) the Impact Fact
 * headline must use the claim's own governed assertion (claims.statement),
 * not the linked evidence item's statement.
 */

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });
const evidenceActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "gk_operator" }],
});

test("proof: kai.evidence_items has no column and no foreign key referencing kai.claims - the dependency runs the other way (claims.evidence_item_id -> evidence_items)", () => {
  const migrationSource = readFileSync("migrations/kai_sprint2_p2_01_evidence_lineage.sql", "utf8");
  const claimsMigrationSource = readFileSync("migrations/kai_sprint2_p2_03_claim_proposal.sql", "utf8");
  // evidence_items has no claim_id column and references only source_versions/source_locators.
  assert.doesNotMatch(migrationSource, /evidence_items[\s\S]{0,400}claim_id/i);
  // claims requires and references evidence_items - not the reverse.
  assert.match(claimsMigrationSource, /evidence_item_id uuid NOT NULL/);
  assert.match(claimsMigrationSource, /CONSTRAINT claims_p2_03_evidence_item_fk\s*\n\s*FOREIGN KEY \(evidence_item_id, organization_id\)\s*\n\s*REFERENCES kai\.evidence_items/);
  // Nothing requires every evidence_item to have a claim: claim_type is
  // pinned to a single value, so the uniqueness constraint below bounds
  // claims per evidence_item at one - it does not create a lower bound.
  assert.match(claimsMigrationSource, /UNIQUE \(organization_id, evidence_item_id, claim_type\)/);
  assert.match(claimsMigrationSource, /CHECK \(claim_type = 'finding'\)/);
});

test("1 & 2: Knowledge Studio Evidence is wired to the new evidence-native read path, independent of the Claim Library", () => {
  const libSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");
  assert.match(libSource, /evidenceLibraryCandidatesPath,\s*\n\s*projectEvidenceLibraryItems,/);
  assert.match(libSource, /getJson\(evidenceLibraryCandidatesPath\(organizationId\)\)/);
  // The evidence fetch effect is independent of (not derived from) candidateClaims.
  assert.doesNotMatch(libSource, /loadEvidenceItems[\s\S]{0,200}candidateClaims/);
});

test("3: the new evidence-native service is organization-scoped, tenant-safe, authorized, and behind KAI_SPRINT2_ENABLED", async () => {
  const disabled = await listOrganizationEvidenceLibrary(
    { organizationId: ORG_A, limit: 25, actorContext: evidenceActor },
    { env: {} },
  );
  assert.equal(disabled.ok, false);
  assert.equal(disabled.error.code, "feature_disabled");

  const crossOrgActor = {
    ...evidenceActor,
    organizationMemberships: [{ organization_id: "00000000-0000-4000-8000-00000000000b", membership_status: "active", role_name: "gk_operator" }],
  };
  const denied = await listOrganizationEvidenceLibrary(
    { organizationId: ORG_A, limit: 25, actorContext: crossOrgActor },
    { env: enabledEnv },
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "authorization_denied");
});

test("3 & 4: evidence items are returned with organization scoping and source/locator lineage fields, read-only", async () => {
  const result = await listOrganizationEvidenceLibrary(
    { organizationId: ORG_A, limit: 25, actorContext: evidenceActor },
    {
      env: enabledEnv,
      listOrganizationEvidenceItems: async (organizationId) => [{
        evidence_item_id: "10000000-0000-4000-8000-000000000001",
        organization_id: organizationId,
        source_id: "20000000-0000-4000-8000-000000000001",
        source_version_id: "30000000-0000-4000-8000-000000000001",
        evidence_type: "dictionary_field_presence_fact",
        data_class: "organization_committed_metadata",
        support_strength: "unassessed",
        statement: "42 records include a completion date field.",
        evidence_review_status: "needs_gk_review",
        internal_only: true,
        public_use_allowed: false,
        funder_use_allowed: false,
      }],
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.items.length, 1);
  assert.equal(result.data.items[0].sourceId, "20000000-0000-4000-8000-000000000001");
  assert.equal(result.data.items[0].sourceVersionId, "30000000-0000-4000-8000-000000000001");
  assert.equal(result.data.items[0].statement, "42 records include a completion date field.");
});

test("5: evidence responses never carry a raw storage path/participant-content field - only the allowlisted DTO fields", () => {
  const dbSource = readFileSync("Backend/kai/db/kaiEvidenceLibraryReadModels.js", "utf8");
  assert.doesNotMatch(dbSource, /file_path|storage_path|raw_content|participant/i);
  assert.match(evidenceLibraryTestables.responseEvidenceItem.toString(), /statement/);
});

test("6: Claims/Impact Facts remain a separate conceptual layer - the Claim Library service and read model are untouched by the new evidence-native path", () => {
  const claimServiceSource = readFileSync("Backend/kai/services/kaiClaimLibraryService.js", "utf8");
  const evidenceServiceSource = readFileSync("Backend/kai/services/kaiEvidenceLibraryService.js", "utf8");
  assert.doesNotMatch(evidenceServiceSource, /kaiClaimLibraryReadModels|listClaimLibraryCandidates/);
  assert.doesNotMatch(claimServiceSource, /kaiEvidenceLibraryReadModels|listOrganizationEvidenceLibrary/);
});

test("7 & 8: the Impact Fact headline uses the claim's own real governed statement (claims.statement), never the linked evidence item's statement, and nothing is fabricated", () => {
  const readModelSource = readFileSync("Backend/kai/db/kaiClaimLibraryReadModels.js", "utf8");
  const serviceSource = readFileSync("Backend/kai/services/kaiClaimLibraryService.js", "utf8");
  const traceabilityRepoSource = readFileSync("Backend/kai/dictionary/postgresClaimTraceabilityRepository.js", "utf8");
  const listViewSource = readFileSync("frontend/impactLibrary/ImpactLibraryListView.jsx", "utf8");
  const detailViewSource = readFileSync("frontend/impactLibrary/ImpactFactDetailView.jsx", "utf8");

  assert.match(readModelSource, /c\.statement AS claim_statement/);
  assert.match(serviceSource, /claimStatement: row\.claim_statement \?\? null,/);
  assert.match(traceabilityRepoSource, /statement: claimRow\.statement,/);

  assert.match(listViewSource, /\{claim\.claimStatement \|\| "Statement not yet available"\}/);
  assert.match(detailViewSource, /\{traceability\.claim\?\.statement \|\| "Impact Fact"\}/);
  // The evidence statement is present only as supporting provenance, never the headline.
  assert.match(detailViewSource, /SectionLabel>Supporting evidence/);
});

test("existing D/E regressions: the claim-library query's read-only/organization-scoping/no-forbidden-joins guarantees are unaffected by the additive claim_statement column", () => {
  const readModelSource = readFileSync("Backend/kai/db/kaiClaimLibraryReadModels.js", "utf8");
  assert.doesNotMatch(readModelSource, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b|FOR UPDATE/i);
  assert.match(readModelSource, /WHERE c\.organization_id = \$1::uuid/);
});
