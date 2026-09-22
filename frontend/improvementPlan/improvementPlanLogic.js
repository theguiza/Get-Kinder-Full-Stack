/**
 * Package G2: humanized labels for the approved Improvement Practice
 * status/cadence vocabularies (Backend/kai/services/kaiImprovementPracticeService.js).
 * Never invents a status/cadence value beyond the approved set.
 */
export const IMPROVEMENT_PRACTICE_STATUS_LABELS = Object.freeze({
  recommended: "Recommended",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
});

export const IMPROVEMENT_PRACTICE_CADENCE_LABELS = Object.freeze({
  one_time: "One-time",
  every_session: "Every session",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Annually",
  ongoing: "Ongoing",
});

export function humanizeImprovementPracticeStatus(status) {
  return IMPROVEMENT_PRACTICE_STATUS_LABELS[status] || status;
}

export function humanizeImprovementPracticeCadence(cadence) {
  return IMPROVEMENT_PRACTICE_CADENCE_LABELS[cadence] || cadence;
}

export const IMPROVEMENT_PRACTICE_STATUS_ORDER = Object.freeze(["recommended", "active", "paused", "completed"]);
