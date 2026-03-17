const LEGACY_KAI_DEPRECATION = Object.freeze({
  ok: false,
  deprecated: true,
  error: "legacy_kai_openai_stack_retired",
  message: "This legacy KAI OpenAI endpoint has been retired. Use the current /api/kai/* endpoints instead.",
});

function logLegacyKaiAccess(req, routeName) {
  console.warn(`[legacy-kai][quarantined] ${routeName} ${req.method} ${req.originalUrl}`);
}

function buildLegacyPayload(routeName) {
  return {
    ...LEGACY_KAI_DEPRECATION,
    route: routeName,
  };
}

export function legacyKaiDeprecatedJson(routeName) {
  return function legacyKaiDeprecatedJsonHandler(req, res) {
    logLegacyKaiAccess(req, routeName);
    return res.status(410).json(buildLegacyPayload(routeName));
  };
}

export function legacyKaiDeprecatedSse(routeName) {
  return function legacyKaiDeprecatedSseHandler(req, res) {
    logLegacyKaiAccess(req, routeName);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify(buildLegacyPayload(routeName))}\n\n`);
    res.write(`event: done\n`);
    res.write(`data: ${JSON.stringify({ route: routeName, deprecated: true })}\n\n`);
    res.end();
  };
}
