import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFundingCreditPayload,
  createFundingCredit,
  createFundingCreditFromSubscriptionTopup,
  resolveInitialFundingCreditStatus,
} from "../services/fundingCreditService.js";

function createFundingCreditClientHarness({ organizationIdForUser = null } = {}) {
  const state = {
    fundingCredits: [],
  };

  return {
    state,
    client: {
      async query(rawSql, params = []) {
        const sql = typeof rawSql === "string" ? rawSql : rawSql?.text ?? "";
        const trimmed = sql.trim();

        if (trimmed.startsWith("SELECT id") && trimmed.includes("FROM public.organizations")) {
          return {
            rows: organizationIdForUser ? [{ id: organizationIdForUser }] : [],
            rowCount: organizationIdForUser ? 1 : 0,
          };
        }

        if (trimmed.startsWith("INSERT INTO public.funding_credits")) {
          const originPoolTransactionId = Number(params[1]);
          const existing = state.fundingCredits.find(
            (row) => row.origin_pool_transaction_id === originPoolTransactionId,
          );
          if (existing) {
            return { rows: [], rowCount: 0 };
          }

          const row = {
            id: state.fundingCredits.length + 1,
            pool_id: Number(params[0]),
            origin_pool_transaction_id: originPoolTransactionId,
            source_type: params[2],
            scope_type: params[3],
            organization_id: params[4],
            event_id: params[5],
            donation_id: params[6],
            subscription_topup_id: params[7],
            amount_ic: Number(params[8]),
            remaining_ic: Number(params[9]),
            allocation_status: params[10],
            expires_at: params[11],
            created_by_user_id: params[12],
            metadata: JSON.parse(params[13]),
          };
          state.fundingCredits.push(row);
          return { rows: [row], rowCount: 1 };
        }

        if (trimmed.startsWith("SELECT *") && trimmed.includes("FROM public.funding_credits")) {
          const originPoolTransactionId = Number(params[0]);
          const existing = state.fundingCredits.find(
            (row) => row.origin_pool_transaction_id === originPoolTransactionId,
          );
          return { rows: existing ? [existing] : [], rowCount: existing ? 1 : 0 };
        }

        throw new Error(`Unhandled client query: ${trimmed}`);
      },
    },
  };
}

test("resolveInitialFundingCreditStatus holds donations for manual review", () => {
  assert.equal(resolveInitialFundingCreditStatus("donation"), "held_pending_manual_review");
  assert.equal(resolveInitialFundingCreditStatus("subscription"), "available");
});

test("buildFundingCreditPayload normalizes invalid values safely", () => {
  const payload = buildFundingCreditPayload({
    poolId: "12",
    originPoolTransactionId: "99",
    sourceType: "bad-value",
    scopeType: "bad-scope",
    amountIc: 25,
    remainingIc: 40,
    allocationStatus: "bad-status",
    createdByUserId: "7",
    metadata: ["bad"],
  });

  assert.equal(payload.poolId, 12);
  assert.equal(payload.originPoolTransactionId, 99);
  assert.equal(payload.sourceType, "reserve");
  assert.equal(payload.scopeType, "unrestricted");
  assert.equal(payload.amountIc, 25);
  assert.equal(payload.remainingIc, 25);
  assert.equal(payload.allocationStatus, "available");
  assert.equal(payload.createdByUserId, 7);
  assert.deepEqual(payload.metadata, {});
});

test("createFundingCredit is idempotent by origin pool transaction id", async () => {
  const harness = createFundingCreditClientHarness();

  const created = await createFundingCredit(harness.client, {
    poolId: 5,
    originPoolTransactionId: 41,
    sourceType: "admin_grant",
    scopeType: "org",
    organizationId: 9,
    amountIc: 60,
    metadata: { stage: "stage1_shadow_write" },
  });

  const fetched = await createFundingCredit(harness.client, {
    poolId: 5,
    originPoolTransactionId: 41,
    sourceType: "admin_grant",
    scopeType: "org",
    organizationId: 9,
    amountIc: 60,
  });

  assert.equal(created.created, true);
  assert.equal(fetched.created, false);
  assert.equal(harness.state.fundingCredits.length, 1);
  assert.equal(fetched.row?.origin_pool_transaction_id, 41);
});

test("createFundingCreditFromSubscriptionTopup resolves org ownership from rep user", async () => {
  const harness = createFundingCreditClientHarness({ organizationIdForUser: 77 });

  const result = await createFundingCreditFromSubscriptionTopup(harness.client, {
    poolId: 8,
    originPoolTransactionId: 55,
    subscriptionTopupId: 12,
    ownerUserId: 46,
    amountIc: 100,
    metadata: { pool_slug: "u46__general" },
  });

  assert.equal(result.created, true);
  assert.equal(result.row?.organization_id, 77);
  assert.equal(result.row?.scope_type, "org");
  assert.equal(result.row?.metadata?.scope_resolution_failed, false);
});
