// Repository pattern copied from the established P1-08
// (kai-sprint2-p1-08-source-promotion-runner-assertions.js) assertNoFail
// behavior: a FAIL status cell fails the run.
export function assertNoFail(label, output) {
  if (/\|\s*FAIL\s*\|/.test(output) || /\sFAIL\s/.test(output)) {
    throw new Error(`${label} reported FAIL\n${output}`);
  }
}
