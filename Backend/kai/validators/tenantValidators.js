import { blockerResult, passResult } from "./types.js";

function normalizeId(value) {
  return value == null ? null : String(value);
}

function collectOrganizationIds(value, ids = new Set()) {
  if (!value || typeof value !== "object") return ids;
  if (Array.isArray(value)) {
    for (const item of value) collectOrganizationIds(item, ids);
    return ids;
  }
  if (value.organization_id != null) ids.add(String(value.organization_id));
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") collectOrganizationIds(child, ids);
  }
  return ids;
}

export function validateTenantBoundaryConsistency({
  expectedOrganizationId,
  payload = {},
  currentRecords = [],
  engagementRecord = null,
} = {}) {
  const expected = normalizeId(expectedOrganizationId);
  if (!expected) {
    return blockerResult("VAL-TEN-001", "Expected organization is required.", {
      object_type: "tenant",
      blocking_reason: "missing_expected_organization_id",
      required_fix: "Supply organizationId from the authenticated tenant scope.",
    });
  }

  const observedOrgIds = collectOrganizationIds(payload);
  for (const record of Array.isArray(currentRecords) ? currentRecords : [currentRecords]) {
    collectOrganizationIds(record, observedOrgIds);
  }
  if (engagementRecord?.organization_id != null) {
    observedOrgIds.add(String(engagementRecord.organization_id));
  }

  const records = Array.isArray(currentRecords) ? currentRecords : [currentRecords];
  const hasCurrentRecordEngagementState = records.some((record) => record?.engagement_id != null);

  if (payload.engagement_id != null && !engagementRecord && !hasCurrentRecordEngagementState) {
    return blockerResult("VAL-TEN-002", "Engagement tenant state is missing or invalid.", {
      object_type: "engagement",
      object_id: payload.engagement_id,
      blocking_reason: "missing_engagement_tenant_state",
      required_fix: "Resolve the engagement inside the expected organization before continuing.",
      evidence: {
        expected_organization_id: expected,
        engagement_id: normalizeId(payload.engagement_id),
      },
    });
  }

  const mismatched = [...observedOrgIds].filter((id) => id !== expected);
  if (mismatched.length > 0) {
    return blockerResult("VAL-TEN-001", "Payload crosses organization boundaries.", {
      object_type: "tenant",
      blocking_reason: "cross_organization_payload",
      required_fix: "Use records and payload values from one organization only.",
      evidence: {
        expected_organization_id: expected,
        observed_organization_ids: [...observedOrgIds],
      },
    });
  }

  if (
    payload.engagement_id != null &&
    engagementRecord &&
    normalizeId(payload.engagement_id) !== normalizeId(engagementRecord.engagement_id)
  ) {
    return blockerResult("VAL-TEN-001", "Engagement record does not match payload engagement.", {
      object_type: "engagement",
      object_id: payload.engagement_id,
      blocking_reason: "engagement_mismatch",
      required_fix: "Resolve the engagement inside the expected organization before continuing.",
    });
  }

  if (payload.engagement_id != null) {
    for (const record of records) {
      if (!record?.engagement_id) continue;
      if (normalizeId(record.engagement_id) !== normalizeId(payload.engagement_id)) {
        return blockerResult("VAL-TEN-003", "Requested engagement does not match parent batch tenant state.", {
          object_type: "intake_batch",
          object_id: record.intake_batch_id || null,
          blocking_reason: "engagement_batch_tenant_mismatch",
          required_fix: "Use the engagement_id from the parent intake batch or reserve against the correct batch.",
          evidence: {
            requested_engagement_id: normalizeId(payload.engagement_id),
            batch_engagement_id: normalizeId(record.engagement_id),
          },
        });
      }
    }
  }

  return passResult("VAL-TEN-001", "Tenant boundary is consistent.", {
    expected_organization_id: expected,
  });
}
