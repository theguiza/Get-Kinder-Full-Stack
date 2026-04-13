import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFundingPoolCandidates,
  normalizePoolSlug,
  parseScopedPoolSlug,
  pickBestFundingPool,
} from "../services/poolRoutingService.js";

test("buildFundingPoolCandidates prefers scoped pool and then global pool", () => {
  assert.deepEqual(buildFundingPoolCandidates({ ownerUserId: 46, poolSlug: "general" }), [
    "u46__general",
    "general",
  ]);
});

test("buildFundingPoolCandidates preserves scoped input without double-scoping", () => {
  assert.deepEqual(buildFundingPoolCandidates({ ownerUserId: 46, poolSlug: "u46__general" }), [
    "u46__general",
    "general",
  ]);
  assert.deepEqual(parseScopedPoolSlug("u46__general"), {
    ownerKey: "46",
    basePoolSlug: "general",
    scopedPoolSlug: "u46__general",
  });
});

test("normalizePoolSlug falls back to general for invalid values", () => {
  assert.equal(normalizePoolSlug(""), "general");
  assert.equal(normalizePoolSlug("bad slug"), "general");
});

test("pickBestFundingPool keeps scoped pool when it can fully fund the shift", () => {
  const selected = pickBestFundingPool(
    [
      { poolSlug: "u46__general", poolBalance: 50 },
      { poolSlug: "general", poolBalance: 500 },
    ],
    20
  );

  assert.equal(selected.poolSlug, "u46__general");
});

test("pickBestFundingPool falls back to global pool when scoped pool is short", () => {
  const selected = pickBestFundingPool(
    [
      { poolSlug: "u46__general", poolBalance: 10 },
      { poolSlug: "general", poolBalance: 500 },
    ],
    20
  );

  assert.equal(selected.poolSlug, "general");
});

test("pickBestFundingPool chooses the larger balance when neither pool can fully fund", () => {
  const selected = pickBestFundingPool(
    [
      { poolSlug: "u46__general", poolBalance: 12 },
      { poolSlug: "general", poolBalance: 18 },
    ],
    30
  );

  assert.equal(selected.poolSlug, "general");
});
