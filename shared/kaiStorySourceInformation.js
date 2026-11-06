// Owner decision 2026-11-06: source story presence and storytelling style
// are presentation metadata, never an authorization or validation input.
export const STORY_SOURCE_NOTE_CODE = "story_source_information";
export const STORY_SOURCE_NOTE = "This source may contain stories or testimonials. Check permission before sharing a participant story or quotation externally.";

// The reminder is shown for every draft, including historical drafts without
// note metadata. No presence value or style preference can affect its severity,
// the model request, a fingerprint, review state, or an available action.
export function storySourceWarnings() {
  return [{ code: STORY_SOURCE_NOTE_CODE, message: STORY_SOURCE_NOTE }];
}

// Existing validator_results JSON carries the note across persistence/replay;
// it is a pass entry, not a validation requirement or an acknowledgment.
export const STORY_SOURCE_NOTE_RESULT = Object.freeze({
  validator_key: "INFO-SOURCE-STORY-001",
  severity: "pass",
  evidence: Object.freeze({ informational_note_code: STORY_SOURCE_NOTE_CODE }),
});

export const LEGACY_STORY_LIMITATION_CODE = "source.story_testimonial_present_count_only";

export function withoutLegacyStoryLimitations(codes) {
  return (codes || []).filter((code) => code !== LEGACY_STORY_LIMITATION_CODE);
}

// Historical machine results only. Do not erase human decisions or unrelated
// validation failures. Current claim, lineage and permission checks still run.
export function isRetiredStoryValidationResult(result) {
  return (result?.validator_key === "VAL-GEN-010"
    && (result.severity === "pass" || result.blocking_reason === "count_only_content_boundary_exceeded"))
    || (result?.validator_key === "VAL-GEN-MEASURED-P2-01M-001"
      && result.blocking_reason === "story_testimonial_count_only_operation_not_permitted");
}
