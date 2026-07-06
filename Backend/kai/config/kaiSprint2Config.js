export function isKaiSprint2Enabled(env = process.env) {
  const value = String(env.KAI_SPRINT2_ENABLED || "").trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "on";
}

export function requireKaiSprint2Enabled(req, res, next) {
  if (isKaiSprint2Enabled()) return next();

  return res.status(403).json({
    ok: false,
    error: {
      code: "feature_disabled",
      message: "KAI Sprint 2 intake is not enabled.",
      status: 403,
    },
    data: null,
    blockers: [],
    warnings: [],
  });
}
