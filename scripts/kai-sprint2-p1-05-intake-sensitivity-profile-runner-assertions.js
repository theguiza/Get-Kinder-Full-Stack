// Repository pattern copied from the established P1-02
// (kai-sprint2-p1-parser-run-and-file-profile-local-postgres.js) assertNoFail
// behavior: a FAIL status cell fails the run; a check name merely containing the
// substring FAIL_CLOSED (e.g. FAIL_CLOSED_DEFAULTS_ONLY) must not.
export function assertNoFail(label, output) {
  if (/\|\s*FAIL\s*\|/.test(output) || /\sFAIL\s/.test(output)) {
    throw new Error(`${label} reported FAIL\n${output}`);
  }
}
