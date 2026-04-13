import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_DONATION_REVIEW_WINDOW_HOURS,
  computeDonationReviewDueAt,
  openDonationAllocationReview,
} from "../services/donationReviewService.js";

function createDonationReviewClientHarness() {
  const state = {
    reviews: [],
  };

  return {
    state,
    client: {
      async query(rawSql, params = []) {
        const sql = typeof rawSql === "string" ? rawSql : rawSql?.text ?? "";
        const trimmed = sql.trim();

        if (trimmed.startsWith("INSERT INTO public.donation_allocation_reviews")) {
          const donationId = Number(params[0]);
          const existing = state.reviews.find((row) => row.donation_id === donationId);
          if (existing) {
            return { rows: [], rowCount: 0 };
          }

          const row = {
            id: state.reviews.length + 1,
            donation_id: donationId,
            status: "pending_manual_review",
            review_due_at: params[1],
            metadata: JSON.parse(params[2]),
          };
          state.reviews.push(row);
          return { rows: [row], rowCount: 1 };
        }

        if (trimmed.startsWith("SELECT *") && trimmed.includes("FROM public.donation_allocation_reviews")) {
          const donationId = Number(params[0]);
          const existing = state.reviews.find((row) => row.donation_id === donationId);
          return { rows: existing ? [existing] : [], rowCount: existing ? 1 : 0 };
        }

        throw new Error(`Unhandled client query: ${trimmed}`);
      },
    },
  };
}

test("computeDonationReviewDueAt uses the default review window", () => {
  const baseDate = new Date("2026-04-09T10:00:00.000Z");
  const dueAt = computeDonationReviewDueAt({ now: baseDate });

  assert.equal(
    dueAt.toISOString(),
    new Date(baseDate.getTime() + (DEFAULT_DONATION_REVIEW_WINDOW_HOURS * 60 * 60 * 1000)).toISOString(),
  );
});

test("openDonationAllocationReview is idempotent per donation", async () => {
  const harness = createDonationReviewClientHarness();

  const created = await openDonationAllocationReview(harness.client, {
    donationId: 44,
    metadata: { source: "donation" },
  });

  const fetched = await openDonationAllocationReview(harness.client, {
    donationId: 44,
  });

  assert.equal(created.created, true);
  assert.equal(fetched.created, false);
  assert.equal(harness.state.reviews.length, 1);
  assert.equal(fetched.row?.donation_id, 44);
});
