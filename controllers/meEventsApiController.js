import pool from "../Backend/db/pg.js";

const TAB_QUERY = {
  upcoming: {
    filter: "AND e.status = 'published' AND (e.start_at IS NULL OR e.start_at > NOW())",
    order: "ORDER BY e.start_at ASC NULLS LAST",
  },
  past: {
    filter:
      "AND e.end_at IS NOT NULL AND e.end_at <= NOW() AND e.status IN ('published','completed','cancelled')",
    order: "ORDER BY e.end_at DESC NULLS LAST",
  },
  drafts: {
    filter: "AND e.status = 'draft'",
    order: "ORDER BY e.updated_at DESC NULLS LAST, e.created_at DESC",
  },
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_POOL_SLUG = "general";
const ALL_POOLS_FILTER = "all";
const POOL_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FUNDING_STATE_SET = new Set(["any", "funded", "deficit", "unfunded"]);
const TOPUP_SOURCE_SET = new Set(["org_allocation", "subscription"]);
const TOPUP_SOURCE_REASON = {
  org_allocation: "org_topup",
  subscription: "subscription_topup",
};
const MAX_TOPUP_CREDITS = 1_000_000;
const POOL_SCOPE_SEP = "__";
const TX_REASON_LABELS = {
  donation_in: "Donation Received",
  shift_out: "Volunteer Shift Funded",
  manual_adjust: "Manual Adjustment",
  org_topup: "Org Allocation Top-Up",
  subscription_topup: "Subscription Top-Up",
};
const TX_REASON_SET = new Set(Object.keys(TX_REASON_LABELS));

const FALLBACK_MY_EVENTS = [
  {
    id: "demo-1",
    title: "Community Coffee Drop-In",
    start_at: "2025-01-05T10:00:00-08:00",
    end_at: "2025-01-05T12:00:00-08:00",
    tz: "America/Vancouver",
    location_text: "Kind Grounds, Kitsilano",
    visibility: "public",
    capacity: 24,
    status: "published",
    reward_pool_kind: 50,
    funding_pool_slug: "general",
    verified_credits_total: 0,
    funded_credits_total: 0,
    deficit_credits_total: 0,
    rsvp_counts: { accepted: 12 },
  },
  {
    id: "demo-2",
    title: "Sunset Plog & Picnic",
    start_at: "2025-01-09T17:30:00-08:00",
    end_at: "2025-01-09T19:00:00-08:00",
    tz: "America/Vancouver",
    location_text: "Jericho Beach",
    visibility: "fof",
    capacity: 40,
    status: "draft",
    reward_pool_kind: 0,
    funding_pool_slug: "general",
    verified_credits_total: 0,
    funded_credits_total: 0,
    deficit_credits_total: 0,
    rsvp_counts: { accepted: 0 },
  },
];

function clampLimit(value) {
  const num = Number(value);
  const fallback = Number.isFinite(num) ? num : DEFAULT_LIMIT;
  return Math.min(Math.max(fallback, 1), MAX_LIMIT);
}

function clampOffset(value) {
  const num = Number(value);
  return Math.max(Number.isFinite(num) ? num : 0, 0);
}

function normalizeFundingPoolSlug(value, { allowAll = false } = {}) {
  const slug = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!slug) return allowAll ? ALL_POOLS_FILTER : DEFAULT_POOL_SLUG;
  if (allowAll && slug === ALL_POOLS_FILTER) return ALL_POOLS_FILTER;
  return POOL_SLUG_RE.test(slug) ? slug : allowAll ? ALL_POOLS_FILTER : DEFAULT_POOL_SLUG;
}

function normalizeFundingState(value) {
  const state = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!state) return "any";
  return FUNDING_STATE_SET.has(state) ? state : "any";
}

function parseFundingPoolSlugForWrite(value) {
  const slug = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!slug) return DEFAULT_POOL_SLUG;
  if (!POOL_SLUG_RE.test(slug)) {
    const err = new Error("Funding pool slug must be lowercase letters/numbers and may include - or _ (max 64 chars).");
    err.statusCode = 400;
    throw err;
  }
  return slug;
}

function parseTopupAmount(value) {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_TOPUP_CREDITS) {
    const err = new Error(`amount_credits must be an integer between 1 and ${MAX_TOPUP_CREDITS}.`);
    err.statusCode = 400;
    throw err;
  }
  return amount;
}

function normalizeTopupSource(value) {
  const source = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!source) return "org_allocation";
  if (!TOPUP_SOURCE_SET.has(source)) {
    const err = new Error("source must be one of: org_allocation, subscription.");
    err.statusCode = 400;
    throw err;
  }
  return source;
}

function normalizeTxReasonFilter(value) {
  const reason = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!reason || reason === "all") return "all";
  return TX_REASON_SET.has(reason) ? reason : "all";
}

function isAdminEmail(email) {
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(email) && list.includes(String(email).toLowerCase());
}

function buildScopedPoolSlug(userId, poolSlug) {
  const owner = String(userId || "").trim();
  if (!owner) return poolSlug;
  return `u${owner}${POOL_SCOPE_SEP}${poolSlug}`;
}

async function resolveUserId(req) {
  if (req.user?.id) return String(req.user.id);
  if (req.user?.user_id) return String(req.user.user_id);
  if (!req.user?.email) throw new Error("Missing authenticated user email.");
  const { rows } = await pool.query(
    "SELECT id FROM public.userdata WHERE email=$1 LIMIT 1",
    [req.user.email]
  );
  if (!rows[0]) throw new Error("User record not found.");
  return String(rows[0].id);
}

export async function listMyEvents(req, res) {
  try {
    const userId = await resolveUserId(req);
    const tab = (req.query.tab || "upcoming").toLowerCase();
    const limit = clampLimit(req.query.limit);
    const offset = clampOffset(req.query.offset);
    const poolFilter = normalizeFundingPoolSlug(req.query.funding_pool_slug, { allowAll: true });
    const fundingState = normalizeFundingState(req.query.funding_state);
    const { filter, order } = TAB_QUERY[tab] || TAB_QUERY.upcoming;
    const whereParts = ["e.creator_user_id = $1"];
    const sqlParams = [userId];

    if (poolFilter !== ALL_POOLS_FILTER) {
      sqlParams.push(poolFilter);
      whereParts.push(
        `COALESCE(NULLIF(LOWER(BTRIM(e.funding_pool_slug)), ''), 'general') = $${sqlParams.length}`
      );
    }

    if (fundingState === "funded") {
      whereParts.push("COALESCE(fs.funded_credits_total, 0) > 0");
    } else if (fundingState === "deficit") {
      whereParts.push("COALESCE(fs.deficit_credits_total, 0) > 0");
    } else if (fundingState === "unfunded") {
      whereParts.push("COALESCE(fs.verified_credits_total, 0) > 0 AND COALESCE(fs.funded_credits_total, 0) = 0");
    }

    sqlParams.push(limit);
    const limitParam = sqlParams.length;
    sqlParams.push(offset);
    const offsetParam = sqlParams.length;

    const sql = `
      SELECT e.id,
             e.title,
             e.start_at,
             e.end_at,
             e.tz,
             e.location_text,
             e.org_name,
             e.community_tag,
             e.cause_tags,
             e.requirements,
             e.verification_method,
             e.impact_credits_base,
             e.reliability_weight,
             e.funding_pool_slug,
             e.visibility,
             e.capacity,
             e.status,
             COALESCE(e.reward_pool_kind, 0) AS reward_pool_kind,
             COALESCE(fs.verified_credits_total, 0) AS verified_credits_total,
             COALESCE(fs.funded_credits_total, 0) AS funded_credits_total,
             COALESCE(fs.deficit_credits_total, 0) AS deficit_credits_total,
             COALESCE(r.accepted, 0) AS rsvp_accepted
        FROM events e
   LEFT JOIN (
          SELECT event_id,
                 COUNT(*) FILTER (WHERE status IN ('accepted','checked_in')) AS accepted
            FROM event_rsvps
        GROUP BY event_id
        ) r ON r.event_id = e.id
   LEFT JOIN (
          SELECT
            wt.event_id,
            COALESCE(SUM(wt.kind_amount), 0) AS verified_credits_total,
            COALESCE(SUM(COALESCE(dr.credits_funded, 0)), 0) AS funded_credits_total,
            COALESCE(SUM(GREATEST(wt.kind_amount - COALESCE(dr.credits_funded, 0), 0)), 0) AS deficit_credits_total
          FROM wallet_transactions wt
          LEFT JOIN donor_receipts dr ON dr.wallet_tx_id = wt.id
          WHERE wt.reason = 'earn_shift'
            AND wt.direction = 'credit'
          GROUP BY wt.event_id
        ) fs ON fs.event_id = e.id
       WHERE ${whereParts.join("\n         AND ")}
         ${filter}
       ${order}
       LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    let rows;
    try {
      const result = await pool.query(sql, sqlParams);
      rows = result.rows;
    } catch (error) {
      if (error?.code === "42P01") {
        const fallbackFiltered = poolFilter === ALL_POOLS_FILTER
          ? FALLBACK_MY_EVENTS
          : FALLBACK_MY_EVENTS.filter(
              (item) => normalizeFundingPoolSlug(item.funding_pool_slug) === poolFilter
            );
        let fallbackFundingFiltered = fallbackFiltered;
        if (fundingState === "funded") {
          fallbackFundingFiltered = fallbackFundingFiltered.filter((item) => (Number(item.funded_credits_total) || 0) > 0);
        } else if (fundingState === "deficit") {
          fallbackFundingFiltered = fallbackFundingFiltered.filter((item) => (Number(item.deficit_credits_total) || 0) > 0);
        } else if (fundingState === "unfunded") {
          fallbackFundingFiltered = fallbackFundingFiltered.filter(
            (item) => (Number(item.verified_credits_total) || 0) > 0 && (Number(item.funded_credits_total) || 0) === 0
          );
        }
        rows = fallbackFundingFiltered.slice(offset, offset + limit);
      } else {
        throw error;
      }
    }

    const data = rows.map((row) => ({
      id: String(row.id),
      title: row.title,
      start_at: row.start_at,
      end_at: row.end_at,
      tz: row.tz,
      location_text: row.location_text,
      org_name: row.org_name || null,
      community_tag: row.community_tag || null,
      cause_tags: Array.isArray(row.cause_tags) ? row.cause_tags : [],
      requirements: row.requirements || null,
      verification_method: row.verification_method || "host_attest",
      impact_credits_base:
        row.impact_credits_base !== null && row.impact_credits_base !== undefined
          ? Number(row.impact_credits_base)
          : 25,
      reliability_weight:
        row.reliability_weight !== null && row.reliability_weight !== undefined
          ? Number(row.reliability_weight)
          : 1,
      funding_pool_slug: row.funding_pool_slug || "general",
      visibility: row.visibility,
      capacity: row.capacity,
      status: row.status,
      reward_pool_kind: row.reward_pool_kind ?? 0,
      verified_credits_total: Number(row.verified_credits_total) || 0,
      funded_credits_total: Number(row.funded_credits_total) || 0,
      deficit_credits_total: Number(row.deficit_credits_total) || 0,
      rsvp_counts: { accepted: Number(row.rsvp_accepted) || 0 },
    }));

    return res.json({
      ok: true,
      data,
      paging: { limit, offset: offset + data.length, count: data.length },
      filters: {
        funding_pool_slug: poolFilter,
        funding_state: fundingState,
      },
    });
  } catch (error) {
    console.error("[meEvents] listMyEvents error:", error);
    return res.status(500).json({ ok: false, error: error.message || "Unable to load events" });
  }
}

export async function getMyPoolSummary(req, res) {
  try {
    const userId = await resolveUserId(req);
    const scopedPrefix = `u${userId}${POOL_SCOPE_SEP}`;
    const includePoolSlugRaw = typeof req.query?.include_pool_slug === "string"
      ? req.query.include_pool_slug
      : "";
    const includePoolSlug = includePoolSlugRaw
      ? parseFundingPoolSlugForWrite(includePoolSlugRaw)
      : null;
    const sqlParams = [userId, scopedPrefix];
    const includeSlugUnion = includePoolSlug
      ? `\n            UNION\n            SELECT $${sqlParams.push(includePoolSlug)}::text AS funding_pool_slug`
      : "";

    let rows;
    try {
      const result = await pool.query(
        `
          WITH host_events AS (
            SELECT
              e.id,
              COALESCE(NULLIF(LOWER(BTRIM(e.funding_pool_slug)), ''), 'general') AS funding_pool_slug,
              COALESCE(e.reward_pool_kind, 0) AS reward_pool_kind,
              e.status
            FROM events e
            WHERE e.creator_user_id = $1
          ),
          event_rollup AS (
            SELECT
              funding_pool_slug,
              COUNT(*)::int AS events_count,
              COUNT(*) FILTER (WHERE status = 'published')::int AS published_events_count,
              COALESCE(SUM(reward_pool_kind), 0) AS reward_pool_kind_total
            FROM host_events
            GROUP BY funding_pool_slug
          ),
          wallet_rollup AS (
            SELECT
              he.funding_pool_slug,
              COALESCE(SUM(wt.kind_amount), 0) AS verified_credits_total,
              COALESCE(SUM(COALESCE(dr.credits_funded, 0)), 0) AS funded_credits_total,
              COALESCE(SUM(GREATEST(wt.kind_amount - COALESCE(dr.credits_funded, 0), 0)), 0) AS deficit_credits_total
            FROM host_events he
            JOIN wallet_transactions wt
              ON wt.event_id = he.id
             AND wt.reason = 'earn_shift'
             AND wt.direction = 'credit'
            LEFT JOIN donor_receipts dr ON dr.wallet_tx_id = wt.id
            GROUP BY he.funding_pool_slug
          ),
          pool_ledger AS (
            SELECT
              CASE
                WHEN LEFT(fp.slug, LENGTH($2)) = $2 THEN SUBSTRING(fp.slug FROM LENGTH($2) + 1)
                ELSE fp.slug
              END AS funding_pool_slug,
              COALESCE(SUM(CASE WHEN pt.direction = 'credit' THEN pt.amount_credits ELSE 0 END), 0) AS pool_credits_in_total,
              COALESCE(SUM(CASE WHEN pt.direction = 'debit' THEN pt.amount_credits ELSE 0 END), 0) AS pool_credits_out_total
            FROM funding_pools fp
            LEFT JOIN pool_transactions pt ON pt.pool_id = fp.id
            WHERE LEFT(fp.slug, LENGTH($2)) = $2
            GROUP BY
              CASE
                WHEN LEFT(fp.slug, LENGTH($2)) = $2 THEN SUBSTRING(fp.slug FROM LENGTH($2) + 1)
                ELSE fp.slug
              END
          ),
          all_slugs AS (
            SELECT funding_pool_slug FROM event_rollup
            UNION
            SELECT funding_pool_slug FROM wallet_rollup
            UNION
            SELECT funding_pool_slug FROM pool_ledger
            ${includeSlugUnion}
          )
          SELECT
            s.funding_pool_slug,
            COALESCE(er.events_count, 0) AS events_count,
            COALESCE(er.published_events_count, 0) AS published_events_count,
            COALESCE(er.reward_pool_kind_total, 0) AS reward_pool_kind_total,
            COALESCE(wr.verified_credits_total, 0) AS verified_credits_total,
            COALESCE(wr.funded_credits_total, 0) AS funded_credits_total,
            COALESCE(wr.deficit_credits_total, 0) AS deficit_credits_total,
            COALESCE(pl.pool_credits_in_total, 0) AS pool_credits_in_total,
            COALESCE(pl.pool_credits_out_total, 0) AS pool_credits_out_total
          FROM all_slugs s
          LEFT JOIN event_rollup er ON er.funding_pool_slug = s.funding_pool_slug
          LEFT JOIN wallet_rollup wr ON wr.funding_pool_slug = s.funding_pool_slug
          LEFT JOIN pool_ledger pl ON pl.funding_pool_slug = s.funding_pool_slug
          ORDER BY s.funding_pool_slug ASC
        `,
        sqlParams
      );
      rows = result.rows || [];
    } catch (error) {
      if (error?.code === "42P01") {
        rows = [];
      } else {
        throw error;
      }
    }

    const pools = rows.map((row) => {
      const creditsIn = Number(row.pool_credits_in_total) || 0;
      const creditsOut = Number(row.pool_credits_out_total) || 0;
      return {
        funding_pool_slug: row.funding_pool_slug || DEFAULT_POOL_SLUG,
        events_count: Number(row.events_count) || 0,
        published_events_count: Number(row.published_events_count) || 0,
        reward_pool_kind_total: Number(row.reward_pool_kind_total) || 0,
        verified_credits_total: Number(row.verified_credits_total) || 0,
        funded_credits_total: Number(row.funded_credits_total) || 0,
        deficit_credits_total: Number(row.deficit_credits_total) || 0,
        pool_credits_in_total: creditsIn,
        pool_credits_out_total: creditsOut,
        pool_credits_remaining: Math.max(0, creditsIn - creditsOut),
      };
    });

    const totals = pools.reduce(
      (acc, item) => {
        acc.events_count += item.events_count;
        acc.published_events_count += item.published_events_count;
        acc.reward_pool_kind_total += item.reward_pool_kind_total;
        acc.verified_credits_total += item.verified_credits_total;
        acc.funded_credits_total += item.funded_credits_total;
        acc.deficit_credits_total += item.deficit_credits_total;
        acc.pool_credits_in_total += item.pool_credits_in_total;
        acc.pool_credits_out_total += item.pool_credits_out_total;
        acc.pool_credits_remaining += item.pool_credits_remaining;
        return acc;
      },
      {
        events_count: 0,
        published_events_count: 0,
        reward_pool_kind_total: 0,
        verified_credits_total: 0,
        funded_credits_total: 0,
        deficit_credits_total: 0,
        pool_credits_in_total: 0,
        pool_credits_out_total: 0,
        pool_credits_remaining: 0,
      }
    );

    return res.json({
      ok: true,
      data: {
        pools,
        totals,
      },
    });
  } catch (error) {
    console.error("[meEvents] getMyPoolSummary error:", error);
    return res.status(500).json({ ok: false, error: error.message || "Unable to load pool summary" });
  }
}

export async function getMyPoolTransactions(req, res) {
  try {
    const userId = await resolveUserId(req);
    const scopedPrefix = `u${userId}${POOL_SCOPE_SEP}`;
    const poolFilter = normalizeFundingPoolSlug(
      req.query.pool_slug ?? req.query.funding_pool_slug,
      { allowAll: true }
    );
    const reasonFilter = normalizeTxReasonFilter(req.query.reason);
    const limit = clampLimit(req.query.limit ?? 25);
    const offset = clampOffset(req.query.offset);

    const whereParts = ["LEFT(fp.slug, LENGTH($1)) = $1"];
    const sqlParams = [scopedPrefix];

    if (poolFilter !== ALL_POOLS_FILTER) {
      sqlParams.push(poolFilter);
      whereParts.push(`SUBSTRING(fp.slug FROM LENGTH($1) + 1) = $${sqlParams.length}`);
    }
    if (reasonFilter !== "all") {
      sqlParams.push(reasonFilter);
      whereParts.push(`pt.reason = $${sqlParams.length}`);
    }

    sqlParams.push(limit + 1);
    const limitParam = sqlParams.length;
    sqlParams.push(offset);
    const offsetParam = sqlParams.length;

    let txRows = [];
    try {
      const { rows } = await pool.query(
        `
          SELECT
            pt.id,
            SUBSTRING(fp.slug FROM LENGTH($1) + 1) AS funding_pool_slug,
            pt.direction,
            pt.amount_credits,
            pt.reason,
            pt.donation_id,
            pt.event_id,
            pt.wallet_tx_id,
            pt.created_at,
            e.title AS event_title,
            e.status AS event_status,
            d.amount_cents AS donation_amount_cents,
            d.currency AS donation_currency
          FROM pool_transactions pt
          JOIN funding_pools fp ON fp.id = pt.pool_id
          LEFT JOIN events e ON e.id = pt.event_id
          LEFT JOIN donations d ON d.id = pt.donation_id
          WHERE ${whereParts.join("\n            AND ")}
          ORDER BY pt.created_at DESC, pt.id DESC
          LIMIT $${limitParam} OFFSET $${offsetParam}
        `,
        sqlParams
      );
      txRows = rows || [];
    } catch (error) {
      if (error?.code === "42P01") {
        txRows = [];
      } else {
        throw error;
      }
    }

    const hasMore = txRows.length > limit;
    const slicedRows = hasMore ? txRows.slice(0, limit) : txRows;
    const items = slicedRows.map((row) => ({
      id: Number(row.id) || null,
      funding_pool_slug: row.funding_pool_slug || DEFAULT_POOL_SLUG,
      direction: row.direction || "credit",
      amount_credits: Number(row.amount_credits) || 0,
      reason: row.reason || "manual_adjust",
      reason_label: TX_REASON_LABELS[row.reason] || "Unknown",
      donation_id: row.donation_id ? Number(row.donation_id) : null,
      donation_amount_cents: row.donation_amount_cents != null ? Number(row.donation_amount_cents) : null,
      donation_currency: row.donation_currency || null,
      event_id: row.event_id ? String(row.event_id) : null,
      event_title: row.event_title || null,
      event_status: row.event_status || null,
      wallet_tx_id: row.wallet_tx_id || null,
      created_at: row.created_at || null,
    }));

    let poolOptions = [DEFAULT_POOL_SLUG];
    try {
      const { rows } = await pool.query(
        `
          WITH host_pools AS (
            SELECT DISTINCT
              COALESCE(NULLIF(LOWER(BTRIM(e.funding_pool_slug)), ''), 'general') AS funding_pool_slug
            FROM events e
            WHERE e.creator_user_id = $1
          ),
          scoped_pools AS (
            SELECT DISTINCT
              SUBSTRING(fp.slug FROM LENGTH($2) + 1) AS funding_pool_slug
            FROM funding_pools fp
            WHERE LEFT(fp.slug, LENGTH($2)) = $2
          )
          SELECT DISTINCT funding_pool_slug
          FROM (
            SELECT funding_pool_slug FROM host_pools
            UNION
            SELECT funding_pool_slug FROM scoped_pools
          ) slugs
          WHERE funding_pool_slug IS NOT NULL AND funding_pool_slug <> ''
          ORDER BY funding_pool_slug ASC
        `,
        [userId, scopedPrefix]
      );
      const unique = Array.from(
        new Set(
          [DEFAULT_POOL_SLUG, ...(rows || []).map((row) => String(row.funding_pool_slug || "").trim()).filter(Boolean)]
        )
      );
      poolOptions = unique.sort();
    } catch (error) {
      if (error?.code !== "42P01") throw error;
    }

    const reasonOptions = [
      { value: "all", label: "All Reasons" },
      ...Object.entries(TX_REASON_LABELS).map(([value, label]) => ({ value, label })),
    ];

    return res.json({
      ok: true,
      data: {
        items,
        pool_options: poolOptions,
        reason_options: reasonOptions,
      },
      paging: {
        limit,
        offset,
        count: items.length,
        has_more: hasMore,
        next_offset: hasMore ? offset + items.length : offset,
      },
      filters: {
        pool_slug: poolFilter,
        reason: reasonFilter,
      },
    });
  } catch (error) {
    console.error("[meEvents] getMyPoolTransactions error:", error);
    return res.status(500).json({ ok: false, error: error.message || "Unable to load pool transactions" });
  }
}

export async function topUpMyPool(req, res) {
  const client = await pool.connect();
  try {
    const userId = await resolveUserId(req);
    const poolSlug = parseFundingPoolSlugForWrite(req.body?.funding_pool_slug ?? req.body?.pool_slug);
    const amountCredits = parseTopupAmount(req.body?.amount_credits);
    const source = normalizeTopupSource(req.body?.source);
    const reason = TOPUP_SOURCE_REASON[source] || "org_topup";

    const userEmail = req.user?.email || "";
    const isAdmin = isAdminEmail(userEmail);
    if (!isAdmin && poolSlug !== DEFAULT_POOL_SLUG) {
      const { rows: [hostPoolEvent] = [] } = await pool.query(
        `
          SELECT 1
            FROM events e
           WHERE e.creator_user_id = $1
             AND COALESCE(NULLIF(LOWER(BTRIM(e.funding_pool_slug)), ''), 'general') = $2
           LIMIT 1
        `,
        [userId, poolSlug]
      );
      if (!hostPoolEvent) {
        return res.status(403).json({
          ok: false,
          error: "Top-ups are limited to funding pools used by your events.",
        });
      }
    }

    await client.query("BEGIN");

    const poolName = poolSlug === DEFAULT_POOL_SLUG ? "General Pool" : poolSlug;
    const scopedPoolSlug = buildScopedPoolSlug(userId, poolSlug);
    const { rows: [poolRow] = [] } = await client.query(
      `
        INSERT INTO funding_pools (slug, name)
        VALUES ($1, $2)
        ON CONFLICT (slug) DO UPDATE SET name = funding_pools.name
        RETURNING id, slug
      `,
      [scopedPoolSlug, poolName]
    );
    const poolId = Number(poolRow?.id);
    if (!Number.isFinite(poolId) || poolId <= 0) {
      throw new Error("Unable to resolve funding pool.");
    }

    const { rows: [txRow] = [] } = await client.query(
      `
        INSERT INTO pool_transactions
          (pool_id, direction, amount_credits, reason, donation_id, event_id, wallet_tx_id)
        VALUES ($1, 'credit', $2, $3, NULL, NULL, NULL)
        RETURNING id, amount_credits, reason, created_at
      `,
      [poolId, amountCredits, reason]
    );

    const { rows: [balanceRow] = [] } = await client.query(
      `
        SELECT
          COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_credits ELSE 0 END), 0) AS credits_in,
          COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_credits ELSE 0 END), 0) AS credits_out
        FROM pool_transactions
        WHERE pool_id = $1
      `,
      [poolId]
    );
    const creditsIn = Number(balanceRow?.credits_in) || 0;
    const creditsOut = Number(balanceRow?.credits_out) || 0;

    await client.query("COMMIT");

    return res.status(201).json({
      ok: true,
      data: {
        topup_id: txRow?.id || null,
        funding_pool_slug: poolSlug,
        amount_credits: Number(txRow?.amount_credits) || amountCredits,
        source,
        reason: txRow?.reason || reason,
        created_at: txRow?.created_at || null,
        pool_credits_in_total: creditsIn,
        pool_credits_out_total: creditsOut,
        pool_credits_remaining: Math.max(0, creditsIn - creditsOut),
      },
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("[meEvents] topUpMyPool error:", error);
    if (error?.statusCode === 400) {
      return res.status(400).json({ ok: false, error: error.message });
    }
    if (error?.code === "42P01") {
      return res.status(500).json({
        ok: false,
        error: "Funding tables are missing. Please run migrations.",
      });
    }
    if (error?.code === "23514") {
      return res.status(500).json({
        ok: false,
        error: "Top-up reason is not enabled in database constraints. Please run latest migrations.",
      });
    }
    return res.status(500).json({ ok: false, error: error.message || "Unable to top up pool" });
  } finally {
    client.release();
  }
}

export async function cancelEvent(req, res) {
  try {
    const userId = await resolveUserId(req);
    const eventId = req.params.id;
    let eventRow;
    try {
      const { rows } = await pool.query(
        `
          SELECT id, creator_user_id, start_at, status
            FROM events
           WHERE id = $1
        `,
        [eventId]
      );
      eventRow = rows[0];
    } catch (error) {
      if (error?.code === "42P01") {
        return res.status(500).json({ ok: false, error: "Events table missing. Please run migrations." });
      }
      throw error;
    }

    if (!eventRow) {
      return res.status(404).json({ ok: false, error: "Event not found" });
    }
    if (String(eventRow.creator_user_id) !== userId) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }
    if (eventRow.status !== "published") {
      return res.status(409).json({ ok: false, error: "Only published events can be cancelled" });
    }
    if (eventRow.start_at && new Date(eventRow.start_at) <= new Date()) {
      return res.status(409).json({ ok: false, error: "Event already started or past" });
    }

    await pool.query("UPDATE events SET status='cancelled' WHERE id=$1", [eventId]);
    return res.json({ ok: true, data: { id: eventId, status: "cancelled" } });
  } catch (error) {
    console.error("[meEvents] cancelEvent error:", error);
    return res.status(500).json({ ok: false, error: "Unable to cancel event" });
  }
}

export async function completeEvent(req, res) {
  try {
    const userId = await resolveUserId(req);
    const eventId = req.params.id;

    let eventRow;
    try {
      const { rows } = await pool.query(
        `
          SELECT id, creator_user_id, end_at, status
            FROM events
           WHERE id = $1
        `,
        [eventId]
      );
      eventRow = rows[0];
    } catch (error) {
      if (error?.code === "42P01") {
        return res.status(500).json({ ok: false, error: "Events table missing. Please run migrations." });
      }
      throw error;
    }

    if (!eventRow) {
      return res.status(404).json({ ok: false, error: "Event not found" });
    }
    if (String(eventRow.creator_user_id) !== userId) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }
    if (eventRow.status === "cancelled") {
      return res.status(409).json({ ok: false, error: "Cancelled events cannot be completed" });
    }
    if (!eventRow.end_at || new Date(eventRow.end_at) > new Date()) {
      return res.status(409).json({ ok: false, error: "Event not finished yet" });
    }

    await pool.query("UPDATE events SET status='completed' WHERE id=$1", [eventId]);
    return res.json({ ok: true, data: { id: eventId, status: "completed" } });
  } catch (error) {
    console.error("[meEvents] completeEvent error:", error);
    return res.status(500).json({ ok: false, error: "Unable to complete event" });
  }
}

export async function deleteDraftEvent(req, res) {
  try {
    const userId = await resolveUserId(req);
    const eventId = req.params.id;
    let eventRow;
    try {
      const { rows } = await pool.query(
        `
          SELECT id, creator_user_id, status
            FROM events
           WHERE id = $1
        `,
        [eventId]
      );
      eventRow = rows[0];
    } catch (error) {
      if (error?.code === "42P01") {
        return res.status(500).json({ ok: false, error: "Events table missing. Please run migrations." });
      }
      throw error;
    }

    if (!eventRow) {
      return res.status(404).json({ ok: false, error: "Event not found" });
    }
    if (String(eventRow.creator_user_id) !== userId) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }
    if (eventRow.status !== "draft") {
      return res.status(409).json({ ok: false, error: "Only drafts can be deleted" });
    }

    await pool.query("DELETE FROM events WHERE id=$1", [eventId]);
    return res.json({ ok: true, data: { id: eventId } });
  } catch (error) {
    console.error("[meEvents] deleteDraftEvent error:", error);
    return res.status(500).json({ ok: false, error: "Unable to delete draft" });
  }
}
