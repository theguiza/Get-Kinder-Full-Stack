import pool from "../Backend/db/pg.js";

const DONATION_REVIEW_PENDING_STATUSES = new Set(["pending_manual_review"]);
const DONATION_REVIEW_ALLOCATED_STATUSES = new Set(["manually_allocated", "policy_allocated"]);
const FUNDING_ALLOCATED_STATUSES = new Set(["available", "allocated", "partially_spent", "spent"]);

async function resolveUserId(req) {
  if (req.user?.id) return String(req.user.id);
  if (req.user?.user_id) return String(req.user.user_id);
  if (!req.user?.email) throw new Error("Missing authenticated user email.");
  const { rows } = await pool.query(
    "SELECT id FROM public.userdata WHERE email=$1 LIMIT 1",
    [req.user.email]
  );
  if (!rows[0]) {
    throw new Error("User record not found.");
  }
  return String(rows[0].id);
}

function toSafeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseJsonMetadata(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function resolveDonorDonationStatus(row = {}) {
  const receiptCount = Math.max(0, toSafeNumber(row.receipt_count));
  const remainingIc = Math.max(0, toSafeNumber(row.funding_remaining_ic));
  const reviewStatus = typeof row.review_status === "string" ? row.review_status : null;
  const fundingAllocationStatus = typeof row.funding_allocation_status === "string"
    ? row.funding_allocation_status
    : null;

  if (receiptCount > 0) {
    if (remainingIc > 0) {
      return { code: "impact_underway", label: "Impact underway", tone: "progress" };
    }
    return { code: "impact_funded", label: "Impact funded", tone: "funded" };
  }

  if (
    DONATION_REVIEW_PENDING_STATUSES.has(reviewStatus)
    || fundingAllocationStatus === "held_pending_manual_review"
  ) {
    return { code: "pending_review", label: "Pending review", tone: "review" };
  }

  if (DONATION_REVIEW_ALLOCATED_STATUSES.has(reviewStatus)) {
    const label = reviewStatus === "policy_allocated"
      ? "Allocated by policy"
      : "Allocated manually";
    return { code: "allocated", label, tone: "allocated" };
  }
  if (FUNDING_ALLOCATED_STATUSES.has(fundingAllocationStatus)) {
    return { code: "allocated", label: "Allocated", tone: "allocated" };
  }

  return { code: "received", label: "Donation received", tone: "received" };
}

export function resolveDonorAllocationTarget(row = {}) {
  const fundingMetadata = parseJsonMetadata(row.funding_metadata);

  if (row.manual_target_type === "event") {
    return row.manual_target_event_title || fundingMetadata.allocation_target_label || null;
  }
  if (row.manual_target_type === "org") {
    return row.manual_target_org_name || fundingMetadata.allocation_target_label || null;
  }
  if (row.manual_target_type === "unrestricted") {
    return "unrestricted pool";
  }

  if (row.funding_scope_type === "event") {
    return row.funding_event_title || fundingMetadata.allocation_target_label || null;
  }
  if (row.funding_scope_type === "org") {
    return row.funding_org_name || fundingMetadata.allocation_target_label || null;
  }
  if (row.funding_scope_type === "unrestricted") {
    return "unrestricted pool";
  }

  return fundingMetadata.allocation_target_label || null;
}

export function buildDonorTimelineHeadline(row = {}, status = null, allocationTargetLabel = null) {
  const resolvedStatus = status || resolveDonorDonationStatus(row);
  const eventCount = Math.max(0, toSafeNumber(row.event_count));

  if (resolvedStatus.code === "impact_funded" || resolvedStatus.code === "impact_underway") {
    if (eventCount > 1) {
      return `${eventCount} volunteer shifts funded`;
    }
    return row.latest_event_title || row.event_title || `Donation #${row.donation_id}`;
  }

  if (resolvedStatus.code === "pending_review") {
    return `Donation #${row.donation_id} awaiting allocation`;
  }

  if (resolvedStatus.code === "allocated" && allocationTargetLabel) {
    return `Allocated to ${allocationTargetLabel}`;
  }

  return `Donation #${row.donation_id}`;
}

export async function getDonorSummary(req, res) {
  try {
    res.set("Cache-Control", "no-store");
    const userId = await resolveUserId(req);

    const { rows: [row] = [] } = await pool.query(
      `
      WITH my_donations AS (
        SELECT id, amount_cents, currency
          FROM donations
         WHERE donor_user_id = $1
           AND status = 'captured'
      ),
      credits_in AS (
        SELECT donation_id, SUM(amount_credits) AS credits_in
          FROM pool_transactions
         WHERE direction = 'credit'
           AND reason = 'donation_in'
           AND donation_id IN (SELECT id FROM my_donations)
         GROUP BY donation_id
      ),
      credits_out AS (
        SELECT donation_id, SUM(amount_credits) AS credits_out
          FROM pool_transactions
         WHERE direction = 'debit'
           AND reason = 'shift_out'
           AND donation_id IN (SELECT id FROM my_donations)
         GROUP BY donation_id
      ),
      allocation_receipts AS (
        SELECT
          fc.donation_id,
          fa.event_id,
          fa.wallet_tx_id,
          fa.amount_ic AS credits_funded,
          COALESCE(fa.minutes_funded, 0) AS minutes_verified,
          fa.created_at
        FROM public.funding_allocations fa
        JOIN public.funding_credits fc ON fc.id = fa.funding_credit_id
        WHERE fc.donation_id IN (SELECT id FROM my_donations)
        UNION ALL
        SELECT
          dr.donation_id,
          dr.event_id,
          dr.wallet_tx_id,
          dr.credits_funded,
          COALESCE(dr.minutes_verified, 0) AS minutes_verified,
          dr.created_at
        FROM public.donor_receipts dr
        WHERE dr.donation_id IN (SELECT id FROM my_donations)
          AND NOT EXISTS (
            SELECT 1
            FROM public.funding_allocations fa
            WHERE fa.donor_receipt_id = dr.id
          )
      ),
      receipts AS (
        SELECT donation_id,
               SUM(credits_funded) AS credits_funded,
               SUM(minutes_verified) AS minutes_funded
          FROM allocation_receipts
         WHERE donation_id IN (SELECT id FROM my_donations)
         GROUP BY donation_id
      ),
      wallet_funding AS (
        SELECT
          wallet_tx_id,
          SUM(credits_funded) AS credits_funded,
          MAX(minutes_verified) AS minutes_verified
        FROM allocation_receipts
        GROUP BY wallet_tx_id
      ),
      deficit AS (
        SELECT
          SUM(GREATEST(wt.kind_amount - COALESCE(wf.credits_funded, 0), 0)) AS deficit_credits,
          SUM(
            CASE WHEN wt.kind_amount - COALESCE(wf.credits_funded, 0) > 0
                 THEN COALESCE(wf.minutes_verified, 0)
                 ELSE 0 END
          ) AS deficit_minutes
          FROM wallet_funding wf
          JOIN wallet_transactions wt ON wt.id = wf.wallet_tx_id
         WHERE wt.reason = 'earn_shift'
           AND wt.direction = 'credit'
           AND EXISTS (
             SELECT 1
             FROM allocation_receipts ar
             WHERE ar.wallet_tx_id = wf.wallet_tx_id
               AND ar.donation_id IN (SELECT id FROM my_donations)
           )
      ),
      ic AS (
        SELECT COALESCE(SUM(ic_amount), 0) AS ic_balance
          FROM donor_ic_ledger
         WHERE donor_user_id = $1
           AND expires_at > NOW()
      ),
      profile AS (
        SELECT donor_tier, created_at AS member_since
          FROM userdata
         WHERE id = $1
         LIMIT 1
      ),
      status_rollup AS (
        SELECT
          d.id AS donation_id,
          COALESCE(rs.receipt_count, 0) AS receipt_count,
          COALESCE(fc.remaining_ic, 0) AS funding_remaining_ic,
          dar.status AS review_status,
          fc.allocation_status AS funding_allocation_status
        FROM my_donations d
        LEFT JOIN (
          SELECT donation_id, COUNT(*) AS receipt_count
          FROM allocation_receipts
          WHERE donation_id IN (SELECT id FROM my_donations)
          GROUP BY donation_id
        ) rs ON rs.donation_id = d.id
        LEFT JOIN public.donation_allocation_reviews dar ON dar.donation_id = d.id
        LEFT JOIN LATERAL (
          SELECT remaining_ic, allocation_status
          FROM public.funding_credits
          WHERE donation_id = d.id
          ORDER BY id ASC
          LIMIT 1
        ) fc ON TRUE
      )
      SELECT
        (SELECT COALESCE(SUM(amount_cents), 0) FROM my_donations)          AS donated_lifetime_cents,
        (SELECT COUNT(*) FROM my_donations)                                 AS donations_count,
        (SELECT COALESCE(SUM(credits_funded), 0) FROM receipts)            AS credits_funded_lifetime,
        (SELECT COALESCE(SUM(minutes_funded), 0) FROM receipts)            AS minutes_funded_lifetime,
        (SELECT COALESCE(SUM(credits_in), 0) FROM credits_in)              AS credits_in_total,
        (SELECT COALESCE(SUM(credits_out), 0) FROM credits_out)            AS credits_out_total,
        (SELECT COALESCE(deficit_credits, 0) FROM deficit)                 AS deficit_credits_total,
        (SELECT COALESCE(deficit_minutes, 0) FROM deficit)                 AS deficit_minutes_total,
        (SELECT ic_balance FROM ic)                                         AS ic_balance,
        (SELECT donor_tier FROM profile)                                    AS donor_tier,
        (SELECT member_since FROM profile)                                  AS member_since,
        (
          SELECT COUNT(*)
          FROM status_rollup
          WHERE receipt_count = 0
            AND (
              review_status = 'pending_manual_review'
              OR funding_allocation_status = 'held_pending_manual_review'
            )
        )                                                                   AS pending_review_count,
        (
          SELECT COUNT(*)
          FROM status_rollup
          WHERE receipt_count = 0
            AND review_status IN ('manually_allocated', 'policy_allocated')
        )                                                                   AS allocated_count,
        (
          SELECT COUNT(*)
          FROM status_rollup
          WHERE receipt_count > 0
            AND funding_remaining_ic > 0
        )                                                                   AS impact_underway_count,
        (
          SELECT COUNT(*)
          FROM status_rollup
          WHERE receipt_count > 0
            AND funding_remaining_ic <= 0
        )                                                                   AS impact_funded_count
      `,
      [userId]
    );

    const IC_RATES = { casual: 5, impact: 7, champion: 10 };
    const MILESTONE_TARGET_HOURS = 50;

    const donatedCents = Number(row?.donated_lifetime_cents) || 0;
    const donationsCount = Number(row?.donations_count) || 0;
    const creditsFunded = Number(row?.credits_funded_lifetime) || 0;
    const minutesFunded = Number(row?.minutes_funded_lifetime) || 0;
    const creditsIn = Number(row?.credits_in_total) || 0;
    const creditsRemaining = Math.max(0, creditsIn - creditsFunded);
    const hoursFunded = Math.round((minutesFunded / 60) * 10) / 10;
    const deficitCredits = Number(row?.deficit_credits_total) || 0;
    const deficitHours = Math.round(((Number(row?.deficit_minutes_total) || 0) / 60) * 10) / 10;
    const icBalance = Number(row?.ic_balance) || 0;
    const donorTier = row?.donor_tier || "casual";
    const icRate = IC_RATES[donorTier] ?? 5;
    const memberSince = row?.member_since || null;
    const pendingReviewCount = Number(row?.pending_review_count) || 0;
    const allocatedCount = Number(row?.allocated_count) || 0;
    const impactUnderwayCount = Number(row?.impact_underway_count) || 0;
    const impactFundedCount = Number(row?.impact_funded_count) || 0;

    return res.json({
      ok: true,
      data: {
        donor_tier: donorTier,
        ic_rate: icRate,
        ic_balance: icBalance,
        kinder_balance: null,
        member_since: memberSince,
        milestone_target_hours: MILESTONE_TARGET_HOURS,
        milestone_progress_hours: hoursFunded,
        donated_cents_total: donatedCents,
        donation_count: donationsCount,
        credits_funded_total: creditsFunded,
        minutes_verified_total: minutesFunded,
        remaining_pool_credits: creditsRemaining,
        pending_deficit_credits_total: deficitCredits,
        pending_deficit_hours_total: deficitHours,
        donated_lifetime_cents: donatedCents,
        donations_count: donationsCount,
        credits_funded_lifetime: creditsFunded,
        minutes_funded_lifetime: minutesFunded,
        hours_funded_lifetime: hoursFunded,
        credits_remaining: creditsRemaining,
        credits_unused_balance: creditsRemaining,
        pending_review_count: pendingReviewCount,
        allocated_count: allocatedCount,
        impact_underway_count: impactUnderwayCount,
        impact_funded_count: impactFundedCount,
      },
    });
  } catch (err) {
    console.error("GET /api/donor/summary error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: "Unable to load donor summary." });
  }
}

export async function getDonorReceipts(req, res) {
  try {
    res.set("Cache-Control", "no-store");
    const userId = await resolveUserId(req);
    const parsedLimit = Number.parseInt(req.query?.limit, 10);
    const parsedOffset = Number.parseInt(req.query?.offset, 10);
    const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 25;
    const offset = Number.isInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;

    const { rows } = await pool.query(
      `
        WITH my_donations AS (
          SELECT
            d.id,
            d.amount_cents,
            d.currency,
            d.square_payment_id,
            d.created_at AS donation_created_at
          FROM public.donations d
          WHERE d.donor_user_id = $1
            AND d.status = 'captured'
        ),
        credit_summary AS (
          SELECT
            pt.donation_id,
            SUM(pt.amount_credits) AS credits_issued
          FROM public.pool_transactions pt
          WHERE pt.direction = 'credit'
            AND pt.reason = 'donation_in'
            AND pt.donation_id IN (SELECT id FROM my_donations)
          GROUP BY pt.donation_id
        ),
        allocation_receipts AS (
          SELECT
            fc.donation_id,
            fa.event_id,
            fa.wallet_tx_id,
            fa.amount_ic AS credits_funded,
            COALESCE(fa.minutes_funded, 0) AS minutes_verified,
            fa.created_at,
            fa.id AS receipt_id
          FROM public.funding_allocations fa
          JOIN public.funding_credits fc ON fc.id = fa.funding_credit_id
          WHERE fc.donation_id IN (SELECT id FROM my_donations)
          UNION ALL
          SELECT
            dr.donation_id,
            dr.event_id,
            dr.wallet_tx_id,
            dr.credits_funded,
            COALESCE(dr.minutes_verified, 0) AS minutes_verified,
            dr.created_at,
            dr.id AS receipt_id
          FROM public.donor_receipts dr
          WHERE dr.donation_id IN (SELECT id FROM my_donations)
            AND NOT EXISTS (
              SELECT 1
              FROM public.funding_allocations fa
              WHERE fa.donor_receipt_id = dr.id
            )
        ),
        receipt_summary AS (
          SELECT
            ar.donation_id,
            COUNT(*) AS receipt_count,
            COUNT(DISTINCT ar.event_id) AS event_count,
            SUM(ar.credits_funded) AS credits_funded,
            SUM(COALESCE(ar.minutes_verified, 0)) AS minutes_verified,
            MAX(ar.created_at) AS latest_receipt_at
          FROM allocation_receipts ar
          GROUP BY ar.donation_id
        ),
        latest_receipt_event AS (
          SELECT DISTINCT ON (ar.donation_id)
            ar.donation_id,
            ar.event_id,
            e.title AS event_title,
            e.start_at AS event_start_at,
            e.end_at AS event_end_at
          FROM allocation_receipts ar
          LEFT JOIN public.events e ON e.id = ar.event_id
          ORDER BY ar.donation_id, ar.created_at DESC, ar.receipt_id DESC
        ),
        donor_ic AS (
          SELECT
            donation_id,
            SUM(ic_amount) AS ic_earned
          FROM public.donor_ic_ledger
          WHERE donor_user_id = $1
            AND donation_id IN (SELECT id FROM my_donations)
          GROUP BY donation_id
        ),
        reviews AS (
          SELECT
            dar.donation_id,
            dar.id AS review_id,
            dar.status AS review_status,
            dar.review_due_at,
            dar.reviewed_at,
            dar.manual_target_type,
            dar.policy_reason_code,
            dar.notes,
            dar.notification_sent_at,
            dar.notification_sent_to,
            manual_org.name AS manual_target_org_name,
            manual_event.title AS manual_target_event_title
          FROM public.donation_allocation_reviews dar
          LEFT JOIN public.organizations manual_org ON manual_org.id = dar.manual_target_org_id
          LEFT JOIN public.events manual_event ON manual_event.id = dar.manual_target_event_id
          WHERE dar.donation_id IN (SELECT id FROM my_donations)
        ),
        funding AS (
          SELECT DISTINCT ON (fc.donation_id)
            fc.donation_id,
            fc.id AS funding_credit_id,
            fc.scope_type AS funding_scope_type,
            fc.organization_id AS funding_organization_id,
            fc.event_id AS funding_event_id,
            fc.amount_ic AS funding_amount_ic,
            fc.remaining_ic AS funding_remaining_ic,
            fc.allocation_status AS funding_allocation_status,
            fc.metadata AS funding_metadata
          FROM public.funding_credits fc
          WHERE fc.donation_id IN (SELECT id FROM my_donations)
          ORDER BY fc.donation_id, fc.id ASC
        )
        SELECT
          d.id                AS donation_id,
          d.amount_cents,
          d.currency,
          d.square_payment_id,
          d.donation_created_at,
          COALESCE(cs.credits_issued, 0) AS credits_issued,
          COALESCE(rs.receipt_count, 0) AS receipt_count,
          COALESCE(rs.event_count, 0) AS event_count,
          COALESCE(rs.credits_funded, 0) AS credits_funded,
          COALESCE(rs.minutes_verified, 0) AS minutes_verified,
          rs.latest_receipt_at,
          le.event_id AS latest_event_id,
          le.event_title AS latest_event_title,
          le.event_start_at,
          le.event_end_at,
          COALESCE(dic.ic_earned, 0) AS ic_earned,
          rv.review_id,
          rv.review_status,
          rv.review_due_at,
          rv.reviewed_at,
          rv.manual_target_type,
          rv.policy_reason_code,
          rv.notes,
          rv.notification_sent_at,
          rv.notification_sent_to,
          rv.manual_target_org_name,
          rv.manual_target_event_title,
          fc.funding_credit_id,
          fc.funding_scope_type,
          fc.funding_organization_id,
          fc.funding_event_id,
          fc.funding_amount_ic,
          fc.funding_remaining_ic,
          fc.funding_allocation_status,
          fc.funding_metadata,
          funding_org.name AS funding_org_name,
          funding_event.title AS funding_event_title,
          GREATEST(
            d.donation_created_at,
            COALESCE(rs.latest_receipt_at, d.donation_created_at),
            COALESCE(rv.reviewed_at, d.donation_created_at)
          ) AS activity_at
        FROM my_donations d
        LEFT JOIN credit_summary cs ON cs.donation_id = d.id
        LEFT JOIN receipt_summary rs ON rs.donation_id = d.id
        LEFT JOIN latest_receipt_event le ON le.donation_id = d.id
        LEFT JOIN donor_ic dic ON dic.donation_id = d.id
        LEFT JOIN reviews rv ON rv.donation_id = d.id
        LEFT JOIN funding fc ON fc.donation_id = d.id
        LEFT JOIN public.organizations funding_org ON funding_org.id = fc.funding_organization_id
        LEFT JOIN public.events funding_event ON funding_event.id = fc.funding_event_id
        ORDER BY activity_at DESC, d.id DESC
        LIMIT $2 OFFSET $3
      `,
      [userId, limit, offset]
    );

    const items = (rows || []).map((row) => ({
      donation_id: row.donation_id,
      amount_cents: Number(row.amount_cents) || 0,
      currency: row.currency || "CAD",
      square_payment_id: row.square_payment_id || null,
      donation_date: row.donation_created_at,
      event_id: row.latest_event_id,
      event_title: row.latest_event_title || null,
      event_start_at: row.event_start_at || null,
      event_end_at: row.event_end_at || null,
      credits_issued: Number(row.credits_issued) || 0,
      receipt_count: Number(row.receipt_count) || 0,
      event_count: Number(row.event_count) || 0,
      credits_funded: Number(row.credits_funded) || 0,
      credits_remaining: Math.max(0, (Number(row.funding_remaining_ic) || 0)),
      minutes_verified: Number(row.receipt_count) > 0 ? Number(row.minutes_verified) || 0 : null,
      ic_earned: Number(row.ic_earned) || 0,
      review_id: row.review_id ? Number(row.review_id) : null,
      review_status: row.review_status || null,
      review_due_at: row.review_due_at || null,
      reviewed_at: row.reviewed_at || null,
      policy_reason_code: row.policy_reason_code || null,
      notes: row.notes || null,
      manual_target_type: row.manual_target_type || null,
      manual_target_org_name: row.manual_target_org_name || null,
      manual_target_event_title: row.manual_target_event_title || null,
      notification_sent_at: row.notification_sent_at || null,
      notification_sent_to: row.notification_sent_to || null,
      funding_credit_id: row.funding_credit_id ? Number(row.funding_credit_id) : null,
      funding_scope_type: row.funding_scope_type || null,
      funding_amount_ic: Number(row.funding_amount_ic) || 0,
      funding_remaining_ic: Number(row.funding_remaining_ic) || 0,
      funding_allocation_status: row.funding_allocation_status || null,
      funding_org_name: row.funding_org_name || null,
      funding_event_title: row.funding_event_title || null,
      funding_metadata: parseJsonMetadata(row.funding_metadata),
      activity_at: row.activity_at || row.donation_created_at,
      created_at: row.donation_created_at,
    }));

    const normalizedItems = items.map((item) => {
      const status = resolveDonorDonationStatus(item);
      const allocationTargetLabel = resolveDonorAllocationTarget(item);
      return {
        ...item,
        status: status.code,
        status_label: status.label,
        status_tone: status.tone,
        allocation_target_label: allocationTargetLabel,
        headline: buildDonorTimelineHeadline(item, status, allocationTargetLabel),
      };
    });

    const hasMore = normalizedItems.length === limit;
    const nextOffset = hasMore ? offset + limit : offset;

    return res.json({
      ok: true,
      data: {
        receipts: normalizedItems,
        limit,
        offset,
        next_offset: nextOffset,
        has_more: hasMore,
        // legacy keys
        items: normalizedItems,
      },
    });
  } catch (err) {
    console.error("GET /api/donor/receipts error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: "Unable to load donor receipts." });
  }
}
