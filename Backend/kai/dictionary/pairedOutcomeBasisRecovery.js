import { PAIRED_OUTCOME_DISCOVERY_VERSION } from "../profiling/pairedOutcomeBasis.js";

// One recovery policy for the source-only service and the persisted measurement
// journey. The byte reader remains inside the existing parser worker.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function profileWithCurrentPairedBasis(tx, { organizationId, fileProfileRow, worksheetKey, worker = null }) {
  const profile = fileProfileRow.profile;
  if (profile?.format !== "xlsx") return profile;
  const sheet = worksheetKey == null && profile.sheets?.length === 1
    ? profile.sheets[0] : profile.sheets?.find((item) => item.sheet_key === worksheetKey);
  const old = sheet?.paired_outcome_basis;
  // Valid committed calculations remain the basis of existing identities.
  // Only a failed discovery under the earlier rules needs the exact file.
  if (!old || old.discovery_version >= PAIRED_OUTCOME_DISCOVERY_VERSION
    || old.status !== "no_candidate"
    || !old.candidates?.stage?.length
    || !["participant_identifier_not_found", "numeric_outcome_field_not_found"].includes(old.reason)) return profile;
  let refreshed;
  try {
    const input = { organizationId, intakeFileId: fileProfileRow.intake_file_id, checksum: fileProfileRow.checksum, worksheetKey: sheet.sheet_key };
    if (worker?.readPairedOutcomeBasis) {
      refreshed = await worker.readPairedOutcomeBasis(tx, input);
    } else {
      const { readCurrentPairedOutcomeBasis } = await import("../parsing/crossSourceReconciliationJobRuntime.js");
      refreshed = await readCurrentPairedOutcomeBasis(tx, input);
    }
  } catch { refreshed = { ok: false }; }
  const originalCount = sheet.record_count_basis;
  const matches = refreshed?.ok && refreshed.sheetKey === sheet.sheet_key
    && refreshed.basis?.discovery_version === PAIRED_OUTCOME_DISCOVERY_VERSION
    && ["header_row_established", "data_record_count", "blank_record_count", "field_missing_counts"]
      .every((key) => canonicalJson(refreshed.recordCountBasis?.[key]) === canonicalJson(originalCount?.[key]));
  const basis = matches ? refreshed.basis : { ...old, status: "not_assessable", reason: "verified_workbook_unavailable" };
  return { ...profile, sheets: profile.sheets.map((item) => item === sheet ? { ...item, paired_outcome_basis: basis } : item) };
}
