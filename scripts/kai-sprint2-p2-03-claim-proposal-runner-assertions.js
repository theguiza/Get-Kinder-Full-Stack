// Copied from the established P2-01 (kai-sprint2-p2-01-evidence-lineage-runner-
// assertions.js) assertNoFail behavior: a FAIL status cell fails the run; a check
// name merely containing the substring FAIL_CLOSED must not. Copied into this
// package's own file rather than imported cross-package, matching the
// established per-package-copy convention.
export function assertNoFail(label, output) {
  if (/\|\s*FAIL\s*\|/.test(output) || /\sFAIL\s/.test(output)) {
    throw new Error(`${label} reported FAIL\n${output}`);
  }
}
