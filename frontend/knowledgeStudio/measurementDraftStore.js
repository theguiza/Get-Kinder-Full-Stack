/**
 * Unsaved measurement entries (a custom calculation, its optional meaning, a
 * planned target, a description, a raw-count definition) kept per source
 * version and worksheet for this page session, so switching worksheets - or
 * the panel re-mounting after a save elsewhere - never discards them. Nothing
 * is stored in the browser or sent anywhere; a successful save clears its entry.
 */
const drafts = new Map();

export function measurementDraftKey(organizationId, sourceVersionId, worksheetKey, part) {
  return JSON.stringify([organizationId || "", sourceVersionId || "", worksheetKey || "", part]);
}

export function readMeasurementDraft(key) {
  return drafts.has(key) ? drafts.get(key) : null;
}

/** Keep a draft, or forget it when `draft` is null. */
export function keepMeasurementDraft(key, draft) {
  if (draft == null) drafts.delete(key);
  else drafts.set(key, draft);
}
