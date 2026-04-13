const DEFAULT_POOL_SLUG = "general";
const POOL_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const POOL_SCOPE_SEP = "__";
const SCOPED_POOL_RE = /^u([^_]+)__([a-z0-9][a-z0-9_-]{0,63})$/;

export const normalizePoolSlug = (value) => {
  const slug = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!slug) return DEFAULT_POOL_SLUG;
  return POOL_SLUG_RE.test(slug) ? slug : DEFAULT_POOL_SLUG;
};

export const buildScopedPoolSlug = (ownerUserId, poolSlug) => {
  const normalizedPoolSlug = normalizePoolSlug(poolSlug);
  const owner = String(ownerUserId || "").trim();
  if (!owner) return normalizedPoolSlug;
  return `u${owner}${POOL_SCOPE_SEP}${normalizedPoolSlug}`;
};

export const parseScopedPoolSlug = (poolSlug) => {
  const normalizedPoolSlug = normalizePoolSlug(poolSlug);
  const match = normalizedPoolSlug.match(SCOPED_POOL_RE);
  if (!match) return null;
  return {
    ownerKey: match[1],
    basePoolSlug: match[2],
    scopedPoolSlug: normalizedPoolSlug,
  };
};

export const buildFundingPoolCandidates = ({ ownerUserId, poolSlug }) => {
  const normalizedPoolSlug = normalizePoolSlug(poolSlug);
  const parsedScopedSlug = parseScopedPoolSlug(normalizedPoolSlug);
  const basePoolSlug = parsedScopedSlug?.basePoolSlug || normalizedPoolSlug;
  const scopedPoolSlug = parsedScopedSlug?.scopedPoolSlug || buildScopedPoolSlug(ownerUserId, basePoolSlug);

  return [...new Set([scopedPoolSlug, basePoolSlug].filter(Boolean))];
};

export const pickBestFundingPool = (candidates, creditsToFund) => {
  const amount = Number(creditsToFund) || 0;
  const viableCandidates = Array.isArray(candidates)
    ? candidates.filter((candidate) => candidate && candidate.poolSlug)
    : [];

  if (!viableCandidates.length) return null;

  const fullyFundedCandidate = viableCandidates.find(
    (candidate) => (Number(candidate.poolBalance) || 0) >= amount
  );
  if (fullyFundedCandidate) return fullyFundedCandidate;

  return viableCandidates.reduce((best, candidate) => {
    if (!best) return candidate;
    return (Number(candidate.poolBalance) || 0) > (Number(best.poolBalance) || 0) ? candidate : best;
  }, null);
};

export { DEFAULT_POOL_SLUG, POOL_SCOPE_SEP };
