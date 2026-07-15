import express from "express";
import {
  KAI_SPRINT2_P0_ABUSE_LIMITS,
  KAI_SPRINT2_P0_PATTERNS,
  KAI_SPRINT2_P0_REQUEST_LIMITS,
} from "../config/kaiSprint2P0Contract.js";
import { sendKaiError } from "../errors/kaiErrors.js";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const kaiSprint2MetadataJsonParser = express.json({
  limit: KAI_SPRINT2_P0_REQUEST_LIMITS.metadataJsonMaxRawBytes,
  strict: true,
});

export function setKaiSprint2NoStore(req, res, next) {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  return next();
}

export function handleKaiSprint2JsonParserError(error, req, res, next) {
  if (!error) return next();
  if (error.type === "entity.too.large" || error.status === 413) {
    return sendKaiError(res, "request_too_large");
  }
  if (error instanceof SyntaxError || error.type === "entity.parse.failed") {
    return sendKaiError(res, "invalid_request");
  }
  return next(error);
}

function safeActorKey(req) {
  const value = req?.user?.id;
  if (value == null) return null;
  const normalized = String(value);
  return normalized.length > 0 && normalized.length <= 64 ? `actor:${normalized}` : null;
}

function safeOrganizationKey(req) {
  const value = req?.body?.organization_id || req?.query?.organization_id;
  if (typeof value !== "string" || !KAI_SPRINT2_P0_PATTERNS.uuid.test(value)) return null;
  return `organization:${value.toLowerCase()}`;
}

export function createKaiMutationAttemptLimiter({ scope, max, windowMs, now = Date.now } = {}) {
  const counters = new Map();
  const keyForRequest = scope === "actor" ? safeActorKey : safeOrganizationKey;

  function middleware(req, res, next) {
    if (!MUTATION_METHODS.has(String(req?.method || "GET").toUpperCase())) return next();
    const key = keyForRequest(req);
    if (!key) return next();

    const currentTime = now();
    let state = counters.get(key);
    if (!state || currentTime >= state.resetAt) {
      state = { count: 0, resetAt: currentTime + windowMs };
      counters.set(key, state);
    }

    const remainingBeforeAttempt = Math.max(0, max - state.count);
    const resetSeconds = Math.max(1, Math.ceil((state.resetAt - currentTime) / 1000));
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, remainingBeforeAttempt - 1)));
    res.setHeader("RateLimit-Reset", String(resetSeconds));
    res.setHeader("RateLimit-Policy", `${max};w=${Math.ceil(windowMs / 1000)}`);

    state.count += 1;
    if (state.count > max) {
      res.setHeader("Retry-After", String(resetSeconds));
      return sendKaiError(res, "abuse_limited");
    }
    return next();
  }

  middleware.reset = () => counters.clear();
  return middleware;
}

export const kaiSprint2ActorMutationLimiter = createKaiMutationAttemptLimiter({
  scope: "actor",
  max: KAI_SPRINT2_P0_ABUSE_LIMITS.actorMutationAttempts,
  windowMs: KAI_SPRINT2_P0_ABUSE_LIMITS.windowMs,
});

export const kaiSprint2OrganizationMutationLimiter = createKaiMutationAttemptLimiter({
  scope: "organization",
  max: KAI_SPRINT2_P0_ABUSE_LIMITS.organizationMutationAttempts,
  windowMs: KAI_SPRINT2_P0_ABUSE_LIMITS.windowMs,
});

export const __testables = {
  safeActorKey,
  safeOrganizationKey,
};
