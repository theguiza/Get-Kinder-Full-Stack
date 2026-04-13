import test from "node:test";
import assert from "node:assert/strict";

import pool from "../Backend/db/pg.js";
import {
  applyManualDonationAllocation,
  buildDonationReviewNotification,
  runDueDonationPolicyAllocations,
  sendDonationReviewNotification,
} from "../services/donationAllocationService.js";

function createAllocationClientHarness({
  reviews = [],
  fundingCredits = [],
  organizations = [],
  events = [],
  policyEventCandidates = [],
  policyOrganizationCandidates = [],
} = {}) {
  const state = {
    reviews: reviews.map((row) => ({ ...row })),
    fundingCredits: fundingCredits.map((row) => ({ ...row })),
    organizations: organizations.map((row) => ({ ...row })),
    events: events.map((row) => ({ ...row })),
    policyEventCandidates: policyEventCandidates.map((row) => ({ ...row })),
    policyOrganizationCandidates: policyOrganizationCandidates.map((row) => ({ ...row })),
    updates: [],
  };

  const client = {
    async query(rawSql, params = []) {
      const sql = typeof rawSql === "string" ? rawSql : rawSql?.text ?? "";
      const trimmed = sql.trim();

      if (trimmed.startsWith("SELECT id, name") && trimmed.includes("FROM public.organizations")) {
        const org = state.organizations.find((row) => Number(row.id) === Number(params[0]));
        return { rows: org ? [org] : [], rowCount: org ? 1 : 0 };
      }

      if (
        trimmed.startsWith("SELECT")
        && trimmed.includes("FROM public.events e")
        && !trimmed.includes("org_pool_balance")
        && !trimmed.includes("active_events_count")
      ) {
        const event = state.events.find((row) => String(row.id) === String(params[0]));
        return { rows: event ? [event] : [], rowCount: event ? 1 : 0 };
      }

      if (trimmed.startsWith("SELECT id, donation_id, status") && trimmed.includes("FOR UPDATE")) {
        const review = state.reviews.find((row) => Number(row.id) === Number(params[0]));
        return { rows: review ? [review] : [], rowCount: review ? 1 : 0 };
      }

      if (trimmed.startsWith("UPDATE public.funding_credits")) {
        const donationId = Number(params[0]);
        const updated = state.fundingCredits
          .filter((row) => Number(row.donation_id) === donationId)
          .map((row) => {
            if (trimmed.includes("SET scope_type = $2")) {
              row.scope_type = params[1];
              row.organization_id = params[2];
              row.event_id = params[3];
              row.allocation_status = "available";
              row.metadata = { ...(row.metadata || {}), ...JSON.parse(params[4]) };
            } else {
              row.scope_type = "unrestricted";
              row.organization_id = null;
              row.event_id = null;
              row.allocation_status = "available";
              row.metadata = { ...(row.metadata || {}), ...JSON.parse(params[1]) };
            }
            return { id: row.id };
          });
        return { rows: updated, rowCount: updated.length };
      }

      if (trimmed.startsWith("UPDATE public.donation_allocation_reviews") && trimmed.includes("SET status = 'manually_allocated'")) {
        const review = state.reviews.find((row) => Number(row.id) === Number(params[0]));
        if (!review) return { rows: [], rowCount: 0 };
        Object.assign(review, {
          status: "manually_allocated",
          manual_target_type: params[1],
          manual_target_org_id: params[2],
          manual_target_event_id: params[3],
          reviewed_by_user_id: params[4],
          notes: params[5],
        });
        return { rows: [review], rowCount: 1 };
      }

      if (trimmed.startsWith("SELECT id, donation_id, status, review_due_at")) {
        const review = state.reviews.find((row) => Number(row.id) === Number(params[0]));
        return { rows: review ? [review] : [], rowCount: review ? 1 : 0 };
      }

      if (trimmed.startsWith("UPDATE public.donation_allocation_reviews") && trimmed.includes("SET status = 'policy_allocated'")) {
        const review = state.reviews.find((row) => Number(row.id) === Number(params[0]));
        if (!review) return { rows: [], rowCount: 0 };
        Object.assign(review, {
          status: "policy_allocated",
          manual_target_type: params[1],
          manual_target_org_id: params[2],
          manual_target_event_id: params[3],
          policy_reason_code: params[4],
        });
        return { rows: [review], rowCount: 1 };
      }

      if (trimmed.startsWith("UPDATE public.donation_allocation_reviews") && trimmed.includes("SET policy_reason_code = $2")) {
        const review = state.reviews.find((row) => Number(row.id) === Number(params[0]));
        if (!review) return { rows: [], rowCount: 0 };
        Object.assign(review, {
          policy_reason_code: params[1],
        });
        return { rows: [review], rowCount: 1 };
      }

      if (trimmed.startsWith("BEGIN") || trimmed.startsWith("COMMIT") || trimmed.startsWith("ROLLBACK")) {
        state.updates.push(trimmed);
        return { rows: [], rowCount: 0 };
      }

      if (trimmed.startsWith("SELECT id") && trimmed.includes("FROM public.donation_allocation_reviews") && trimmed.includes("FOR UPDATE SKIP LOCKED")) {
        const now = new Date(params[0]).getTime();
        const limit = Number(params[1]);
        const rows = state.reviews
          .filter((row) => row.status === "pending_manual_review" && new Date(row.review_due_at).getTime() <= now)
          .slice(0, limit)
          .map((row) => ({ id: row.id }));
        return { rows, rowCount: rows.length };
      }

      if (trimmed.startsWith("SELECT") && trimmed.includes("FROM public.donation_allocation_reviews dar") && trimmed.includes("JOIN public.donations d")) {
        const review = state.reviews.find((row) => Number(row.id) === Number(params[0]));
        return { rows: review ? [review] : [], rowCount: review ? 1 : 0 };
      }

      if (trimmed.startsWith("SELECT") && trimmed.includes("FROM public.events e") && trimmed.includes("organization_id") && trimmed.includes("org_pool_balance")) {
        return { rows: state.policyEventCandidates, rowCount: state.policyEventCandidates.length };
      }

      if (trimmed.startsWith("SELECT") && trimmed.includes("FROM public.organizations o") && trimmed.includes("active_events_count")) {
        return { rows: state.policyOrganizationCandidates, rowCount: state.policyOrganizationCandidates.length };
      }

      if (trimmed.startsWith("UPDATE public.donation_allocation_reviews") && trimmed.includes("SET notification_sent_at = NOW()")) {
        const review = state.reviews.find((row) => Number(row.id) === Number(params[0]));
        if (!review) return { rows: [], rowCount: 0 };
        review.notification_sent_to = params[1];
        review.notification_sent_at = "sent-now";
        review.last_notification_error = null;
        return { rows: [], rowCount: 1 };
      }

      if (trimmed.startsWith("UPDATE public.donation_allocation_reviews") && trimmed.includes("SET last_notification_error =")) {
        const review = state.reviews.find((row) => Number(row.id) === Number(params[0]));
        if (!review) return { rows: [], rowCount: 0 };
        review.last_notification_error = params[1];
        return { rows: [], rowCount: 1 };
      }

      if (trimmed.startsWith("SELECT id") && trimmed.includes("WHERE donation_id = $1")) {
        const review = state.reviews.find((row) => Number(row.donation_id) === Number(params[0]));
        return { rows: review ? [{ id: review.id }] : [], rowCount: review ? 1 : 0 };
      }

      throw new Error(`Unhandled client query: ${trimmed}`);
    },
    release() {},
  };

  return { client, state };
}

test("buildDonationReviewNotification includes admin review context", () => {
  const message = buildDonationReviewNotification({
    reviewId: 3,
    donationId: 44,
    amountCents: 5000,
    currency: "CAD",
    donorEmail: "donor@example.com",
    reviewDueAt: "2026-04-12T18:00:00.000Z",
    poolSlug: "general",
  });

  assert.match(message.subject, /Donation review needed/);
  assert.match(message.text, /Donation ID: 44/);
  assert.match(message.html, /donor@example.com/);
});

test("applyManualDonationAllocation retargets held donation funding credits", async () => {
  const harness = createAllocationClientHarness({
    reviews: [{ id: 9, donation_id: 100, status: "pending_manual_review" }],
    fundingCredits: [{ id: 1, donation_id: 100, scope_type: "unrestricted", metadata: {} }],
    organizations: [{ id: 7, name: "OARCA" }],
  });

  const result = await applyManualDonationAllocation(harness.client, {
    reviewId: 9,
    targetType: "org",
    targetOrgId: 7,
    reviewedByUserId: 46,
    notes: "Assigned to pilot org",
  });

  assert.equal(result.updatedFundingCredits, 1);
  assert.equal(harness.state.reviews[0].status, "manually_allocated");
  assert.equal(harness.state.fundingCredits[0].scope_type, "org");
  assert.equal(harness.state.fundingCredits[0].organization_id, 7);
  assert.equal(harness.state.fundingCredits[0].metadata.allocation_mode, "manual");
});

test("runDueDonationPolicyAllocations releases overdue pending reviews to unrestricted", async () => {
  const harness = createAllocationClientHarness({
    reviews: [
      { id: 1, donation_id: 10, status: "pending_manual_review", review_due_at: "2026-04-08T10:00:00.000Z" },
      { id: 2, donation_id: 11, status: "pending_manual_review", review_due_at: "2026-04-10T10:00:00.000Z" },
    ],
    fundingCredits: [
      { id: 1, donation_id: 10, scope_type: "unrestricted", metadata: {} },
      { id: 2, donation_id: 11, scope_type: "unrestricted", metadata: {} },
    ],
    policyOrganizationCandidates: [
      {
        id: 7,
        name: "Downtown Food Bank",
        org_status: "approved",
        funding_class: "mission_priority",
        subsidy_eligible: false,
        manual_override_only: false,
        current_balance: 5,
      },
    ],
  });

  const originalConnect = pool.connect;
  pool.connect = async () => harness.client;

  try {
    const result = await runDueDonationPolicyAllocations({
      now: "2026-04-09T10:00:00.000Z",
      limit: 10,
    });

    assert.equal(result.processedCount, 1);
    assert.equal(harness.state.reviews[0].status, "policy_allocated");
    assert.equal(harness.state.reviews[0].manual_target_type, "org");
    assert.equal(harness.state.reviews[0].manual_target_org_id, 7);
    assert.equal(harness.state.reviews[1].status, "pending_manual_review");
    assert.equal(harness.state.fundingCredits[0].metadata.allocation_mode, "policy");
    assert.equal(harness.state.fundingCredits[0].scope_type, "org");
  } finally {
    pool.connect = originalConnect;
  }
});

test("runDueDonationPolicyAllocations leaves donations pending when no eligible policy target exists", async () => {
  const harness = createAllocationClientHarness({
    reviews: [
      { id: 3, donation_id: 12, status: "pending_manual_review", review_due_at: "2026-04-08T10:00:00.000Z" },
    ],
    fundingCredits: [
      { id: 3, donation_id: 12, scope_type: "unrestricted", metadata: {} },
    ],
    policyOrganizationCandidates: [
      {
        id: 9,
        name: "Commercial Org",
        org_status: "approved",
        funding_class: "commercial",
        subsidy_eligible: true,
        manual_override_only: false,
        current_balance: 0,
      },
    ],
  });

  const originalConnect = pool.connect;
  pool.connect = async () => harness.client;

  try {
    const result = await runDueDonationPolicyAllocations({
      now: "2026-04-09T10:00:00.000Z",
      limit: 10,
    });

    assert.equal(result.processedCount, 0);
    assert.equal(result.skippedCount, 1);
    assert.equal(harness.state.reviews[0].status, "pending_manual_review");
    assert.equal(harness.state.reviews[0].policy_reason_code, "policy_no_eligible_target");
    assert.equal(harness.state.fundingCredits[0].scope_type, "unrestricted");
  } finally {
    pool.connect = originalConnect;
  }
});

test("sendDonationReviewNotification sends once and records delivery", async () => {
  const harness = createAllocationClientHarness({
    reviews: [{
      id: 5,
      donation_id: 77,
      status: "pending_manual_review",
      review_due_at: "2026-04-12T10:00:00.000Z",
      notification_sent_at: null,
      amount_cents: 2500,
      currency: "CAD",
      donor_email: "donor@example.com",
      pool_slug: "general",
    }],
  });

  const originalConnect = pool.connect;
  pool.connect = async () => harness.client;

  const sentMessages = [];
  try {
    const result = await sendDonationReviewNotification({
      reviewId: 5,
      sendEmail: async (message) => {
        sentMessages.push(message);
        return { messageId: "msg-1" };
      },
    });

    assert.equal(result.sent, true);
    assert.equal(sentMessages.length, 1);
    assert.equal(harness.state.reviews[0].notification_sent_to, "kai@getkinder.ai");
  } finally {
    pool.connect = originalConnect;
  }
});
