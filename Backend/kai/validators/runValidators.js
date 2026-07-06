export async function runValidators(validators, context = {}) {
  const results = [];

  for (const validator of validators) {
    const result = await validator(context);
    if (Array.isArray(result)) {
      results.push(...result);
    } else if (result) {
      results.push(result);
    }
  }

  const blockers = results.filter((result) => result.severity === "blocker");
  const warnings = results.filter((result) => result.severity === "warning");

  return {
    ok: blockers.length === 0,
    results,
    blockers,
    warnings,
  };
}
