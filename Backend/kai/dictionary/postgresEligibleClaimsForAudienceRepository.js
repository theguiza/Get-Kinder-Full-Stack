import { evaluateClaimTraceabilityInTransaction } from "./postgresClaimTraceabilityRepository.js";

const ELIGIBLE_CLAIMS_RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  system_error: 500,
});

const REQUESTED_AUDIENCES = new Set(["internal", "funder", "public"]);
const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BATCH_SIZE = 100;
const MAX_CANDIDATES = 500;

function failure(code) {
  return {
    ok: false,
    data: null,
    error: { code, status: ELIGIBLE_CLAIMS_RESULT_STATUS[code] || 500 },
  };
}

function success(data) {
  return { ok: true, data, error: null };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, allowedKeys) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === allowedKeys.size && keys.every((key) => allowedKeys.has(key));
}

function isCanonicalUuidOrNull(value) {
  return value === null || (typeof value === "string" && CANONICAL_UUID_PATTERN.test(value));
}

function validateInput(input) {
  const allowedKeys = new Set(["organizationId", "requestedAudience", "limit", "afterClaimId"]);
  return (
    hasExactKeys(input, allowedKeys) &&
    typeof input.organizationId === "string" &&
    CANONICAL_UUID_PATTERN.test(input.organizationId) &&
    REQUESTED_AUDIENCES.has(input.requestedAudience) &&
    Number.isInteger(input.limit) &&
    input.limit >= 1 &&
    input.limit <= 100 &&
    isCanonicalUuidOrNull(input.afterClaimId)
  );
}

async function resolveDefaultRunInTransaction() {
  const { withTransaction } = await import("../db/kaiDb.js");
  return withTransaction;
}

async function readCandidateClaimIds(tx, { organizationId, afterClaimId, limit }) {
  const params = [organizationId, limit];
  const cursorClause = afterClaimId === null ? "" : "AND claim_id > $3::uuid";
  if (afterClaimId !== null) params.push(afterClaimId);
  const { rows } = await tx.query(
    `SELECT claim_id
       FROM kai.claims
      WHERE organization_id = $1::uuid
        ${cursorClause}
      ORDER BY claim_id ASC
      LIMIT $2::int`,
    params,
  );
  return rows;
}

function toEligibleClaim(resultData) {
  return {
    claimId: resultData.claim.claim_id,
    claimType: resultData.claim.claim_type,
    claimStatus: resultData.claim.claim_status,
    claimReviewStatus: resultData.claim.claim_review_status,
    supportStrength: resultData.evidence.support_strength,
    evidenceItemId: resultData.evidence.evidence_item_id,
    sourceId: resultData.source.source_id,
    sourceVersionId: resultData.source_version.source_version_id,
    requestedAudience: resultData.requestedAudience,
  };
}

function isUnusableCandidateResult(result) {
  return (
    result?.ok === false &&
    (result.error?.code === "not_found" || result.error?.code === "conflict_current_state_changed")
  );
}

function shapeError(error) {
  if (error?.code === "22P02") return failure("validation_blocker");
  if (error?.code === "25001") return failure("conflict_current_state_changed");
  return failure("system_error");
}

export function createPostgresEligibleClaimsForAudienceRepository({ runInTransaction, evaluator } = {}) {
  return Object.freeze({
    async listEligibleClaimsForAudience(input) {
      if (!validateInput(input)) return failure("validation_blocker");
      const { organizationId, requestedAudience, limit, afterClaimId } = input;
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      const evaluate = evaluator || evaluateClaimTraceabilityInTransaction;

      try {
        return await run(async (tx) => {
          await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");

          const eligibleClaims = [];
          let inspected = 0;
          let scanCursor = afterClaimId;
          let finalCandidateClaimId = null;
          let exhausted = false;

          while (eligibleClaims.length < limit + 1 && inspected < MAX_CANDIDATES) {
            const queryLimit = Math.min(BATCH_SIZE, MAX_CANDIDATES - inspected);
            const candidates = await readCandidateClaimIds(tx, {
              organizationId,
              afterClaimId: scanCursor,
              limit: queryLimit,
            });
            if (candidates.length === 0) {
              exhausted = true;
              break;
            }

            for (const candidate of candidates) {
              inspected += 1;
              scanCursor = candidate.claim_id;
              finalCandidateClaimId = candidate.claim_id;

              const result = await evaluate(tx, {
                organizationId,
                claimId: candidate.claim_id,
                requestedAudience,
              });
              if (isUnusableCandidateResult(result)) continue;
              if (!result.ok) return failure("conflict_current_state_changed");
              if (result.data.eligible === true) eligibleClaims.push(toEligibleClaim(result.data));
              if (eligibleClaims.length >= limit + 1 || inspected >= MAX_CANDIDATES) break;
            }

            if (candidates.length < queryLimit) {
              exhausted = true;
              break;
            }
          }

          if (eligibleClaims.length >= limit + 1) {
            const returnedClaims = eligibleClaims.slice(0, limit);
            return success({
              requestedAudience,
              eligibleClaims: returnedClaims,
              limit,
              afterClaimId,
              truncated: true,
              nextAfterClaimId: returnedClaims[returnedClaims.length - 1].claimId,
            });
          }

          if (exhausted) {
            return success({
              requestedAudience,
              eligibleClaims,
              limit,
              afterClaimId,
              truncated: false,
              nextAfterClaimId: null,
            });
          }

          return success({
            requestedAudience,
            eligibleClaims: eligibleClaims.slice(0, limit),
            limit,
            afterClaimId,
            truncated: true,
            nextAfterClaimId: finalCandidateClaimId,
          });
        });
      } catch (error) {
        return shapeError(error);
      }
    },
  });
}

export const __eligibleClaimsForAudienceRepositoryContract = Object.freeze({
  BATCH_SIZE,
  MAX_CANDIDATES,
  REQUESTED_AUDIENCES,
});
