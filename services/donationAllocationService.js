import pool from "../Backend/db/pg.js";
import { sendNudgeEmail } from "../kindnessEmailer.js";
import { resolvePolicyDonationTarget } from "./donationPolicyService.js";

const DONATION_REVIEW_STATUS_SET = new Set([
  "pending_manual_review",
  "manually_allocated",
  "policy_allocated",
  "cancelled",
]);

const DONATION_TARGET_TYPE_SET = new Set(["org", "event", "unrestricted"]);
const REVIEW_NOTIFICATION_EMAIL = process.env.DONATION_REVIEW_EMAIL || "kai@getkinder.ai";

function toPositiveInteger(value) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function normalizeTargetType(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return DONATION_TARGET_TYPE_SET.has(normalized) ? normalized : null;
}

function buildAdminReviewUrl(reviewId) {
  const baseUrl = String(process.env.APP_BASE_URL || "https://getkinder.ai").trim().replace(/\/+$/, "");
  return reviewId ? `${baseUrl}/admin?tab=donors&review=${reviewId}` : `${baseUrl}/admin`;
}

function formatCurrency(amountCents, currency = "CAD") {
  const amount = Number(amountCents) || 0;
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: currency || "CAD",
    minimumFractionDigits: 2,
  }).format(amount / 100);
}

function formatDateTime(value) {
  if (!value) return "No review deadline";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "No review deadline";
  return date.toLocaleString("en-CA", {
    timeZone: "America/Vancouver",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function buildDonationReviewNotification({
  reviewId,
  donationId,
  amountCents,
  currency = "CAD",
  donorEmail = "",
  reviewDueAt = null,
  poolSlug = "general",
} = {}) {
  const amountText = formatCurrency(amountCents, currency);
  const dueText = formatDateTime(reviewDueAt);
  const donorLabel = donorEmail || "guest / unclaimed donor";
  const adminUrl = buildAdminReviewUrl(reviewId);
  const subject = `Donation review needed: ${amountText} donation #${donationId}`;
  const text = [
    "A donation is awaiting manual allocation review.",
    "",
    `Donation ID: ${donationId}`,
    `Amount: ${amountText}`,
    `Currency: ${currency || "CAD"}`,
    `Donor: ${donorLabel}`,
    `Pool slug: ${poolSlug || "general"}`,
    `Review due: ${dueText}`,
    "",
    `Review in admin: ${adminUrl}`,
  ].join("\n");
  const html = `
    <p>A donation is awaiting manual allocation review.</p>
    <ul>
      <li><strong>Donation ID:</strong> ${donationId}</li>
      <li><strong>Amount:</strong> ${amountText}</li>
      <li><strong>Currency:</strong> ${currency || "CAD"}</li>
      <li><strong>Donor:</strong> ${donorLabel}</li>
      <li><strong>Pool slug:</strong> ${poolSlug || "general"}</li>
      <li><strong>Review due:</strong> ${dueText}</li>
    </ul>
    <p><a href="${adminUrl}" target="_blank" rel="noopener">Open the donation review queue</a></p>
  `;

  return { subject, text, html };
}

async function fetchDonationReviewRow(client, reviewId) {
  const normalizedReviewId = toPositiveInteger(reviewId);
  if (!normalizedReviewId) return null;

  const { rows: [row] = [] } = await client.query(
    `
      SELECT
        dar.id,
        dar.donation_id,
        dar.status,
        dar.review_due_at,
        dar.notification_sent_at,
        dar.notification_sent_to,
        d.amount_cents,
        d.currency,
        donor.email AS donor_email,
        fc.metadata ->> 'pool_slug' AS pool_slug
      FROM public.donation_allocation_reviews dar
      JOIN public.donations d ON d.id = dar.donation_id
      LEFT JOIN public.userdata donor ON donor.id = d.donor_user_id
      LEFT JOIN public.funding_credits fc ON fc.donation_id = dar.donation_id
      WHERE dar.id = $1
      ORDER BY fc.id ASC NULLS LAST
      LIMIT 1
    `,
    [normalizedReviewId]
  );

  return row || null;
}

export async function sendDonationReviewNotification({
  reviewId = null,
  donationId = null,
  to = REVIEW_NOTIFICATION_EMAIL,
  sendEmail = sendNudgeEmail,
} = {}) {
  const normalizedReviewId = toPositiveInteger(reviewId);
  const normalizedDonationId = toPositiveInteger(donationId);
  const client = await pool.connect();
  try {
    let reviewRow = null;
    if (normalizedReviewId) {
      reviewRow = await fetchDonationReviewRow(client, normalizedReviewId);
    } else if (normalizedDonationId) {
      const { rows: [row] = [] } = await client.query(
        `
          SELECT id
          FROM public.donation_allocation_reviews
          WHERE donation_id = $1
          LIMIT 1
        `,
        [normalizedDonationId]
      );
      reviewRow = row?.id ? await fetchDonationReviewRow(client, row.id) : null;
    }

    if (!reviewRow) {
      return { sent: false, reason: "not_found" };
    }
    if (reviewRow.notification_sent_at) {
      return { sent: false, reason: "already_sent", reviewId: Number(reviewRow.id) };
    }

    const message = buildDonationReviewNotification({
      reviewId: Number(reviewRow.id),
      donationId: Number(reviewRow.donation_id),
      amountCents: reviewRow.amount_cents,
      currency: reviewRow.currency,
      donorEmail: reviewRow.donor_email || "",
      reviewDueAt: reviewRow.review_due_at,
      poolSlug: reviewRow.pool_slug || "general",
    });

    await sendEmail({
      to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      fromName: "Kinder Donations",
    });

    await client.query(
      `
        UPDATE public.donation_allocation_reviews
        SET notification_sent_at = NOW(),
            notification_sent_to = $2,
            last_notification_error = NULL,
            updated_at = NOW()
        WHERE id = $1
      `,
      [reviewRow.id, to]
    );

    return {
      sent: true,
      reviewId: Number(reviewRow.id),
      donationId: Number(reviewRow.donation_id),
      notifiedTo: to,
    };
  } catch (error) {
    if (normalizedReviewId) {
      try {
        await client.query(
          `
            UPDATE public.donation_allocation_reviews
            SET last_notification_error = $2,
                updated_at = NOW()
            WHERE id = $1
          `,
          [normalizedReviewId, String(error?.message || error)]
        );
      } catch (_) {}
    }
    throw error;
  } finally {
    client.release();
  }
}

async function resolveManualAllocationTarget(client, {
  targetType,
  targetOrgId = null,
  targetEventId = null,
} = {}) {
  const normalizedTargetType = normalizeTargetType(targetType);
  if (!normalizedTargetType) {
    throw new Error("invalid_target_type");
  }

  if (normalizedTargetType === "unrestricted") {
    return {
      targetType: normalizedTargetType,
      organizationId: null,
      eventId: null,
      targetLabel: "unrestricted",
    };
  }

  if (normalizedTargetType === "org") {
    const normalizedTargetOrgId = toPositiveInteger(targetOrgId);
    if (!normalizedTargetOrgId) throw new Error("invalid_target_org_id");
    const { rows: [organization] = [] } = await client.query(
      `
        SELECT id, name
        FROM public.organizations
        WHERE id = $1
        LIMIT 1
      `,
      [normalizedTargetOrgId]
    );
    if (!organization) throw new Error("target_org_not_found");
    return {
      targetType: normalizedTargetType,
      organizationId: Number(organization.id),
      eventId: null,
      targetLabel: organization.name || `org:${organization.id}`,
    };
  }

  const normalizedTargetEventId = typeof targetEventId === "string" && targetEventId.trim()
    ? targetEventId.trim()
    : null;
  if (!normalizedTargetEventId) throw new Error("invalid_target_event_id");

  const { rows: [event] = [] } = await client.query(
    `
      SELECT
        e.id,
        e.title,
        COALESCE(host.org_id, org.id) AS organization_id
      FROM public.events e
      LEFT JOIN public.userdata host ON host.id = e.creator_user_id
      LEFT JOIN public.organizations org ON org.rep_user_id = e.creator_user_id
      WHERE e.id = $1
      LIMIT 1
    `,
    [normalizedTargetEventId]
  );
  if (!event) throw new Error("target_event_not_found");

  return {
    targetType: normalizedTargetType,
    organizationId: toPositiveInteger(event.organization_id),
    eventId: event.id,
    targetLabel: event.title || `event:${event.id}`,
  };
}

function buildFundingCreditAllocationMetadata({
  allocationMode,
  targetType,
  targetLabel,
  reviewedByUserId = null,
  notes = null,
  policyReasonCode = null,
} = {}) {
  return {
    allocation_mode: allocationMode,
    allocation_target_type: targetType,
    allocation_target_label: targetLabel,
    reviewed_by_user_id: toPositiveInteger(reviewedByUserId),
    notes: notes || null,
    policy_reason_code: policyReasonCode || null,
    allocated_at: new Date().toISOString(),
  };
}

export async function applyManualDonationAllocation(client, {
  reviewId,
  targetType,
  targetOrgId = null,
  targetEventId = null,
  reviewedByUserId = null,
  notes = null,
} = {}) {
  if (!client || typeof client.query !== "function") {
    throw new TypeError("client with query() is required");
  }

  const normalizedReviewId = toPositiveInteger(reviewId);
  if (!normalizedReviewId) throw new Error("reviewId is required");

  const target = await resolveManualAllocationTarget(client, { targetType, targetOrgId, targetEventId });
  const { rows: [review] = [] } = await client.query(
    `
      SELECT id, donation_id, status
      FROM public.donation_allocation_reviews
      WHERE id = $1
      FOR UPDATE
    `,
    [normalizedReviewId]
  );
  if (!review) throw new Error("review_not_found");
  if (!DONATION_REVIEW_STATUS_SET.has(review.status) || review.status === "cancelled") {
    throw new Error("review_not_allocatable");
  }

  const metadata = buildFundingCreditAllocationMetadata({
    allocationMode: "manual",
    targetType: target.targetType,
    targetLabel: target.targetLabel,
    reviewedByUserId,
    notes,
  });

  const { rows: creditRows } = await client.query(
    `
      UPDATE public.funding_credits
      SET scope_type = $2,
          organization_id = $3,
          event_id = $4,
          allocation_status = 'available',
          metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
          updated_at = NOW()
      WHERE donation_id = $1
      RETURNING id
    `,
    [
      review.donation_id,
      target.targetType,
      target.organizationId,
      target.eventId,
      JSON.stringify(metadata),
    ]
  );

  const { rows: [updatedReview] = [] } = await client.query(
    `
      UPDATE public.donation_allocation_reviews
      SET status = 'manually_allocated',
          manual_target_type = $2,
          manual_target_org_id = $3,
          manual_target_event_id = $4,
          reviewed_by_user_id = $5,
          reviewed_at = NOW(),
          notes = $6,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      normalizedReviewId,
      target.targetType,
      target.organizationId,
      target.eventId,
      toPositiveInteger(reviewedByUserId),
      notes || null,
    ]
  );

  return {
    review: updatedReview || null,
    updatedFundingCredits: creditRows.length,
    target,
  };
}

export async function applyPolicyDonationAllocation(client, {
  reviewId,
  policyReasonCode = null,
} = {}) {
  if (!client || typeof client.query !== "function") {
    throw new TypeError("client with query() is required");
  }

  const normalizedReviewId = toPositiveInteger(reviewId);
  if (!normalizedReviewId) throw new Error("reviewId is required");

  const { rows: [review] = [] } = await client.query(
    `
      SELECT id, donation_id, status, review_due_at
      FROM public.donation_allocation_reviews
      WHERE id = $1
      FOR UPDATE
    `,
    [normalizedReviewId]
  );
  if (!review) throw new Error("review_not_found");
  if (review.status !== "pending_manual_review") {
    return { review, updatedFundingCredits: 0, skipped: true };
  }

  const target = await resolvePolicyDonationTarget(client, {});
  if (!target) {
    const unresolvedPolicyReasonCode = policyReasonCode || "policy_no_eligible_target";
    const { rows: [updatedReview] = [] } = await client.query(
      `
        UPDATE public.donation_allocation_reviews
        SET policy_reason_code = $2,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [normalizedReviewId, unresolvedPolicyReasonCode]
    );

    return {
      review: updatedReview || review,
      updatedFundingCredits: 0,
      skipped: true,
      skipReason: "no_eligible_target",
      target: null,
    };
  }

  const resolvedPolicyReasonCode = policyReasonCode || target.policyReasonCode;

  const metadata = buildFundingCreditAllocationMetadata({
    allocationMode: "policy",
    targetType: target.targetType,
    targetLabel: target.targetLabel,
    policyReasonCode: resolvedPolicyReasonCode,
  });

  const { rows: creditRows } = await client.query(
    `
      UPDATE public.funding_credits
      SET scope_type = $2,
          organization_id = $3,
          event_id = $4,
          allocation_status = 'available',
          metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
          updated_at = NOW()
      WHERE donation_id = $1
      RETURNING id
    `,
    [
      review.donation_id,
      target.targetType,
      target.organizationId,
      target.eventId,
      JSON.stringify(metadata),
    ]
  );

  const { rows: [updatedReview] = [] } = await client.query(
    `
      UPDATE public.donation_allocation_reviews
      SET status = 'policy_allocated',
          manual_target_type = $2,
          manual_target_org_id = $3,
          manual_target_event_id = $4,
          reviewed_by_user_id = NULL,
          reviewed_at = NOW(),
          policy_reason_code = $5,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      normalizedReviewId,
      target.targetType,
      target.organizationId,
      target.eventId,
      resolvedPolicyReasonCode,
    ]
  );

  return {
    review: updatedReview || null,
    updatedFundingCredits: creditRows.length,
    skipped: false,
    target,
  };
}

export async function runDueDonationPolicyAllocations({
  now = new Date(),
  limit = 50,
} = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
        SELECT id
        FROM public.donation_allocation_reviews
        WHERE status = 'pending_manual_review'
          AND review_due_at <= $1
        ORDER BY review_due_at ASC, id ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      `,
      [now, Math.max(1, Number(limit) || 50)]
    );

    const processed = [];
    const skipped = [];
    for (const row of rows) {
      const result = await applyPolicyDonationAllocation(client, {
        reviewId: row.id,
      });
      if (!result?.skipped) {
        processed.push({
          reviewId: Number(row.id),
          donationId: result?.review?.donation_id ? Number(result.review.donation_id) : null,
          updatedFundingCredits: result?.updatedFundingCredits || 0,
          targetType: result?.target?.targetType || null,
          targetLabel: result?.target?.targetLabel || null,
          policyReasonCode: result?.review?.policy_reason_code || result?.target?.policyReasonCode || null,
        });
      } else {
        skipped.push({
          reviewId: Number(row.id),
          donationId: result?.review?.donation_id ? Number(result.review.donation_id) : null,
          reason: result?.skipReason || "skipped",
          policyReasonCode: result?.review?.policy_reason_code || null,
        });
      }
    }

    await client.query("COMMIT");
    return {
      processedCount: processed.length,
      processed,
      skippedCount: skipped.length,
      skipped,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}
