// Repository pattern copied from the established P1-06
// (kai-sprint2-p1-06-review-queue-runner-assertions.js) assertNoFail behavior: a
// FAIL status cell fails the run; a check name merely containing the substring
// FAIL_CLOSED must not.
export function assertNoFail(label, output) {
  if (/\|\s*FAIL\s*\|/.test(output) || /\sFAIL\s/.test(output)) {
    throw new Error(`${label} reported FAIL\n${output}`);
  }
}
