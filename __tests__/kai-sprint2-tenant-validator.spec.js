import test from "node:test";
import assert from "node:assert/strict";

import { validateTenantBoundaryConsistency } from "../Backend/kai/validators/tenantValidators.js";

test("tenant validator blocks cross-org payloads", () => {
  const result = validateTenantBoundaryConsistency({
    expectedOrganizationId: "org-1",
    payload: {
      organization_id: "org-1",
      files: [{ organization_id: "org-2" }],
    },
  });

  assert.equal(result.severity, "blocker");
  assert.equal(result.blocking_reason, "cross_organization_payload");
});

test("tenant validator accepts matching payload and engagement state", () => {
  const result = validateTenantBoundaryConsistency({
    expectedOrganizationId: "org-1",
    payload: { organization_id: "org-1", engagement_id: "eng-1" },
    engagementRecord: { engagement_id: "eng-1", organization_id: "org-1" },
  });

  assert.equal(result.severity, "pass");
});
