import express from "express";
import pool from "../Backend/db/pg.js";
import { ensureAdminApi } from "../Backend/middleware/ensureAdmin.js";
import { approvePendingCreditRequest, rejectPendingCreditRequest } from "../services/earnShiftFundingService.js";

const adminApiRouter = express.Router();
const CSRF_HEADER_NAME = "X-CSRF-Token";
const EVENT_STATUS_SET = new Set(["draft", "published", "cancelled", "completed"]);
const EVENT_VISIBILITY_SET = new Set(["public", "fof", "private"]);
const ORG_STATUS_SET = new Set(["approved", "suspended", "rejected"]);
const WALLET_REASON_SET = new Set(["earn", "donate", "adjustment", "earn_shift", "redeem"]);
const ADMIN_POOL_TOPUP_REASON_SET = new Set(["admin_allocation", "adjustment", "bonus"]);
const ADMIN_POOL_TOPUP_REASON_LEGACY_MAP = {
  admin_allocation: "org_topup",
  adjustment: "manual_adjust",
  bonus: "org_topup",
};
const ORG_POOL_HISTORY_REASON_SET = [
  "admin_allocation",
  "adjustment",
  "bonus",
  "org_topup",
  "manual_adjust",
  "subscription_credit",
  "subscription_topup",
  "donation_in",
];

function requireCsrf(req, res) {
  const expectedCsrf = req.session?.csrfToken;
  const providedCsrf = req.get(CSRF_HEADER_NAME);
  if (!expectedCsrf || !providedCsrf || providedCsrf !== expectedCsrf) {
    res.status(403).json({ error: "invalid csrf token" });
    return false;
  }
  return true;
}

function parseOptionalBoolean(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return null;
}

function parsePositiveInt(value) {
  const num = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function parsePagination(query, options = {}) {
  const defaultPage = parsePositiveInt(options.defaultPage) || 1;
  const defaultLimit = parsePositiveInt(options.defaultLimit) || 50;
  const maxLimit = parsePositiveInt(options.maxLimit) || 100;
  const rawPage = Number.parseInt(String(query?.page || ""), 10);
  const rawLimit = Number.parseInt(String(query?.limit || ""), 10);
  const page = Math.max(1, Number.isInteger(rawPage) ? rawPage : defaultPage);
  const limit = Math.min(maxLimit, Math.max(1, Number.isInteger(rawLimit) ? rawLimit : defaultLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function buildPagination(page, limit, totalRows) {
  const safeTotalRows = Number(totalRows) || 0;
  return {
    page,
    limit,
    totalRows: safeTotalRows,
    totalPages: Math.ceil(safeTotalRows / limit),
  };
}

function buildScopedPoolPrefix(ownerUserId) {
  const id = parsePositiveInt(ownerUserId);
  if (!id) return null;
  return `u${id}__`;
}

async function insertOrgPoolTopupTx({ client, poolId, amount, requestedReason, notes }) {
  const fallbackReason = ADMIN_POOL_TOPUP_REASON_LEGACY_MAP[requestedReason] || requestedReason;
  const reasonCandidates = Array.from(new Set([requestedReason, fallbackReason, "manual_adjust"]));
  let lastError = null;
  let savepointSeq = 0;

  for (const reason of reasonCandidates) {
    for (const includeNotes of [true, false]) {
      savepointSeq += 1;
      const savepointName = `org_pool_topup_sp_${savepointSeq}`;
      await client.query(`SAVEPOINT ${savepointName}`);
      try {
        if (includeNotes) {
          const { rows: [txRow] = [] } = await client.query(
            `
              INSERT INTO pool_transactions
                (pool_id, direction, amount_credits, reason, donation_id, event_id, wallet_tx_id, notes)
              VALUES
                ($1, 'credit', $2, $3, NULL, NULL, NULL, $4)
              RETURNING id, pool_id, amount_credits, reason, created_at, notes
            `,
            [poolId, amount, reason, notes]
          );
          await client.query(`RELEASE SAVEPOINT ${savepointName}`);
          return { txRow, persistedReason: reason, notesStored: true };
        }

        const { rows: [txRow] = [] } = await client.query(
          `
            INSERT INTO pool_transactions
              (pool_id, direction, amount_credits, reason, donation_id, event_id, wallet_tx_id)
            VALUES
              ($1, 'credit', $2, $3, NULL, NULL, NULL)
            RETURNING id, pool_id, amount_credits, reason, created_at, NULL::text AS notes
          `,
          [poolId, amount, reason]
        );
        await client.query(`RELEASE SAVEPOINT ${savepointName}`);
        return { txRow, persistedReason: reason, notesStored: false };
      } catch (err) {
        lastError = err;
        try {
          await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
          await client.query(`RELEASE SAVEPOINT ${savepointName}`);
        } catch (_) {}
        if (err?.code === "42703" && includeNotes) {
          continue;
        }
        if (err?.code === "23514") {
          break;
        }
        throw err;
      }
    }
  }

  throw lastError || new Error("pool_topup_insert_failed");
}

adminApiRouter.use(ensureAdminApi);

adminApiRouter.get("/stats", async (req, res) => {
  try {
    const { rows: [row] = [] } = await pool.query(
      `
        SELECT
          (SELECT COUNT(*)::int FROM userdata) AS total_users,
          (SELECT COUNT(DISTINCT attendee_user_id)::int FROM event_rsvps) AS active_volunteers,
          (SELECT COUNT(*)::int FROM organizations) AS total_organizations,
          (SELECT COUNT(*)::int FROM org_applications WHERE status = 'pending') AS pending_org_applications,
          (SELECT COUNT(*)::int FROM events) AS total_events,
          (SELECT COUNT(*)::int FROM events WHERE status = 'completed') AS completed_events,
          (
            SELECT COALESCE(SUM(COALESCE(attended_minutes, 0)), 0)::bigint
            FROM event_rsvps
            WHERE status IN ('accepted', 'checked_in')
              AND COALESCE(verification_status, 'pending') = 'verified'
          ) AS total_volunteer_minutes,
          (SELECT COALESCE(SUM(amount_cents), 0)::bigint FROM donations) AS total_donations_cents,
          (
            SELECT COALESCE(SUM(kind_amount), 0)::bigint
            FROM wallet_transactions
            WHERE direction = 'credit'
          ) AS total_wallet_credits,
          (SELECT COUNT(*)::int FROM userdata WHERE is_suspended = true) AS suspended_users
      `
    );

    const totalMinutes = Number(row?.total_volunteer_minutes) || 0;
    return res.json({
      total_users: Number(row?.total_users) || 0,
      active_volunteers: Number(row?.active_volunteers) || 0,
      total_organizations: Number(row?.total_organizations) || 0,
      pending_org_applications: Number(row?.pending_org_applications) || 0,
      total_events: Number(row?.total_events) || 0,
      completed_events: Number(row?.completed_events) || 0,
      total_volunteer_minutes: totalMinutes,
      total_hours_volunteered: Number((totalMinutes / 60).toFixed(2)),
      total_donations_cents: Number(row?.total_donations_cents) || 0,
      total_wallet_credits: Number(row?.total_wallet_credits) || 0,
      suspended_users: Number(row?.suspended_users) || 0,
    });
  } catch (err) {
    console.error("GET /api/admin/stats error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

adminApiRouter.get("/stats/monthly", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
        WITH months AS (
          SELECT date_trunc('month', NOW()) - (interval '1 month' * gs.n) AS month_start
          FROM generate_series(11, 0, -1) AS gs(n)
        ),
        event_counts AS (
          SELECT date_trunc('month', created_at) AS month_start, COUNT(*)::int AS events
          FROM events
          WHERE created_at >= date_trunc('month', NOW()) - interval '11 months'
          GROUP BY 1
        ),
        volunteer_counts AS (
          SELECT date_trunc('month', created_at) AS month_start, COUNT(DISTINCT attendee_user_id)::int AS volunteers
          FROM event_rsvps
          WHERE created_at >= date_trunc('month', NOW()) - interval '11 months'
          GROUP BY 1
        ),
        donation_totals AS (
          SELECT date_trunc('month', created_at) AS month_start, COALESCE(SUM(amount_cents), 0)::bigint AS donations
          FROM donations
          WHERE created_at >= date_trunc('month', NOW()) - interval '11 months'
          GROUP BY 1
        ),
        credit_totals AS (
          SELECT date_trunc('month', created_at) AS month_start, COALESCE(SUM(kind_amount), 0)::bigint AS credits
          FROM wallet_transactions
          WHERE created_at >= date_trunc('month', NOW()) - interval '11 months'
            AND direction = 'credit'
          GROUP BY 1
        )
        SELECT
          to_char(m.month_start, 'YYYY-MM') AS month,
          COALESCE(e.events, 0)::int AS events,
          COALESCE(v.volunteers, 0)::int AS volunteers,
          COALESCE(d.donations, 0)::bigint AS donations,
          COALESCE(c.credits, 0)::bigint AS credits
        FROM months m
        LEFT JOIN event_counts e ON e.month_start = m.month_start
        LEFT JOIN volunteer_counts v ON v.month_start = m.month_start
        LEFT JOIN donation_totals d ON d.month_start = m.month_start
        LEFT JOIN credit_totals c ON c.month_start = m.month_start
        ORDER BY m.month_start ASC
      `
    );

    return res.json(rows.map((row) => ({
      month: row.month,
      events: Number(row.events) || 0,
      volunteers: Number(row.volunteers) || 0,
      donations: Number(row.donations) || 0,
      credits: Number(row.credits) || 0,
    })));
  } catch (err) {
    console.error("GET /api/admin/stats/monthly error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

adminApiRouter.get("/organizations", async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const search = String(req.query.search || "").trim();
    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(
        `(o.name ILIKE $${params.length} OR o.website ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.firstname ILIKE $${params.length} OR u.lastname ILIKE $${params.length})`
      );
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const countParams = [...params];
    const { rows: [countRow] = [] } = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM organizations o
        LEFT JOIN userdata u ON u.id = o.rep_user_id
        ${whereClause}
      `,
      countParams
    );
    const totalRows = Number(countRow?.total) || 0;

    const dataParams = [...params, limit, offset];
    const { rows } = await pool.query(
      `
        SELECT
          o.id,
          o.name,
          o.status,
          o.website,
          o.applied_at,
          o.approved_at,
          u.email AS rep_email,
          u.firstname AS rep_firstname,
          u.lastname AS rep_lastname
        FROM organizations o
        LEFT JOIN userdata u ON u.id = o.rep_user_id
        ${whereClause}
        ORDER BY o.created_at DESC, o.id DESC
        LIMIT $${dataParams.length - 1}
        OFFSET $${dataParams.length}
      `,
      dataParams
    );

    return res.json({
      data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      website: row.website,
      applied_at: row.applied_at,
      approved_at: row.approved_at,
      rep_email: row.rep_email,
      rep_name: `${row.rep_firstname || ""} ${row.rep_lastname || ""}`.trim(),
      })),
      pagination: buildPagination(page, limit, totalRows),
    });
  } catch (err) {
    console.error("GET /api/admin/organizations error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

adminApiRouter.get("/org-pools", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT
          o.id,
          o.name,
          o.status,
          fp_pick.pool_id,
          COALESCE(pool_balance.current_balance, 0)::bigint AS current_balance
        FROM organizations o
        LEFT JOIN LATERAL (
          SELECT fp.id AS pool_id
          FROM funding_pools fp
          WHERE o.rep_user_id IS NOT NULL
            AND LEFT(fp.slug, LENGTH('u' || o.rep_user_id::text || '__')) = ('u' || o.rep_user_id::text || '__')
          ORDER BY
            CASE WHEN fp.slug = ('u' || o.rep_user_id::text || '__general') THEN 0 ELSE 1 END,
            fp.id ASC
          LIMIT 1
        ) fp_pick ON true
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(
              SUM(
                CASE
                  WHEN pt.direction = 'credit' THEN pt.amount_credits
                  WHEN pt.direction = 'debit' THEN -pt.amount_credits
                  ELSE 0
                END
              ),
              0
            ) AS current_balance
          FROM funding_pools fp
          LEFT JOIN pool_transactions pt ON pt.pool_id = fp.id
          WHERE o.rep_user_id IS NOT NULL
            AND LEFT(fp.slug, LENGTH('u' || o.rep_user_id::text || '__')) = ('u' || o.rep_user_id::text || '__')
        ) pool_balance ON true
        WHERE o.status = 'approved'
        ORDER BY o.name ASC, o.id ASC
      `
    );

    return res.json({
      data: rows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        status: row.status,
        pool_id: row.pool_id != null ? Number(row.pool_id) : null,
        current_balance: Number(row.current_balance) || 0,
      })),
    });
  } catch (err) {
    console.error("GET /api/admin/org-pools error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

adminApiRouter.get("/org-pools/:orgId/history", async (req, res) => {
  const orgId = parsePositiveInt(req.params.orgId);
  if (!orgId) return res.status(400).json({ error: "invalid_request" });

  try {
    const { page, limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const { rows: [org] = [] } = await pool.query(
      `
        SELECT id, rep_user_id
        FROM organizations
        WHERE id = $1
        LIMIT 1
      `,
      [orgId]
    );
    if (!org) return res.status(404).json({ error: "not_found" });

    const scopedPrefix = buildScopedPoolPrefix(org.rep_user_id);
    if (!scopedPrefix) {
      return res.json({
        data: [],
        pagination: buildPagination(page, limit, 0),
      });
    }

    const baseParams = [scopedPrefix, ORG_POOL_HISTORY_REASON_SET];
    const { rows: [countRow] = [] } = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM pool_transactions pt
        JOIN funding_pools fp ON fp.id = pt.pool_id
        WHERE LEFT(fp.slug, LENGTH($1)) = $1
          AND pt.reason = ANY($2::text[])
      `,
      baseParams
    );
    const totalRows = Number(countRow?.total) || 0;

    const dataParams = [...baseParams, limit, offset];
    let rows = [];
    try {
      const result = await pool.query(
        `
          SELECT
            pt.id,
            pt.amount_credits AS amount,
            pt.reason,
            pt.created_at,
            pt.notes
          FROM pool_transactions pt
          JOIN funding_pools fp ON fp.id = pt.pool_id
          WHERE LEFT(fp.slug, LENGTH($1)) = $1
            AND pt.reason = ANY($2::text[])
          ORDER BY pt.created_at DESC, pt.id DESC
          LIMIT $3
          OFFSET $4
        `,
        dataParams
      );
      rows = result.rows || [];
    } catch (err) {
      if (err?.code !== "42703") throw err;
      const fallback = await pool.query(
        `
          SELECT
            pt.id,
            pt.amount_credits AS amount,
            pt.reason,
            pt.created_at,
            NULL::text AS notes
          FROM pool_transactions pt
          JOIN funding_pools fp ON fp.id = pt.pool_id
          WHERE LEFT(fp.slug, LENGTH($1)) = $1
            AND pt.reason = ANY($2::text[])
          ORDER BY pt.created_at DESC, pt.id DESC
          LIMIT $3
          OFFSET $4
        `,
        dataParams
      );
      rows = fallback.rows || [];
    }

    return res.json({
      data: rows.map((row) => ({
        id: Number(row.id),
        amount: Number(row.amount) || 0,
        reason: row.reason || "",
        created_at: row.created_at || null,
        notes: row.notes || "",
      })),
      pagination: buildPagination(page, limit, totalRows),
    });
  } catch (err) {
    console.error("GET /api/admin/org-pools/:orgId/history error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

adminApiRouter.post("/org-pools/:orgId/topup", async (req, res) => {
  if (!requireCsrf(req, res)) return;
  const orgId = parsePositiveInt(req.params.orgId);
  const amount = parsePositiveInt(req.body?.amount);
  const reason = String(req.body?.reason || "").trim().toLowerCase();
  const notes =
    typeof req.body?.notes === "string" && req.body.notes.trim()
      ? req.body.notes.trim()
      : null;

  if (!orgId || !amount || !ADMIN_POOL_TOPUP_REASON_SET.has(reason)) {
    return res.status(400).json({ error: "invalid_request" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: [org] = [] } = await client.query(
      `
        SELECT id, name, status, rep_user_id
        FROM organizations
        WHERE id = $1
        FOR UPDATE
      `,
      [orgId]
    );

    if (!org) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }
    if (org.status !== "approved") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "org_not_approved" });
    }

    const scopedPrefix = buildScopedPoolPrefix(org.rep_user_id);
    if (!scopedPrefix) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "org_missing_rep_user" });
    }

    const scopedPoolSlug = `${scopedPrefix}general`;
    const poolName = "General Pool";

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
      throw new Error("unable_to_resolve_pool");
    }

    const { txRow, persistedReason, notesStored } = await insertOrgPoolTopupTx({
      client,
      poolId,
      amount,
      requestedReason: reason,
      notes,
    });

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
    const currentBalance = Math.max(0, creditsIn - creditsOut);

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      org_id: orgId,
      org_name: org.name,
      pool_id: poolId,
      current_balance: currentBalance,
      transaction: {
        id: Number(txRow?.id) || null,
        pool_id: Number(txRow?.pool_id) || poolId,
        amount: Number(txRow?.amount_credits) || amount,
        reason: reason,
        db_reason: txRow?.reason || persistedReason || reason,
        created_at: txRow?.created_at || null,
        notes: txRow?.notes || notes || "",
        notes_stored: notesStored,
      },
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("POST /api/admin/org-pools/:orgId/topup error:", err);
    if (err?.code === "23514") {
      return res.status(500).json({
        error: "pool_reason_not_enabled",
        message: "Pool top-up reason is not enabled in database constraints. Please run latest migrations.",
      });
    }
    return res.status(500).json({ error: "server_error" });
  } finally {
    client.release();
  }
});

adminApiRouter.patch("/organizations/:id/status", async (req, res) => {
  if (!requireCsrf(req, res)) return;
  const orgId = parsePositiveInt(req.params.id);
  const status = String(req.body?.status || "").trim().toLowerCase();
  if (!orgId || !ORG_STATUS_SET.has(status)) {
    return res.status(400).json({ error: "invalid_request" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [org] = [] } = await client.query(
      "SELECT id, rep_user_id FROM organizations WHERE id = $1 FOR UPDATE",
      [orgId]
    );
    if (!org) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }

    let updated;
    if (status === "approved") {
      const { rows: [row] = [] } = await client.query(
        `
          UPDATE organizations
          SET status = 'approved',
              approved_at = NOW(),
              approved_by = $1
          WHERE id = $2
          RETURNING *
        `,
        [req.user?.email || "", orgId]
      );
      updated = row;
    } else {
      const { rows: [row] = [] } = await client.query(
        `
          UPDATE organizations
          SET status = $1
          WHERE id = $2
          RETURNING *
        `,
        [status, orgId]
      );
      updated = row;
    }

    if (status === "suspended" && org.rep_user_id != null) {
      await client.query(
        "UPDATE userdata SET org_rep = false WHERE id = $1",
        [org.rep_user_id]
      );
    }

    await client.query("COMMIT");
    return res.json({ success: true, organization: updated });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("PATCH /api/admin/organizations/:id/status error:", err);
    return res.status(500).json({ error: "server_error" });
  } finally {
    client.release();
  }
});

adminApiRouter.delete("/organizations/:id", async (req, res) => {
  if (!requireCsrf(req, res)) return;
  const orgId = parsePositiveInt(req.params.id);
  if (!orgId) return res.status(400).json({ error: "invalid_request" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [org] = [] } = await client.query(
      "SELECT id, rep_user_id FROM organizations WHERE id = $1 FOR UPDATE",
      [orgId]
    );
    if (!org) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }

    if (org.rep_user_id != null) {
      await client.query(
        `
          UPDATE userdata
          SET org_rep = false,
              org_id = NULL
          WHERE id = $1
        `,
        [org.rep_user_id]
      );

      await client.query(
        "DELETE FROM events WHERE creator_user_id = $1",
        [org.rep_user_id]
      );
    }

    await client.query("DELETE FROM organizations WHERE id = $1", [orgId]);
    await client.query("COMMIT");
    return res.json({ success: true });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("DELETE /api/admin/organizations/:id error:", err);
    return res.status(500).json({ error: "server_error" });
  } finally {
    client.release();
  }
});

adminApiRouter.get("/events", async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const statusFilter = String(req.query.status || "").trim().toLowerCase();
    const orgId = parsePositiveInt(req.query.org_id);
    const search = String(req.query.search || "").trim();
    const conditions = [];
    const params = [];

    if (statusFilter === "upcoming") {
      conditions.push("e.status = 'published'");
      conditions.push("e.start_at > NOW()");
    } else if (EVENT_STATUS_SET.has(statusFilter)) {
      params.push(statusFilter);
      conditions.push(`e.status = $${params.length}`);
    }

    if (orgId) {
      params.push(orgId);
      conditions.push(`u.org_id = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      conditions.push(
        `(e.title ILIKE $${params.length} OR e.status ILIKE $${params.length} OR e.org_name ILIKE $${params.length} OR u.firstname ILIKE $${params.length} OR u.lastname ILIKE $${params.length})`
      );
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const countParams = [...params];
    const { rows: [countRow] = [] } = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM events e
        LEFT JOIN userdata u ON u.id = e.creator_user_id
        ${whereClause}
      `,
      countParams
    );
    const totalRows = Number(countRow?.total) || 0;

    const dataParams = [...params, limit, offset];
    const { rows } = await pool.query(
      `
        SELECT
          e.id,
          e.title,
          e.start_at,
          e.end_at,
          e.status,
          e.capacity,
          u.id AS host_id,
          u.firstname AS host_firstname,
          u.lastname AS host_lastname,
          COUNT(r.id)::int AS volunteer_count
        FROM events e
        LEFT JOIN userdata u ON u.id = e.creator_user_id
        LEFT JOIN event_rsvps r
          ON r.event_id = e.id
         AND r.status IN ('accepted', 'checked_in', 'pending')
        ${whereClause}
        GROUP BY e.id, u.id
        ORDER BY e.start_at DESC NULLS LAST, e.created_at DESC
        LIMIT $${dataParams.length - 1}
        OFFSET $${dataParams.length}
      `,
      dataParams
    );

    return res.json({
      data: rows.map((row) => ({
      id: row.id,
      title: row.title,
      start_at: row.start_at,
      end_at: row.end_at,
      status: row.status,
      capacity: Number(row.capacity) || 0,
      host_id: row.host_id,
      host_name: `${row.host_firstname || ""} ${row.host_lastname || ""}`.trim(),
      volunteer_count: Number(row.volunteer_count) || 0,
      })),
      pagination: buildPagination(page, limit, totalRows),
    });
  } catch (err) {
    console.error("GET /api/admin/events error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

adminApiRouter.patch("/events/:id", async (req, res) => {
  if (!requireCsrf(req, res)) return;
  const eventId = String(req.params.id || "").trim();
  if (!eventId) return res.status(400).json({ error: "invalid_request" });

  const updates = [];
  const params = [];
  const body = req.body || {};
  const pushUpdate = (column, value) => {
    params.push(value);
    updates.push(`${column} = $${params.length}`);
  };

  if (body.title != null) pushUpdate("title", String(body.title || "").trim());
  if (body.description != null) pushUpdate("description", String(body.description || "").trim());
  if (body.date != null) pushUpdate("start_at", body.date);
  if (body.start_at != null) pushUpdate("start_at", body.start_at);
  if (body.end_at != null) pushUpdate("end_at", body.end_at);
  if (body.tz != null) pushUpdate("tz", String(body.tz || "").trim());
  if (body.location_text != null) pushUpdate("location_text", String(body.location_text || "").trim());
  if (body.max_volunteers != null) {
    const maxVolunteers = parsePositiveInt(body.max_volunteers);
    if (!maxVolunteers) return res.status(400).json({ error: "invalid_max_volunteers" });
    pushUpdate("capacity", maxVolunteers);
  }
  if (body.capacity != null) {
    const capacity = parsePositiveInt(body.capacity);
    if (!capacity) return res.status(400).json({ error: "invalid_capacity" });
    pushUpdate("capacity", capacity);
  }
  if (body.status != null) {
    const status = String(body.status || "").trim().toLowerCase();
    if (!EVENT_STATUS_SET.has(status)) return res.status(400).json({ error: "invalid_status" });
    pushUpdate("status", status);
  }
  if (body.visibility != null) {
    const visibility = String(body.visibility || "").trim().toLowerCase();
    if (!EVENT_VISIBILITY_SET.has(visibility)) return res.status(400).json({ error: "invalid_visibility" });
    pushUpdate("visibility", visibility);
  }

  if (!updates.length) {
    return res.status(400).json({ error: "no_fields_to_update" });
  }

  params.push(eventId);
  try {
    const { rows: [event] = [] } = await pool.query(
      `
        UPDATE events
        SET ${updates.join(", ")},
            updated_at = NOW()
        WHERE id::text = $${params.length}
        RETURNING *
      `,
      params
    );
    if (!event) return res.status(404).json({ error: "not_found" });
    return res.json({ success: true, event });
  } catch (err) {
    console.error("PATCH /api/admin/events/:id error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

adminApiRouter.delete("/events/:id", async (req, res) => {
  if (!requireCsrf(req, res)) return;
  const eventId = String(req.params.id || "").trim();
  if (!eventId) return res.status(400).json({ error: "invalid_request" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM event_rsvps WHERE event_id::text = $1", [eventId]);
    const { rows: [deletedEvent] = [] } = await client.query(
      "DELETE FROM events WHERE id::text = $1 RETURNING id",
      [eventId]
    );
    if (!deletedEvent) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }
    await client.query("COMMIT");
    return res.json({ success: true });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("DELETE /api/admin/events/:id error:", err);
    return res.status(500).json({ error: "server_error" });
  } finally {
    client.release();
  }
});

adminApiRouter.get("/volunteers", async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim().toLowerCase();
    const sort = String(req.query.sort || "").trim().toLowerCase();
    const suspended = parseOptionalBoolean(req.query.suspended);
    const conditions = [];
    const params = [];
    let orderBy = "u.created_at DESC NULLS LAST, u.id DESC";

    if (sort === "credits_desc") {
      orderBy = "COALESCE(wt.total_credits, 0) DESC, COALESCE(er.event_count, 0) DESC, u.created_at DESC NULLS LAST, u.id DESC";
    }

    if (search) {
      params.push(`%${search}%`);
      conditions.push(
        `(u.firstname ILIKE $${params.length} OR u.lastname ILIKE $${params.length} OR u.email ILIKE $${params.length})`
      );
    }

    if (suspended !== null) {
      params.push(suspended);
      conditions.push(`u.is_suspended = $${params.length}`);
    }

    if (status === "active") {
      conditions.push("COALESCE(er.event_count, 0) > 0");
    } else if (status === "inactive") {
      conditions.push("COALESCE(er.event_count, 0) = 0");
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const countParams = [...params];
    const { rows: [countRow] = [] } = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM userdata u
        LEFT JOIN (
          SELECT attendee_user_id AS user_id, COUNT(*)::int AS event_count
          FROM event_rsvps
          GROUP BY attendee_user_id
        ) er ON er.user_id = u.id
        ${whereClause}
      `,
      countParams
    );
    const totalRows = Number(countRow?.total) || 0;

    const dataParams = [...params, limit, offset];
    const { rows } = await pool.query(
      `
        SELECT
          u.id,
          u.firstname,
          u.lastname,
          u.email,
          u.created_at,
          u.is_suspended,
          COALESCE(er.event_count, 0)::int AS event_count,
          COALESCE(wt.total_credits, 0)::bigint AS total_credits
        FROM userdata u
        LEFT JOIN (
          SELECT attendee_user_id AS user_id, COUNT(*)::int AS event_count
          FROM event_rsvps
          GROUP BY attendee_user_id
        ) er ON er.user_id = u.id
        LEFT JOIN (
          SELECT user_id, COALESCE(SUM(CASE WHEN direction = 'credit' THEN kind_amount ELSE 0 END), 0)::bigint AS total_credits
          FROM wallet_transactions
          GROUP BY user_id
        ) wt ON wt.user_id = u.id
        ${whereClause}
        ORDER BY ${orderBy}
        LIMIT $${dataParams.length - 1}
        OFFSET $${dataParams.length}
      `,
      dataParams
    );

    return res.json({
      data: rows.map((row) => ({
      id: Number(row.id),
      firstname: row.firstname,
      lastname: row.lastname,
      email: row.email,
      created_at: row.created_at,
      is_suspended: row.is_suspended === true,
      event_count: Number(row.event_count) || 0,
      total_credits: Number(row.total_credits) || 0,
      })),
      pagination: buildPagination(page, limit, totalRows),
    });
  } catch (err) {
    console.error("GET /api/admin/volunteers error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

adminApiRouter.get("/volunteers/:id", async (req, res) => {
  const userId = parsePositiveInt(req.params.id);
  if (!userId) return res.status(400).json({ error: "invalid_request" });

  try {
    const { rows: [user] = [] } = await pool.query(
      "SELECT * FROM userdata WHERE id = $1 LIMIT 1",
      [userId]
    );
    if (!user) return res.status(404).json({ error: "not_found" });

    const { rows: eventHistory } = await pool.query(
      `
        SELECT
          r.id,
          r.event_id,
          r.status,
          r.verification_status,
          r.checked_in_at,
          r.verified_at,
          r.attended_minutes,
          r.created_at,
          e.title AS event_title,
          e.start_at AS event_start_at,
          e.end_at AS event_end_at,
          e.location_text,
          e.status AS event_status
        FROM event_rsvps r
        LEFT JOIN events e ON e.id = r.event_id
        WHERE r.attendee_user_id = $1
        ORDER BY e.start_at DESC NULLS LAST, r.created_at DESC
      `,
      [userId]
    );

    const { rows: walletTransactions } = await pool.query(
      `
        SELECT
          wt.id,
          wt.kind_amount,
          wt.direction,
          wt.reason,
          wt.event_id,
          wt.note,
          wt.created_at,
          e.title AS event_title
        FROM wallet_transactions wt
        LEFT JOIN events e ON e.id = wt.event_id
        WHERE wt.user_id = $1
        ORDER BY wt.created_at DESC
      `,
      [userId]
    );

    return res.json({
      user,
      event_history: eventHistory,
      wallet_transactions: walletTransactions,
    });
  } catch (err) {
    console.error("GET /api/admin/volunteers/:id error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

adminApiRouter.patch("/volunteers/:id", async (req, res) => {
  if (!requireCsrf(req, res)) return;
  const userId = parsePositiveInt(req.params.id);
  if (!userId) return res.status(400).json({ error: "invalid_request" });

  const allowedFields = [
    "firstname",
    "lastname",
    "email",
    "phone",
    "address1",
    "city",
    "state",
    "country",
    "interest1",
    "interest2",
    "interest3",
    "sdg1",
    "sdg2",
    "sdg3",
    "hours_per_week",
    "age_bracket",
  ];

  const updates = [];
  const params = [];

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
      let value = req.body[field];
      if (field === "hours_per_week") {
        value = value == null || value === "" ? null : Number(value);
        if (value != null && !Number.isFinite(value)) {
          return res.status(400).json({ error: "invalid_hours_per_week" });
        }
      } else if (field === "email") {
        value = String(value || "").trim().toLowerCase();
      } else {
        value = value == null ? null : String(value);
      }
      params.push(value);
      updates.push(`${field} = $${params.length}`);
    }
  }

  if (!updates.length) return res.status(400).json({ error: "no_fields_to_update" });

  params.push(userId);
  try {
    const { rows: [user] = [] } = await pool.query(
      `
        UPDATE userdata
        SET ${updates.join(", ")}
        WHERE id = $${params.length}
        RETURNING *
      `,
      params
    );
    if (!user) return res.status(404).json({ error: "not_found" });
    return res.json({ success: true, user });
  } catch (err) {
    console.error("PATCH /api/admin/volunteers/:id error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

adminApiRouter.patch("/volunteers/:id/suspend", async (req, res) => {
  if (!requireCsrf(req, res)) return;
  const userId = parsePositiveInt(req.params.id);
  const suspended = Boolean(req.body?.suspended);
  if (!userId) return res.status(400).json({ error: "invalid_request" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [user] = [] } = await client.query(
      "SELECT id, email FROM userdata WHERE id = $1 FOR UPDATE",
      [userId]
    );
    if (!user) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }

    await client.query(
      "UPDATE userdata SET is_suspended = $1 WHERE id = $2",
      [suspended, userId]
    );

    let sessionsRevoked = 0;
    if (suspended) {
      const { rowCount } = await client.query(
        `
          DELETE FROM user_session
          WHERE (sess::jsonb -> 'passport' ->> 'user') = $1
             OR (sess::jsonb #>> '{passport,user,id}') = $2::text
             OR (sess::jsonb #>> '{passport,user,user_id}') = $2::text
        `,
        [String(user.email || "").toLowerCase(), String(userId)]
      );
      sessionsRevoked = rowCount || 0;
    }

    await client.query("COMMIT");
    return res.json({ success: true, id: userId, is_suspended: suspended, sessions_revoked: sessionsRevoked });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("PATCH /api/admin/volunteers/:id/suspend error:", err);
    return res.status(500).json({ error: "server_error" });
  } finally {
    client.release();
  }
});

adminApiRouter.get("/donors", async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const search = String(req.query.search || "").trim();
    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(
        `(agg.firstname ILIKE $${params.length} OR agg.lastname ILIKE $${params.length} OR agg.email ILIKE $${params.length})`
      );
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const countParams = [...params];
    const { rows: [countRow] = [] } = await pool.query(
      `
        WITH donor_agg AS (
          SELECT
            d.donor_user_id AS user_id,
            u.firstname,
            u.lastname,
            u.email,
            COUNT(*)::int AS transaction_count,
            COALESCE(SUM(d.amount_cents), 0)::bigint AS total_donated_cents,
            MAX(d.created_at) AS last_donation
          FROM donations d
          JOIN userdata u ON u.id = d.donor_user_id
          GROUP BY d.donor_user_id, u.firstname, u.lastname, u.email
        )
        SELECT COUNT(*)::int AS total
        FROM donor_agg agg
        ${whereClause}
      `,
      countParams
    );
    const totalRows = Number(countRow?.total) || 0;

    const dataParams = [...params, limit, offset];
    const { rows } = await pool.query(
      `
        WITH donor_agg AS (
          SELECT
            d.donor_user_id AS user_id,
            u.firstname,
            u.lastname,
            u.email,
            COUNT(*)::int AS transaction_count,
            COALESCE(SUM(d.amount_cents), 0)::bigint AS total_donated_cents,
            MAX(d.created_at) AS last_donation
          FROM donations d
          JOIN userdata u ON u.id = d.donor_user_id
          GROUP BY d.donor_user_id, u.firstname, u.lastname, u.email
        )
        SELECT
          agg.user_id,
          agg.firstname,
          agg.lastname,
          agg.email,
          agg.transaction_count,
          agg.total_donated_cents,
          agg.last_donation
        FROM donor_agg agg
        ${whereClause}
        ORDER BY agg.total_donated_cents DESC, agg.last_donation DESC
        LIMIT $${dataParams.length - 1}
        OFFSET $${dataParams.length}
      `,
      dataParams
    );
    return res.json({
      data: rows.map((row) => ({
      user_id: Number(row.user_id),
      firstname: row.firstname,
      lastname: row.lastname,
      email: row.email,
      transaction_count: Number(row.transaction_count) || 0,
      total_donated_cents: Number(row.total_donated_cents) || 0,
      last_donation: row.last_donation,
      })),
      pagination: buildPagination(page, limit, totalRows),
    });
  } catch (err) {
    console.error("GET /api/admin/donors error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

adminApiRouter.get("/transactions", async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const donorId = parsePositiveInt(req.query.donor_id);
    const from = typeof req.query.from === "string" ? req.query.from : null;
    const to = typeof req.query.to === "string" ? req.query.to : null;
    const conditions = [];
    const params = [];

    if (donorId) {
      params.push(donorId);
      conditions.push(`d.donor_user_id = $${params.length}`);
    }
    if (from) {
      params.push(from);
      conditions.push(`d.created_at >= $${params.length}::timestamptz`);
    }
    if (to) {
      params.push(to);
      conditions.push(`d.created_at < ($${params.length}::timestamptz + interval '1 day')`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const countParams = [...params];
    const { rows: [countRow] = [] } = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM donations d
        ${whereClause}
      `,
      countParams
    );
    const totalRows = Number(countRow?.total) || 0;

    const dataParams = [...params, limit, offset];
    const { rows } = await pool.query(
      `
        SELECT
          d.id,
          d.donor_user_id,
          d.square_payment_id,
          d.amount_cents,
          d.currency,
          d.status,
          d.created_at,
          u.firstname,
          u.lastname,
          u.email
        FROM donations d
        LEFT JOIN userdata u ON u.id = d.donor_user_id
        ${whereClause}
        ORDER BY d.created_at DESC, d.id DESC
        LIMIT $${dataParams.length - 1}
        OFFSET $${dataParams.length}
      `,
      dataParams
    );
    return res.json({
      data: rows,
      pagination: buildPagination(page, limit, totalRows),
    });
  } catch (err) {
    console.error("GET /api/admin/transactions error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

adminApiRouter.get("/credits/log", async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const search = String(req.query.search || "").trim();
    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(
        `(u.firstname ILIKE $${params.length} OR u.lastname ILIKE $${params.length} OR u.email ILIKE $${params.length} OR wt.reason ILIKE $${params.length} OR e.title ILIKE $${params.length})`
      );
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const countParams = [...params];
    const { rows: [countRow] = [] } = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM wallet_transactions wt
        LEFT JOIN userdata u ON u.id = wt.user_id
        LEFT JOIN events e ON e.id = wt.event_id
        ${whereClause}
      `,
      countParams
    );
    const totalRows = Number(countRow?.total) || 0;

    const dataParams = [...params, limit, offset];
    const { rows } = await pool.query(
      `
        SELECT
          wt.id,
          wt.user_id,
          wt.kind_amount,
          wt.direction,
          wt.reason,
          wt.event_id,
          wt.note,
          wt.created_at,
          u.firstname,
          u.lastname,
          u.email,
          e.title AS event_title,
          e.start_at AS event_start_at
        FROM wallet_transactions wt
        LEFT JOIN userdata u ON u.id = wt.user_id
        LEFT JOIN events e ON e.id = wt.event_id
        ${whereClause}
        ORDER BY wt.created_at DESC
        LIMIT $${dataParams.length - 1}
        OFFSET $${dataParams.length}
      `,
      dataParams
    );
    return res.json({
      data: rows,
      pagination: buildPagination(page, limit, totalRows),
    });
  } catch (err) {
    console.error("GET /api/admin/credits/log error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

adminApiRouter.get("/credits/pending", async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const search = String(req.query.search || "").trim();
    const conditions = ["p.status = 'pending'"];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(
        `(u.firstname ILIKE $${params.length} OR u.lastname ILIKE $${params.length} OR u.email ILIKE $${params.length} OR e.title ILIKE $${params.length} OR o.name ILIKE $${params.length})`
      );
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;
    const countParams = [...params];
    const { rows: [countRow] = [] } = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM pending_credit_requests p
        LEFT JOIN userdata u ON u.id = p.volunteer_user_id
        LEFT JOIN events e ON e.id = p.event_id
        LEFT JOIN organizations o ON o.id = p.org_id
        ${whereClause}
      `,
      countParams
    );
    const totalRows = Number(countRow?.total) || 0;

    const dataParams = [...params, limit, offset];
    const { rows } = await pool.query(
      `
        SELECT
          p.id,
          p.event_id,
          p.volunteer_user_id,
          p.org_id,
          p.requested_by,
          p.amount,
          p.reason,
          p.status,
          p.created_at,
          p.reviewed_at,
          p.reviewed_by,
          u.firstname AS volunteer_firstname,
          u.lastname AS volunteer_lastname,
          u.email AS volunteer_email,
          e.title AS event_title,
          o.name AS org_name,
          req.firstname AS requested_by_firstname,
          req.lastname AS requested_by_lastname,
          req.email AS requested_by_email
        FROM pending_credit_requests p
        LEFT JOIN userdata u ON u.id = p.volunteer_user_id
        LEFT JOIN events e ON e.id = p.event_id
        LEFT JOIN organizations o ON o.id = p.org_id
        LEFT JOIN userdata req ON req.id = p.requested_by
        ${whereClause}
        ORDER BY p.created_at ASC, p.id ASC
        LIMIT $${dataParams.length - 1}
        OFFSET $${dataParams.length}
      `,
      dataParams
    );

    return res.json({
      data: rows.map((row) => ({
      id: Number(row.id),
      event_id: row.event_id != null ? String(row.event_id) : null,
      volunteer_user_id: row.volunteer_user_id != null ? Number(row.volunteer_user_id) : null,
      org_id: row.org_id != null ? Number(row.org_id) : null,
      requested_by: row.requested_by != null ? Number(row.requested_by) : null,
      amount: Number(row.amount) || 0,
      reason: row.reason || "earn_shift",
      status: row.status,
      created_at: row.created_at,
      reviewed_at: row.reviewed_at,
      reviewed_by: row.reviewed_by,
      volunteer_name: `${row.volunteer_firstname || ""} ${row.volunteer_lastname || ""}`.trim() || row.volunteer_email || "Unknown",
      volunteer_email: row.volunteer_email || null,
      event_title: row.event_title || null,
      org_name: row.org_name || null,
      requested_by_name:
        `${row.requested_by_firstname || ""} ${row.requested_by_lastname || ""}`.trim() || row.requested_by_email || null,
      requested_by_email: row.requested_by_email || null,
      })),
      pagination: buildPagination(page, limit, totalRows),
    });
  } catch (err) {
    console.error("GET /api/admin/credits/pending error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

adminApiRouter.post("/credits/approve", async (req, res) => {
  if (!requireCsrf(req, res)) return;
  const requestId = parsePositiveInt(req.body?.request_id);
  if (!requestId) return res.status(400).json({ error: "invalid_request" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await approvePendingCreditRequest({
      client,
      requestId,
      reviewedBy: req.user?.email || null,
    });
    if (!result?.ok) {
      await client.query("ROLLBACK");
      return res.status(result?.status || 400).json({ error: result?.error || "approve_failed" });
    }
    await client.query("COMMIT");
    return res.json({
      success: true,
      request: result.request,
      funding: result.funding,
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("POST /api/admin/credits/approve error:", err);
    return res.status(500).json({ error: "server_error" });
  } finally {
    client.release();
  }
});

adminApiRouter.post("/credits/reject", async (req, res) => {
  if (!requireCsrf(req, res)) return;
  const requestId = parsePositiveInt(req.body?.request_id);
  const reason = typeof req.body?.reason === "string" ? req.body.reason : null;
  if (!requestId) return res.status(400).json({ error: "invalid_request" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await rejectPendingCreditRequest({
      client,
      requestId,
      reviewedBy: req.user?.email || null,
      reason,
    });
    if (!result?.ok) {
      await client.query("ROLLBACK");
      return res.status(result?.status || 400).json({ error: result?.error || "reject_failed" });
    }
    await client.query("COMMIT");
    return res.json({
      success: true,
      request: result.request,
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("POST /api/admin/credits/reject error:", err);
    return res.status(500).json({ error: "server_error" });
  } finally {
    client.release();
  }
});

adminApiRouter.post("/credits/approve-bulk", async (req, res) => {
  if (!requireCsrf(req, res)) return;
  const idsRaw = Array.isArray(req.body?.request_ids) ? req.body.request_ids : null;
  if (!idsRaw || !idsRaw.length) return res.status(400).json({ error: "invalid_request" });
  const requestIds = [...new Set(idsRaw.map((value) => parsePositiveInt(value)).filter(Boolean))];
  if (!requestIds.length) return res.status(400).json({ error: "invalid_request_ids" });

  const client = await pool.connect();
  const approved = [];
  const failed = [];
  try {
    for (const requestId of requestIds) {
      await client.query("BEGIN");
      try {
        const result = await approvePendingCreditRequest({
          client,
          requestId,
          reviewedBy: req.user?.email || null,
        });
        if (!result?.ok) {
          await client.query("ROLLBACK");
          failed.push({ request_id: requestId, error: result?.error || "approve_failed", status: result?.status || 400 });
          continue;
        }
        await client.query("COMMIT");
        approved.push({ request_id: requestId, request: result.request, funding: result.funding });
      } catch (err) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        failed.push({ request_id: requestId, error: err?.message || "server_error", status: 500 });
      }
    }
    return res.json({
      success: true,
      requested: requestIds.length,
      approved_count: approved.length,
      failed_count: failed.length,
      approved,
      failed,
    });
  } catch (err) {
    console.error("POST /api/admin/credits/approve-bulk error:", err);
    return res.status(500).json({ error: "server_error" });
  } finally {
    client.release();
  }
});

adminApiRouter.post("/credits/allocate", async (req, res) => {
  if (!requireCsrf(req, res)) return;
  const userId = parsePositiveInt(req.body?.user_id);
  const amount = parsePositiveInt(req.body?.amount);
  const reason = String(req.body?.reason || "").trim().toLowerCase();
  const eventId = req.body?.event_id != null ? String(req.body.event_id).trim() : null;

  if (!userId || !amount || !WALLET_REASON_SET.has(reason)) {
    return res.status(400).json({ error: "invalid_request" });
  }

  try {
    const { rows: [tx] = [] } = await pool.query(
      `
        INSERT INTO wallet_transactions
          (user_id, kind_amount, direction, reason, event_id, note)
        VALUES
          ($1, $2, 'credit', $3, $4, $5)
        RETURNING *
      `,
      [userId, amount, reason, eventId || null, `admin_allocate:${req.user?.email || "system"}`]
    );
    return res.json({ success: true, transaction: tx });
  } catch (err) {
    console.error("POST /api/admin/credits/allocate error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

export default adminApiRouter;
