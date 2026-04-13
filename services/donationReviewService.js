export const DEFAULT_DONATION_REVIEW_WINDOW_HOURS = 72;

function toPositiveInteger(value) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function parseJsonMetadata(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function computeDonationReviewDueAt({
  now = new Date(),
  reviewWindowHours = DEFAULT_DONATION_REVIEW_WINDOW_HOURS,
} = {}) {
  const baseDate = now instanceof Date ? now : new Date(now);
  const baseTime = baseDate.getTime();
  if (Number.isNaN(baseTime)) {
    throw new Error("Invalid base date for donation review");
  }
  const hours = Number.isFinite(Number(reviewWindowHours)) && Number(reviewWindowHours) > 0
    ? Number(reviewWindowHours)
    : DEFAULT_DONATION_REVIEW_WINDOW_HOURS;
  return new Date(baseTime + (hours * 60 * 60 * 1000));
}

export async function openDonationAllocationReview(client, {
  donationId,
  reviewDueAt = null,
  metadata = {},
} = {}) {
  if (!client || typeof client.query !== "function") {
    throw new TypeError("client with query() is required");
  }

  const normalizedDonationId = toPositiveInteger(donationId);
  if (!normalizedDonationId) {
    throw new Error("donationId is required");
  }

  const dueAt = reviewDueAt || computeDonationReviewDueAt({});
  const normalizedMetadata = parseJsonMetadata(metadata);

  const { rows: [inserted] = [] } = await client.query(
    `
      INSERT INTO public.donation_allocation_reviews (
        donation_id,
        status,
        review_due_at,
        metadata
      )
      VALUES ($1, 'pending_manual_review', $2, $3::jsonb)
      ON CONFLICT (donation_id) DO NOTHING
      RETURNING *
    `,
    [normalizedDonationId, dueAt, JSON.stringify(normalizedMetadata)]
  );

  if (inserted) {
    return { created: true, row: inserted };
  }

  const { rows: [existing] = [] } = await client.query(
    `
      SELECT *
      FROM public.donation_allocation_reviews
      WHERE donation_id = $1
      LIMIT 1
    `,
    [normalizedDonationId]
  );

  return { created: false, row: existing || null };
}
