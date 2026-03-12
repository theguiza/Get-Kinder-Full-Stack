import express from "express";
import pool from "../Backend/db/pg.js";
import { sendNudgeEmail } from "../kindnessEmailer.js";
import { resolveOrgScope, setSessionActiveOrg } from "../services/orgScopeService.js";
import { getVolunteerStats } from "../services/profileService.js";
import { getSummary as getRatingsSummary } from "../services/ratingsService.js";

const orgPortalRouter = express.Router();
const CSRF_HEADER_NAME = "X-CSRF-Token";
const POOL_SCOPE_SEP = "__";

async function getPortalScope(req) {
  if (!req._orgPortalScopePromise) {
    req._orgPortalScopePromise = resolveOrgScope(req, {
      allowAdminPreview: true,
      includeOrgMembersForOrgRep: true,
    });
  }
  return req._orgPortalScopePromise;
}

async function resolveUserId(req) {
  const scope = await getPortalScope(req);
  return scope.actorUserId;
}

async function resolveUserIdCandidates(req) {
  const scope = await getPortalScope(req);
  return scope.memberUserIds;
}

function mapMembershipRows(scope) {
  return Array.isArray(scope?.memberships)
    ? scope.memberships
        .map((entry) => ({
          org_id: Number(entry?.orgId),
          org_name: entry?.org_name || "",
          org_status: entry?.org_status || "",
          role: entry?.role || "admin",
        }))
        .filter((entry) => Number.isInteger(entry.org_id) && entry.org_id > 0)
    : [];
}

function requireCsrf(req, res) {
  const expectedCsrf = req.session?.csrfToken;
  const providedCsrf = req.get(CSRF_HEADER_NAME);
  if (!expectedCsrf || !providedCsrf || providedCsrf !== expectedCsrf) {
    res.status(403).json({ error: "invalid csrf token" });
    return false;
  }
  return true;
}

orgPortalRouter.use(async (req, res, next) => {
  try {
    const scope = await getPortalScope(req);
    if (!scope?.hasOrgRepAccess || !scope?.orgId) {
      return res.status(403).json({ error: "forbidden" });
    }

    const activeMembership = Array.isArray(scope?.memberships)
      ? scope.memberships.find((entry) => Number(entry?.orgId) === Number(scope.orgId))
      : null;
    const activeOrgStatus = String(activeMembership?.org_status || "").trim().toLowerCase();
    const isSuspendedOrg = activeOrgStatus === "suspended";
    const allowDuringSuspension =
      (req.method === "GET" && req.path === "/context") ||
      (req.method === "POST" && req.path === "/active-org");
    if (isSuspendedOrg && !allowDuringSuspension) {
      return res.status(403).json({
        error: "org_suspended",
        message: "Organization access is suspended. Please contact kai@getkinder.ai.",
      });
    }

    return next();
  } catch (error) {
    console.error("[orgPortal] scope middleware error:", error);
    return res.status(500).json({ error: "server_error" });
  }
});

orgPortalRouter.get("/context", async (req, res) => {
  try {
    const scope = await getPortalScope(req);
    return res.json({
      ok: true,
      active_org_id: scope.orgId != null ? Number(scope.orgId) : null,
      memberships: mapMembershipRows(scope),
      preview_user_id: scope.previewUserId || null,
    });
  } catch (error) {
    console.error("GET /api/org/context error:", error);
    return res.status(500).json({ error: "server_error" });
  }
});

orgPortalRouter.post("/active-org", async (req, res) => {
  if (!requireCsrf(req, res)) return;
  try {
    const orgIdRaw = req.body?.org_id ?? req.body?.orgId;
    const switched = await setSessionActiveOrg(req, orgIdRaw, { allowAdminPreview: true });
    if (!switched?.ok) {
      const status = switched?.error === "invalid_org_id" ? 400 : 403;
      return res.status(status).json({ error: switched?.error || "forbidden" });
    }

    delete req._orgPortalScopePromise;
    const scope = await getPortalScope(req);
    return res.json({
      ok: true,
      active_org_id: scope.orgId != null ? Number(scope.orgId) : null,
      memberships: mapMembershipRows(scope),
    });
  } catch (error) {
    console.error("POST /api/org/active-org error:", error);
    return res.status(500).json({ error: "server_error" });
  }
});

const ZERO_PENDING_ACTION_COUNTS = Object.freeze({
  pending_join_count: 0,
  pending_verify_count: 0,
  pending_actions_count: 0,
  approved_count: 0,
  checked_in_count: 0,
  total_count: 0,
});

function normalizePendingActionCounts(row = {}) {
  return {
    pending_join_count: Number(row?.pending_join_count) || 0,
    pending_verify_count: Number(row?.pending_verify_count) || 0,
    pending_actions_count: Number(row?.pending_actions_count) || 0,
    approved_count: Number(row?.approved_count) || 0,
    checked_in_count: Number(row?.checked_in_count) || 0,
    total_count: Number(row?.total_count) || 0,
  };
}

async function fetchPendingActionCountsByEventIds(eventIds = []) {
  const normalizedIds = [...new Set(
    (Array.isArray(eventIds) ? eventIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];

  if (!normalizedIds.length) return new Map();

  const { rows } = await pool.query(
    `
      SELECT
        r.event_id::text AS event_id,
        COUNT(*)::int AS total_count,
        COUNT(*) FILTER (WHERE r.status = 'pending')::int AS pending_join_count,
        COUNT(*) FILTER (
          WHERE r.status IN ('accepted', 'checked_in')
            AND COALESCE(r.verification_status, 'pending') = 'pending'
        )::int AS pending_verify_count,
        (
          COUNT(*) FILTER (WHERE r.status = 'pending')
          + COUNT(*) FILTER (
            WHERE r.status IN ('accepted', 'checked_in')
              AND COALESCE(r.verification_status, 'pending') = 'pending'
          )
        )::int AS pending_actions_count,
        COUNT(*) FILTER (WHERE r.status = 'accepted')::int AS approved_count,
        COUNT(*) FILTER (WHERE r.checked_in_at IS NOT NULL)::int AS checked_in_count
      FROM event_rsvps r
      WHERE r.event_id::text = ANY($1::text[])
      GROUP BY r.event_id
    `,
    [normalizedIds]
  );

  const countsByEventId = new Map();
  rows.forEach((row) => {
    countsByEventId.set(String(row.event_id || "").trim(), normalizePendingActionCounts(row));
  });
  return countsByEventId;
}

async function getNudgesOutboxColumnSet() {
  const { rows } = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'nudges_outbox'
    `
  );
  return new Set(rows.map((row) => String(row.column_name || "").trim()).filter(Boolean));
}

function pickFirstColumn(columnSet, candidates = []) {
  for (const columnName of candidates) {
    if (columnSet.has(columnName)) return columnName;
  }
  return null;
}

function normalizeCommsType(rawType) {
  const value = String(rawType || "").trim().toLowerCase();
  if (value === "thankyou" || value === "reminder" || value === "feedback") return value;
  if (value.startsWith("comms-")) {
    const normalized = value.replace(/^comms-/, "");
    if (normalized === "thankyou" || normalized === "reminder" || normalized === "feedback") {
      return normalized;
    }
  }
  return null;
}

function normalizeCommsChannel(rawChannel) {
  const value = String(rawChannel || "").trim().toLowerCase();
  if (value === "inapp" || value === "in-app") return "inapp";
  if (value === "email") return "email";
  return "email";
}

function formatCommsDate(isoValue) {
  if (!isoValue) return "Date TBD";
  const dt = new Date(isoValue);
  if (Number.isNaN(dt.getTime())) return "Date TBD";
  return dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatCommsTime(isoValue) {
  if (!isoValue) return "Time TBD";
  const dt = new Date(isoValue);
  if (Number.isNaN(dt.getTime())) return "Time TBD";
  return dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function replaceCommsMergeFields(sourceText, context) {
  const raw = String(sourceText || "");
  if (!raw) return raw;

  const firstName = context?.firstName || "Volunteer";
  const eventTitle = context?.eventTitle || "Opportunity";
  const eventDate = context?.eventDate || "Date TBD";
  const eventTime = context?.eventTime || "Time TBD";
  const hours = Number.isFinite(Number(context?.hours)) ? Number(context.hours) : 0;
  const credits = Number.isFinite(Number(context?.credits)) ? Number(context.credits) : 0;

  let output = raw
    .replace(/\[First Name\]/gi, firstName)
    .replace(/\[(Food Drive|Tutoring|Book Drive)\]/g, eventTitle)
    .replace(/\[Date\]/g, eventDate)
    .replace(/\[Time\]/g, eventTime)
    .replace(/\[X\]\s*impact\s*credits?/gi, `${credits} impact credits`)
    .replace(/\[X\]\s*credits?/gi, `${credits} credits`)
    .replace(/\[X\]\s*hrs?/gi, `${hours} hrs`)
    .replace(/\[X\]/g, String(hours));

  return output;
}

function extractSubjectAndBody({ subject, body }) {
  const bodyText = String(body || "").replace(/\r\n/g, "\n");
  let resolvedSubject = String(subject || "").trim();
  let resolvedBody = bodyText;

  if (!resolvedSubject) {
    const subjectMatch = bodyText.match(/^Subject:\s*(.+)\n?/i);
    if (subjectMatch) {
      resolvedSubject = String(subjectMatch[1] || "").trim();
      resolvedBody = bodyText.replace(/^Subject:\s*.+\n?/i, "").trimStart();
    }
  }

  if (!resolvedSubject) resolvedSubject = "Get Kinder update";
  return { subject: resolvedSubject, body: resolvedBody };
}

function buildOutboxEventExpr(columnSet, alias = "n") {
  const eventColumn = pickFirstColumn(columnSet, ["event_id", "opportunity_id"]);
  if (eventColumn) {
    return `${alias}.${eventColumn}::text`;
  }
  if (columnSet.has("meta")) return `(${alias}.meta->>'event_id')`;
  return "NULL::text";
}

function buildOutboxTypeExpr(columnSet, alias = "n") {
  const typeColumn = pickFirstColumn(columnSet, ["type", "message_type", "nudge_type"]);
  if (typeColumn) {
    return `LOWER(COALESCE(${alias}.${typeColumn}::text, ''))`;
  }
  if (columnSet.has("meta")) return `LOWER(COALESCE(${alias}.meta->>'type', ''))`;
  return "''";
}

async function insertCommsOutboxRow(columnSet, payload) {
  const ownerColumn = pickFirstColumn(columnSet, [
    "owner_user_id",
    "coordinator_user_id",
    "sender_user_id",
    "user_id",
  ]);
  const eventColumn = pickFirstColumn(columnSet, ["event_id", "opportunity_id"]);
  const typeColumn = pickFirstColumn(columnSet, ["type", "message_type", "nudge_type"]);
  const toAddressColumn = pickFirstColumn(columnSet, ["to_address", "to_email", "recipient_email"]);
  const bodyTextColumn = pickFirstColumn(columnSet, ["body_text", "body"]);

  if (!ownerColumn) {
    throw new Error("nudges_outbox owner column not found");
  }

  const columns = [];
  const values = [];
  const placeholders = [];
  const push = (columnName, value) => {
    columns.push(columnName);
    values.push(value);
    placeholders.push(`$${values.length}`);
  };

  push(ownerColumn, payload.ownerUserId);
  if (eventColumn) push(eventColumn, payload.eventId);
  if (typeColumn) push(typeColumn, payload.commsType);
  if (columnSet.has("channel")) push("channel", payload.outboxChannel);
  if (toAddressColumn) push(toAddressColumn, payload.toAddress || null);
  if (columnSet.has("subject")) push("subject", payload.subject || null);
  if (bodyTextColumn) push(bodyTextColumn, payload.bodyText || null);
  if (columnSet.has("body_html")) push("body_html", null);
  if (columnSet.has("send_after")) push("send_after", payload.sendAfterIso);
  if (columnSet.has("status")) push("status", "sent");
  if (columnSet.has("meta")) push("meta", payload.meta);

  await pool.query(
    `
      INSERT INTO nudges_outbox (${columns.join(", ")})
      VALUES (${placeholders.join(", ")})
    `,
    values
  );
}

async function ensureHostOwnsEvent(eventId, hostUserId) {
  const { rows: [eventRow] } = await pool.query(
    "SELECT id, title, creator_user_id, capacity, start_at FROM events WHERE id::text = $1::text LIMIT 1",
    [eventId]
  );
  if (!eventRow) return { ok: false, status: 404, error: "event not found" };
  const allowedHostIds = Array.isArray(hostUserId)
    ? hostUserId.map((id) => String(id))
    : [String(hostUserId)];
  if (!allowedHostIds.includes(String(eventRow.creator_user_id))) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true, event: eventRow };
}

orgPortalRouter.get("/comms/queue", async (req, res) => {
  try {
    const coordinatorUserIds = await resolveUserIdCandidates(req);
    const outboxColumns = await getNudgesOutboxColumnSet();
    const ownerColumn = pickFirstColumn(outboxColumns, [
      "owner_user_id",
      "coordinator_user_id",
      "sender_user_id",
      "user_id",
    ]);
    const sentAtColumn = pickFirstColumn(outboxColumns, ["sent_at", "created_at", "updated_at", "send_after"]);
    const outboxEventExpr = buildOutboxEventExpr(outboxColumns, "n");
    const outboxTypeExpr = buildOutboxTypeExpr(outboxColumns, "n");

    const ownerExistsFilter = ownerColumn ? `AND n.${ownerColumn}::text = ANY($1::text[])` : "";
    const ownerHistoryFilter = ownerColumn
      ? `n.${ownerColumn}::text = ANY($1::text[])`
      : `e.creator_user_id::text = ANY($1::text[])`;
    const statusFilter = outboxColumns.has("status") ? "AND COALESCE(n.status, 'sent') <> 'failed'" : "";
    const sentAtExpr = sentAtColumn ? `n.${sentAtColumn}` : "NOW()";
    const subjectExpr = outboxColumns.has("subject") ? "n.subject" : "NULL";
    const channelExpr = outboxColumns.has("channel") ? "n.channel" : "NULL";
    const recipientCountExpr = outboxColumns.has("meta")
      ? "COALESCE((n.meta->>'recipient_count')::int, 1)"
      : "1";
    const metaChannelExpr = outboxColumns.has("meta") ? "n.meta->>'channel'" : "NULL";

    const { rows: sendNowRows } = await pool.query(
      `
        SELECT
          e.id,
          e.title,
          e.start_at,
          e.end_at,
          COUNT(r.id)::int AS recipient_count
        FROM events e
        JOIN event_rsvps r
          ON r.event_id = e.id
         AND r.status = 'accepted'
        WHERE e.creator_user_id::text = ANY($1::text[])
          AND e.end_at < NOW()
          AND NOT EXISTS (
            SELECT 1
            FROM nudges_outbox n
            WHERE ${outboxEventExpr} = e.id::text
              AND ${outboxTypeExpr} = 'thankyou'
              ${ownerExistsFilter}
              ${statusFilter}
          )
        GROUP BY e.id, e.title, e.start_at, e.end_at
        ORDER BY e.end_at DESC
      `,
      [coordinatorUserIds]
    );

    const { rows: dueSoonRows } = await pool.query(
      `
        SELECT
          e.id,
          e.title,
          e.start_at,
          e.end_at,
          COUNT(r.id)::int AS recipient_count
        FROM events e
        JOIN event_rsvps r
          ON r.event_id = e.id
         AND r.status = 'accepted'
        WHERE e.creator_user_id::text = ANY($1::text[])
          AND e.start_at BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
          AND NOT EXISTS (
            SELECT 1
            FROM nudges_outbox n
            WHERE ${outboxEventExpr} = e.id::text
              AND ${outboxTypeExpr} = 'reminder'
              ${ownerExistsFilter}
              ${statusFilter}
          )
        GROUP BY e.id, e.title, e.start_at, e.end_at
        ORDER BY e.start_at ASC
      `,
      [coordinatorUserIds]
    );

    const { rows: upcomingRows } = await pool.query(
      `
        SELECT
          e.id,
          e.title,
          e.start_at,
          e.end_at,
          COUNT(r.id)::int AS recipient_count
        FROM events e
        JOIN event_rsvps r
          ON r.event_id = e.id
         AND r.status = 'accepted'
        WHERE e.creator_user_id::text = ANY($1::text[])
          AND e.start_at > NOW() + INTERVAL '2 days'
          AND e.start_at <= NOW() + INTERVAL '5 days'
          AND NOT EXISTS (
            SELECT 1
            FROM nudges_outbox n
            WHERE ${outboxEventExpr} = e.id::text
              AND ${outboxTypeExpr} = 'reminder'
              ${ownerExistsFilter}
              ${statusFilter}
          )
        GROUP BY e.id, e.title, e.start_at, e.end_at
        ORDER BY e.start_at ASC
      `,
      [coordinatorUserIds]
    );

    const { rows: sentRows } = await pool.query(
      `
        SELECT
          n.id::text AS id,
          ${outboxEventExpr} AS event_id,
          ${outboxTypeExpr} AS type,
          COALESCE(e.title, ${subjectExpr}, 'Untitled event') AS title,
          ${sentAtExpr} AS sent_at,
          ${recipientCountExpr} AS recipient_count,
          COALESCE(${metaChannelExpr}, ${channelExpr}, 'email') AS channel
        FROM nudges_outbox n
        LEFT JOIN events e
          ON e.id::text = ${outboxEventExpr}
        WHERE ${ownerHistoryFilter}
        ORDER BY ${sentAtExpr} DESC NULLS LAST, n.id DESC
        LIMIT 10
      `,
      [coordinatorUserIds]
    );

    const mapSuggestion = (row, commsType) => ({
      id: `${commsType}-${String(row.id)}`,
      eventId: String(row.id),
      title: row.title || "Untitled event",
      start_at: row.start_at,
      end_at: row.end_at,
      recipient_count: Number(row.recipient_count) || 0,
      type: commsType,
    });

    return res.json({
      sendNow: sendNowRows.map((row) => mapSuggestion(row, "thankyou")),
      dueSoon: dueSoonRows.map((row) => mapSuggestion(row, "reminder")),
      upcoming: upcomingRows.map((row) => mapSuggestion(row, "reminder")),
      sentHistory: sentRows.map((row) => ({
        id: row.id,
        eventId: row.event_id ? String(row.event_id) : null,
        type: normalizeCommsType(row.type) || "reminder",
        title: row.title || "Untitled event",
        sent_at: row.sent_at,
        recipient_count: Number(row.recipient_count) || 0,
        channel: String(row.channel || "email").toLowerCase(),
      })),
    });
  } catch (error) {
    console.error("[orgPortalApi] GET /comms/queue error:", error);
    return res.status(500).json({ error: "Unable to load comms queue" });
  }
});

orgPortalRouter.post("/comms/send", async (req, res) => {
  try {
    if (!requireCsrf(req, res)) return;

    const coordinatorUserId = await resolveUserId(req);
    const coordinatorUserIds = await resolveUserIdCandidates(req);
    const outboxColumns = await getNudgesOutboxColumnSet();

    const eventId = String(req.body?.eventId || "").trim();
    const commsType = normalizeCommsType(req.body?.type);
    const normalizedChannel = normalizeCommsChannel(req.body?.channel);
    const requestedRecipientIds = Array.isArray(req.body?.recipientUserIds)
      ? req.body.recipientUserIds
      : [];
    const recipientUserIds = [...new Set(
      requestedRecipientIds
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isInteger(value) && value > 0)
    )];

    if (!eventId) return res.status(400).json({ success: false, error: "eventId is required" });
    if (!commsType) return res.status(400).json({ success: false, error: "type is invalid" });
    if (!recipientUserIds.length) {
      return res.status(400).json({ success: false, error: "recipientUserIds is required" });
    }

    const ownership = await ensureHostOwnsEvent(eventId, coordinatorUserIds);
    if (!ownership.ok) return res.status(ownership.status).json({ success: false, error: ownership.error });

    const { subject: rawSubject, body: rawBody } = extractSubjectAndBody({
      subject: req.body?.subject,
      body: req.body?.body,
    });

    const { rows: [coordinatorRow] = [] } = await pool.query(
      `
        SELECT firstname, email
        FROM userdata
        WHERE id = $1
        LIMIT 1
      `,
      [coordinatorUserId]
    );

    const { rows: recipientRows } = await pool.query(
      `
        WITH credits_by_user AS (
          SELECT
            wt.user_id,
            wt.event_id,
            COALESCE(SUM(wt.kind_amount), 0)::numeric AS credits_earned
          FROM wallet_transactions wt
          WHERE wt.reason = 'earn_shift'
            AND wt.direction = 'credit'
          GROUP BY wt.user_id, wt.event_id
        )
        SELECT
          u.id AS user_id,
          u.firstname,
          u.lastname,
          u.email,
          COALESCE(r.attended_minutes, 0)::numeric AS attended_minutes,
          COALESCE(c.credits_earned, 0)::numeric AS credits_earned
        FROM userdata u
        LEFT JOIN event_rsvps r
          ON r.attendee_user_id = u.id
         AND r.event_id = $1
        LEFT JOIN credits_by_user c
          ON c.user_id = u.id
         AND c.event_id = $1
        WHERE u.id = ANY($2::int[])
      `,
      [eventId, recipientUserIds]
    );

    const recipientById = new Map(
      recipientRows.map((row) => [String(row.user_id), row])
    );

    const recipientCount = recipientUserIds.length;
    const sendAfterIso = new Date().toISOString();
    const eventDateText = formatCommsDate(ownership.event?.start_at);
    const eventTimeText = formatCommsTime(ownership.event?.start_at);
    const ownerFirstName = String(coordinatorRow?.firstname || "").trim() || "Coordinator";
    const ownerEmail = coordinatorRow?.email || null;
    const outboxChannel = normalizedChannel === "email" ? "email" : "email";
    const batchId = `org-comms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    let sentCount = 0;
    const errors = [];

    for (const recipientUserId of recipientUserIds) {
      const recipient = recipientById.get(String(recipientUserId));
      if (!recipient) {
        errors.push({ userId: recipientUserId, error: "recipient not found" });
        continue;
      }

      const recipientFirstName = String(recipient.firstname || "").trim() || "Volunteer";
      const recipientEmail = String(recipient.email || "").trim();
      const hoursValue = Number(recipient.attended_minutes || 0) / 60;
      const creditsValue = Number(recipient.credits_earned || 0);
      const mergeContext = {
        firstName: recipientFirstName,
        eventTitle: ownership.event?.title || "Opportunity",
        eventDate: eventDateText,
        eventTime: eventTimeText,
        hours: Number.isFinite(hoursValue) ? Number(hoursValue.toFixed(1)) : 0,
        credits: Number.isFinite(creditsValue) ? Number(creditsValue.toFixed(2)) : 0,
      };

      const subject = replaceCommsMergeFields(rawSubject, mergeContext);
      const bodyText = replaceCommsMergeFields(rawBody, mergeContext);

      try {
        if (normalizedChannel === "email") {
          if (!recipientEmail) throw new Error("recipient email missing");
          await sendNudgeEmail({
            to: recipientEmail,
            subject,
            text: bodyText,
            fromName: `${ownerFirstName} via Get Kinder`,
            replyTo: ownerEmail,
          });
        }

        await insertCommsOutboxRow(outboxColumns, {
          ownerUserId: coordinatorUserId,
          eventId,
          commsType,
          outboxChannel,
          toAddress: recipientEmail || null,
          subject,
          bodyText,
          sendAfterIso,
          meta: {
            event_id: String(eventId),
            type: commsType,
            channel: normalizedChannel,
            recipient_user_id: Number(recipientUserId),
            recipient_name: `${recipient.firstname || ""} ${recipient.lastname || ""}`.trim() || recipientEmail,
            recipient_count: recipientCount,
            batch_id: batchId,
            source: "org_portal",
          },
        });

        sentCount += 1;
      } catch (sendError) {
        errors.push({
          userId: Number(recipientUserId),
          email: recipientEmail || null,
          error: sendError?.message || "send failed",
        });
      }
    }

    if (errors.length) {
      return res.status(207).json({
        success: false,
        sentCount,
        errors,
      });
    }

    return res.json({ success: true, sentCount });
  } catch (error) {
    console.error("[orgPortalApi] POST /comms/send error:", error);
    return res.status(500).json({ success: false, error: "Unable to send communications" });
  }
});

orgPortalRouter.get("/queue", async (req, res) => {
  try {
    const coordinatorUserIds = await resolveUserIdCandidates(req);

    const { rows: [countRow] = [] } = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM events
        WHERE creator_user_id::text = ANY($1::text[])
      `,
      [coordinatorUserIds]
    );
    const hasOpportunities = Number(countRow?.total || 0) > 0;

    const { rows: upcomingCandidateRows } = await pool.query(
      `
        SELECT
          e.id AS event_id,
          e.title AS event_title,
          e.start_at,
          e.end_at,
          e.tz,
          e.capacity
        FROM events e
        WHERE e.creator_user_id::text = ANY($1::text[])
          AND COALESCE(e.status, 'published') NOT IN ('cancelled', 'draft')
          AND (e.start_at > NOW() OR e.start_at IS NULL)
        ORDER BY e.start_at ASC NULLS LAST
      `,
      [coordinatorUserIds]
    );
    const pendingCountsByEventId = await fetchPendingActionCountsByEventIds(
      upcomingCandidateRows.map((row) => row.event_id)
    );

    const { rows: activeRows } = await pool.query(
      `
        SELECT
          e.id AS event_id,
          e.title AS event_title,
          e.start_at,
          e.end_at,
          e.tz,
          COUNT(*) FILTER (WHERE r.status = 'accepted')::int AS active_volunteers
        FROM events e
        LEFT JOIN event_rsvps r ON r.event_id = e.id
        WHERE e.creator_user_id::text = ANY($1::text[])
          AND COALESCE(e.status, 'published') NOT IN ('cancelled', 'draft')
          AND e.start_at <= NOW()
          AND (e.end_at >= NOW() OR e.end_at IS NULL)
        GROUP BY e.id
        ORDER BY e.start_at DESC
      `,
      [coordinatorUserIds]
    );

    const { rows: draftRows } = await pool.query(
      `
        SELECT
          e.id AS event_id,
          e.title AS event_title,
          e.start_at,
          e.end_at,
          e.tz,
          e.capacity,
          COUNT(*) FILTER (WHERE r.status = 'accepted')::int AS approved_count
        FROM events e
        LEFT JOIN event_rsvps r ON r.event_id = e.id
        WHERE e.creator_user_id::text = ANY($1::text[])
          AND COALESCE(e.status, 'published') = 'draft'
        GROUP BY e.id
        ORDER BY e.updated_at DESC NULLS LAST, e.start_at ASC NULLS LAST
      `,
      [coordinatorUserIds]
    );

    const { rows: completedRows } = await pool.query(
      `
        SELECT
          e.id AS event_id,
          e.title AS event_title,
          e.start_at,
          e.end_at,
          e.tz
        FROM events e
        WHERE e.creator_user_id::text = ANY($1::text[])
          AND COALESCE(e.status, 'published') NOT IN ('cancelled', 'draft')
          AND e.end_at < NOW()
        ORDER BY e.end_at DESC
        LIMIT 5
      `,
      [coordinatorUserIds]
    );

    const { rows: cancelledRows } = await pool.query(
      `
        SELECT
          e.id AS event_id,
          e.title AS event_title,
          e.start_at,
          e.end_at,
          e.tz
        FROM events e
        WHERE e.creator_user_id::text = ANY($1::text[])
          AND e.status = 'cancelled'
        ORDER BY e.updated_at DESC NULLS LAST, e.start_at DESC NULLS LAST
        LIMIT 10
      `,
      [coordinatorUserIds]
    );

    const needsAttention = [];
    const upcoming = [];
    upcomingCandidateRows.forEach((row) => {
      const eventId = String(row.event_id || "").trim();
      const counts = pendingCountsByEventId.get(eventId) || ZERO_PENDING_ACTION_COUNTS;
      const payload = {
        id: `${counts.pending_actions_count > 0 ? "needs-attention" : "upcoming"}-${eventId}`,
        type: counts.pending_actions_count > 0 ? "opp-approval" : "opp-upcoming",
        label: `${row.event_title}`,
        opportunityId: eventId,
        opportunityName: row.event_title,
        pendingCount: counts.pending_actions_count,
        pendingJoinCount: counts.pending_join_count,
        pendingVerifyCount: counts.pending_verify_count,
        pendingActionsCount: counts.pending_actions_count,
        approvedCount: counts.approved_count,
        capacity: row.capacity == null ? null : Number(row.capacity),
        startTime: row.start_at,
        endTime: row.end_at,
        startTz: row.tz || null,
      };
      if (counts.pending_actions_count > 0) needsAttention.push(payload);
      else upcoming.push(payload);
    });

    const active = activeRows.map((row) => ({
      id: `active-${row.event_id}`,
      type: "opp-active",
      label: `${row.event_title}`,
      opportunityId: String(row.event_id),
      opportunityName: row.event_title,
      activeVolunteers: Number(row.active_volunteers) || 0,
      startTime: row.start_at,
      endTime: row.end_at,
      startTz: row.tz || null,
    }));

    const drafts = draftRows.map((row) => ({
      id: `draft-${row.event_id}`,
      type: "opp-draft",
      label: `${row.event_title}`,
      opportunityId: String(row.event_id),
      opportunityName: row.event_title,
      approvedCount: Number(row.approved_count) || 0,
      capacity: row.capacity == null ? null : Number(row.capacity),
      startTime: row.start_at,
      endTime: row.end_at,
      startTz: row.tz || null,
    }));

    const completed = completedRows.map((row) => ({
      id: `completed-${row.event_id}`,
      type: "opp-completed",
      label: `${row.event_title}`,
      opportunityId: String(row.event_id),
      opportunityName: row.event_title,
      startTime: row.start_at,
      endTime: row.end_at,
      startTz: row.tz || null,
    }));

    const cancelled = cancelledRows.map((row) => ({
      id: `cancelled-${row.event_id}`,
      type: "opp-cancelled",
      label: `${row.event_title}`,
      opportunityId: String(row.event_id),
      opportunityName: row.event_title,
      startTime: row.start_at,
      endTime: row.end_at,
      startTz: row.tz || null,
    }));

    return res.json({
      needsAttention,
      upcoming,
      active,
      drafts,
      completed,
      cancelled,
      hasOpportunities,
    });
  } catch (error) {
    console.error("[orgPortalApi] GET /queue error:", error);
    return res.status(500).json({ error: "Unable to load org queue" });
  }
});

orgPortalRouter.get("/opportunities", async (req, res) => {
  try {
    const hostUserIds = await resolveUserIdCandidates(req);
    const { rows } = await pool.query(
      `
        SELECT
          e.id,
          e.title,
          e.start_at,
          e.end_at,
          e.tz,
          e.status,
          e.capacity
        FROM events e
        WHERE e.creator_user_id::text = ANY($1::text[])
        ORDER BY e.start_at DESC NULLS LAST, e.id DESC
      `,
      [hostUserIds]
    );
    const pendingCountsByEventId = await fetchPendingActionCountsByEventIds(rows.map((row) => row.id));

    const data = rows.map((row) => ({
      ...(pendingCountsByEventId.get(String(row.id)) || ZERO_PENDING_ACTION_COUNTS),
      id: String(row.id),
      title: row.title,
      start_at: row.start_at,
      end_at: row.end_at,
      tz: row.tz || null,
      status: row.status,
      capacity: row.capacity != null ? Number(row.capacity) : null,
      total: (pendingCountsByEventId.get(String(row.id)) || ZERO_PENDING_ACTION_COUNTS).total_count,
      pending: (pendingCountsByEventId.get(String(row.id)) || ZERO_PENDING_ACTION_COUNTS).pending_actions_count,
      approved: (pendingCountsByEventId.get(String(row.id)) || ZERO_PENDING_ACTION_COUNTS).approved_count,
      checked_in: (pendingCountsByEventId.get(String(row.id)) || ZERO_PENDING_ACTION_COUNTS).checked_in_count,
    }));

    return res.json(data);
  } catch (error) {
    console.error("[orgPortalApi] GET /opportunities error:", error);
    return res.status(500).json({ error: "Unable to load opportunities" });
  }
});

orgPortalRouter.get("/opportunities/:eventId/applicants", async (req, res) => {
  try {
    const hostUserIds = await resolveUserIdCandidates(req);
    const eventId = String(req.params.eventId || "").trim();
    if (!eventId) return res.status(400).json({ error: "eventId is required" });

    const hostCheck = await ensureHostOwnsEvent(eventId, hostUserIds);
    if (!hostCheck.ok) return res.status(hostCheck.status).json({ error: hostCheck.error });
    const pendingCountsByEventId = await fetchPendingActionCountsByEventIds([eventId]);
    const counts = pendingCountsByEventId.get(String(eventId)) || ZERO_PENDING_ACTION_COUNTS;

    const { rows } = await pool.query(
      `
        SELECT
          r.attendee_user_id AS user_id,
          u.firstname,
          u.lastname,
          u.picture AS picture,
          u.sdg1,
          u.sdg2,
          u.sdg3,
          u.home_base_label,
          u.city,
          u.state,
          COALESCE(
            NULLIF(TRIM(COALESCE(u.firstname, '') || ' ' || COALESCE(u.lastname, '')), ''),
            u.email,
            'Volunteer #' || r.attendee_user_id::text
          ) AS name,
          u.email,
          r.status AS rsvp_status,
          r.attended_minutes,
          COALESCE(r.verification_status, 'pending') AS verification_status,
          r.checked_in_at,
          COALESCE(tx.past_shifts, 0)::int AS past_shifts,
          COALESCE(tx.past_credits, 0)::numeric AS past_credits
        FROM event_rsvps r
        LEFT JOIN userdata u ON u.id = r.attendee_user_id
        LEFT JOIN (
          SELECT
            wt.user_id,
            COUNT(*)::int AS past_shifts,
            COALESCE(SUM(wt.kind_amount), 0)::numeric AS past_credits
          FROM wallet_transactions wt
          WHERE wt.reason = 'earn_shift'
          GROUP BY wt.user_id
        ) tx ON tx.user_id = r.attendee_user_id
        WHERE r.event_id = $1
        ORDER BY r.created_at ASC
      `,
      [eventId]
    );

    const baseData = rows.map((row) => ({
      userId: String(row.user_id),
      firstname: row.firstname || "",
      lastname: row.lastname || "",
      picture: row.picture || "",
      sdg1: row.sdg1 || "",
      sdg2: row.sdg2 || "",
      sdg3: row.sdg3 || "",
      homeBaseLabel: row.home_base_label || "",
      city: row.city || "",
      state: row.state || "",
      name: row.name,
      email: row.email,
      rsvpStatus: row.rsvp_status,
      attendedMinutes: row.attended_minutes == null ? null : Number(row.attended_minutes),
      verificationStatus: row.verification_status,
      checkedInAt: row.checked_in_at,
      pastShifts: Number(row.past_shifts) || 0,
      pastCredits: Number(row.past_credits) || 0,
    }));

    const data = await Promise.all(baseData.map(async (applicant) => {
      const locationParts = [applicant.city, applicant.state]
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      const locationLabel = String(applicant.homeBaseLabel || "").trim()
        || (locationParts.length ? locationParts.join(", ") : "");

      let volunteerStats = {
        reliability_score: 0,
        verified_hours_total: 0,
        priority_tier: "Bronze",
      };
      try {
        volunteerStats = await getVolunteerStats(applicant.userId);
      } catch (error) {
        console.warn("[orgPortalApi] getVolunteerStats failed:", error?.message || error);
      }

      let ratingValue = 5;
      let ratingCount = 0;
      let ratingStarsFilled = 5;
      try {
        const summary = await getRatingsSummary({ userId: applicant.userId, limit: 20 });
        const count = Number(summary?.sampleSize) || 0;
        const hasRatings = count > 0 && Number.isFinite(Number(summary?.kindnessRating));
        const value = hasRatings ? Number(summary.kindnessRating) : 5;
        ratingValue = value;
        ratingCount = count;
        ratingStarsFilled = Math.max(1, Math.min(5, Math.round(value)));
      } catch (error) {
        if (error?.code !== "42P01") {
          console.warn("[orgPortalApi] ratings summary failed:", error?.message || error);
        }
      }

      return {
        ...applicant,
        reliabilityScore: Number(volunteerStats?.reliability_score) || 0,
        verifiedHours: Number(volunteerStats?.verified_hours_total) || 0,
        priorityTier: String(volunteerStats?.priority_tier || "Bronze"),
        ratingValue,
        ratingCount,
        ratingStarsFilled,
        locationLabel,
      };
    }));

    return res.json({ applicants: data, counts });
  } catch (error) {
    console.error("[orgPortalApi] GET /opportunities/:eventId/applicants error:", error);
    return res.status(500).json({ error: "Unable to load applicants" });
  }
});

orgPortalRouter.post("/opportunities/:eventId/applicants/:userId/approve", async (req, res) => {
  try {
    if (!requireCsrf(req, res)) return;
    const hostUserIds = await resolveUserIdCandidates(req);
    const eventId = String(req.params.eventId || "").trim();
    const userId = String(req.params.userId || "").trim();
    if (!eventId || !userId) return res.status(400).json({ error: "eventId and userId are required" });

    const hostCheck = await ensureHostOwnsEvent(eventId, hostUserIds);
    if (!hostCheck.ok) return res.status(hostCheck.status).json({ error: hostCheck.error });

    const { rows } = await pool.query(
      `
        UPDATE event_rsvps
           SET status = 'accepted',
               updated_at = NOW()
         WHERE event_id = $1
           AND attendee_user_id = $2
         RETURNING status
      `,
      [eventId, userId]
    );

    if (!rows[0]) return res.status(404).json({ error: "applicant not found" });
    return res.json({ success: true, rsvpStatus: rows[0].status });
  } catch (error) {
    console.error("[orgPortalApi] POST approve error:", error);
    return res.status(500).json({ error: "Unable to approve applicant" });
  }
});

orgPortalRouter.post("/opportunities/:eventId/applicants/:userId/decline", async (req, res) => {
  try {
    if (!requireCsrf(req, res)) return;
    const hostUserIds = await resolveUserIdCandidates(req);
    const eventId = String(req.params.eventId || "").trim();
    const userId = String(req.params.userId || "").trim();
    if (!eventId || !userId) return res.status(400).json({ error: "eventId and userId are required" });

    const hostCheck = await ensureHostOwnsEvent(eventId, hostUserIds);
    if (!hostCheck.ok) return res.status(hostCheck.status).json({ error: hostCheck.error });

    const { rows } = await pool.query(
      `
        UPDATE event_rsvps
           SET status = 'declined',
               updated_at = NOW()
         WHERE event_id = $1
           AND attendee_user_id = $2
         RETURNING status
      `,
      [eventId, userId]
    );

    if (!rows[0]) return res.status(404).json({ error: "applicant not found" });
    return res.json({ success: true, rsvpStatus: rows[0].status });
  } catch (error) {
    console.error("[orgPortalApi] POST decline error:", error);
    return res.status(500).json({ error: "Unable to decline applicant" });
  }
});

orgPortalRouter.get("/credits", async (req, res) => {
  try {
    const hostUserIds = await resolveUserIdCandidates(req);

    const { rows: pendingRows } = await pool.query(
      `
        SELECT
          e.id,
          e.title,
          e.start_at,
          COUNT(r.id)::int AS volunteer_count,
          COALESCE(SUM(COALESCE(r.attended_minutes, 0)) / 60.0, 0)::numeric AS total_hours,
          (COUNT(r.id) * 2)::numeric AS estimated_credits
        FROM events e
        JOIN event_rsvps r
          ON r.event_id = e.id
         AND r.status = 'accepted'
         AND r.verification_status = 'pending'
        WHERE e.creator_user_id::text = ANY($1::text[])
        GROUP BY e.id, e.title, e.start_at
        ORDER BY e.start_at DESC NULLS LAST
      `,
      [hostUserIds]
    );

    const { rows: reconciledRows } = await pool.query(
      `
        WITH verified_events AS (
          SELECT
            e.id,
            e.title,
            e.start_at,
            COUNT(r.id)::int AS volunteer_count,
            COALESCE(SUM(COALESCE(r.attended_minutes, 0)) / 60.0, 0)::numeric AS total_hours
          FROM events e
          JOIN event_rsvps r
            ON r.event_id = e.id
           AND r.status = 'accepted'
           AND r.verification_status = 'verified'
          WHERE e.creator_user_id::text = ANY($1::text[])
          GROUP BY e.id, e.title, e.start_at
        ),
        credits_by_event AS (
          SELECT
            w.event_id,
            COALESCE(SUM(w.kind_amount), 0)::numeric AS actual_credits
          FROM wallet_transactions w
          JOIN events e ON e.id = w.event_id
          WHERE e.creator_user_id::text = ANY($1::text[])
            AND w.reason = 'earn_shift'
            AND w.direction = 'credit'
          GROUP BY w.event_id
        )
        SELECT
          ve.id,
          ve.title,
          ve.start_at,
          ve.volunteer_count,
          ve.total_hours,
          COALESCE(cbe.actual_credits, 0)::numeric AS actual_credits
        FROM verified_events ve
        LEFT JOIN credits_by_event cbe ON cbe.event_id = ve.id
        ORDER BY ve.start_at DESC NULLS LAST
      `,
      [hostUserIds]
    );

    const { rows: volunteerRows } = await pool.query(
      `
        SELECT
          u.id,
          u.firstname,
          u.lastname,
          COUNT(DISTINCT w.event_id)::int AS shift_count,
          COALESCE(SUM(w.kind_amount), 0)::numeric AS lifetime_credits
        FROM wallet_transactions w
        JOIN userdata u ON u.id = w.user_id
        JOIN events e ON e.id = w.event_id
        WHERE e.creator_user_id::text = ANY($1::text[])
          AND w.reason = 'earn_shift'
          AND w.direction = 'credit'
        GROUP BY u.id, u.firstname, u.lastname
        ORDER BY lifetime_credits DESC
      `,
      [hostUserIds]
    );

    return res.json({
      pendingReconcile: pendingRows.map((row) => ({
        id: String(row.id),
        title: row.title,
        start_at: row.start_at,
        volunteer_count: Number(row.volunteer_count) || 0,
        total_hours: Number(row.total_hours) || 0,
        estimated_credits: Number(row.estimated_credits) || 0,
      })),
      reconciled: reconciledRows.map((row) => ({
        id: String(row.id),
        title: row.title,
        start_at: row.start_at,
        volunteer_count: Number(row.volunteer_count) || 0,
        total_hours: Number(row.total_hours) || 0,
        actual_credits: Number(row.actual_credits) || 0,
      })),
      volunteerSummary: volunteerRows.map((row) => ({
        id: String(row.id),
        firstname: row.firstname || "",
        lastname: row.lastname || "",
        shift_count: Number(row.shift_count) || 0,
        lifetime_credits: Number(row.lifetime_credits) || 0,
      })),
    });
  } catch (error) {
    console.error("[orgPortalApi] GET /credits error:", error);
    return res.status(500).json({ error: "Unable to load credits queue" });
  }
});

orgPortalRouter.get("/credits/:eventId", async (req, res) => {
  try {
    const hostUserIds = await resolveUserIdCandidates(req);
    const eventId = String(req.params.eventId || "").trim();
    if (!eventId) return res.status(400).json({ ok: false, error: "eventId is required" });

    const hostCheck = await ensureHostOwnsEvent(eventId, hostUserIds);
    if (!hostCheck.ok) return res.status(hostCheck.status).json({ ok: false, error: hostCheck.error });

    const { rows } = await pool.query(
      `
        SELECT
          u.id,
          u.firstname,
          u.lastname,
          r.attended_minutes,
          r.verification_status,
          COALESCE(SUM(w.kind_amount), 0)::numeric AS credits_earned
        FROM event_rsvps r
        JOIN userdata u ON u.id = r.attendee_user_id
        LEFT JOIN wallet_transactions w
          ON w.user_id = r.attendee_user_id
         AND w.event_id = r.event_id
         AND w.reason = 'earn_shift'
         AND w.direction = 'credit'
        WHERE r.event_id = $1
          AND r.status = 'accepted'
        GROUP BY u.id, u.firstname, u.lastname, r.attended_minutes, r.verification_status
        ORDER BY u.firstname ASC, u.lastname ASC
      `,
      [eventId]
    );

    return res.json({
      ok: true,
      data: rows.map((row) => ({
        id: String(row.id),
        firstname: row.firstname || "",
        lastname: row.lastname || "",
        attended_minutes: row.attended_minutes == null ? null : Number(row.attended_minutes),
        verification_status: row.verification_status || "pending",
        credits_earned: Number(row.credits_earned) || 0,
      })),
    });
  } catch (error) {
    console.error("[orgPortalApi] GET /credits/:eventId error:", error);
    return res.status(500).json({ ok: false, error: "Unable to load credit detail" });
  }
});

orgPortalRouter.get("/reports", async (req, res) => {
  try {
    const hostUserIds = await resolveUserIdCandidates(req);
    const rawRange = String(req.query?.range || "30").trim();
    const rangeDays = [7, 30, 90].includes(Number(rawRange)) ? Number(rawRange) : 30;
    const opportunityId = String(req.query?.opportunityId || "all").trim();
    const volunteerId = String(req.query?.volunteerId || "all").trim();

    const { rows: hoursRows } = await pool.query(
      `
        WITH months AS (
          SELECT generate_series(
            date_trunc('month', NOW()) - INTERVAL '3 months',
            date_trunc('month', NOW()) - INTERVAL '1 month',
            INTERVAL '1 month'
          ) AS month_start
        ),
        hours_by_month AS (
          SELECT
            date_trunc('month', e.start_at) AS month_start,
            COALESCE(SUM(COALESCE(r.attended_minutes, 0)) / 60.0, 0)::numeric AS hours
          FROM events e
          JOIN event_rsvps r ON r.event_id = e.id
          WHERE e.creator_user_id::text = ANY($1::text[])
            AND e.start_at >= date_trunc('month', NOW()) - INTERVAL '3 months'
            AND e.start_at < date_trunc('month', NOW())
            AND r.verification_status = 'verified'
          GROUP BY date_trunc('month', e.start_at)
        )
        SELECT
          to_char(m.month_start, 'Mon') AS month,
          COALESCE(h.hours, 0)::numeric AS hours
        FROM months m
        LEFT JOIN hours_by_month h ON h.month_start = m.month_start
        ORDER BY m.month_start
      `,
      [hostUserIds]
    );

    const { rows: fillRows } = await pool.query(
      `
        WITH months AS (
          SELECT generate_series(
            date_trunc('month', NOW()) - INTERVAL '3 months',
            date_trunc('month', NOW()) - INTERVAL '1 month',
            INTERVAL '1 month'
          ) AS month_start
        ),
        per_event AS (
          SELECT
            date_trunc('month', e.start_at) AS month_start,
            e.id,
            e.capacity::numeric AS capacity,
            COUNT(r.id) FILTER (WHERE r.status = 'accepted')::numeric AS accepted_count
          FROM events e
          LEFT JOIN event_rsvps r ON r.event_id = e.id
          WHERE e.creator_user_id::text = ANY($1::text[])
            AND e.start_at >= date_trunc('month', NOW()) - INTERVAL '3 months'
            AND e.start_at < date_trunc('month', NOW())
            AND e.capacity IS NOT NULL
            AND e.capacity > 0
          GROUP BY date_trunc('month', e.start_at), e.id, e.capacity
        ),
        fill_by_month AS (
          SELECT
            month_start,
            COALESCE(AVG(LEAST(1.0, accepted_count / capacity)) * 100, 0)::numeric AS rate
          FROM per_event
          GROUP BY month_start
        )
        SELECT
          to_char(m.month_start, 'Mon') AS month,
          COALESCE(f.rate, 0)::numeric AS rate
        FROM months m
        LEFT JOIN fill_by_month f ON f.month_start = m.month_start
        ORDER BY m.month_start
      `,
      [hostUserIds]
    );

    const { rows: impactRows } = await pool.query(
      `
        WITH months AS (
          SELECT generate_series(
            date_trunc('month', NOW()) - INTERVAL '3 months',
            date_trunc('month', NOW()) - INTERVAL '1 month',
            INTERVAL '1 month'
          ) AS month_start
        ),
        impact_by_month AS (
          SELECT
            date_trunc('month', e.start_at) AS month_start,
            COALESCE(SUM(w.kind_amount), 0)::numeric AS value
          FROM events e
          LEFT JOIN wallet_transactions w
            ON w.event_id = e.id
           AND w.reason = 'earn_shift'
           AND w.direction = 'credit'
          WHERE e.creator_user_id::text = ANY($1::text[])
            AND e.start_at >= date_trunc('month', NOW()) - INTERVAL '3 months'
            AND e.start_at < date_trunc('month', NOW())
          GROUP BY date_trunc('month', e.start_at)
        )
        SELECT
          to_char(m.month_start, 'Mon') AS month,
          COALESCE(i.value, 0)::numeric AS value
        FROM months m
        LEFT JOIN impact_by_month i ON i.month_start = m.month_start
        ORDER BY m.month_start
      `,
      [hostUserIds]
    );

    const { rows: [noShowRow] = [] } = await pool.query(
      `
        WITH per_event AS (
          SELECT
            e.id,
            COUNT(*) FILTER (WHERE r.no_show = true)::numeric AS no_show_count,
            COUNT(*) FILTER (WHERE r.status = 'accepted')::numeric AS accepted_count
          FROM events e
          LEFT JOIN event_rsvps r ON r.event_id = e.id
          WHERE e.creator_user_id::text = ANY($1::text[])
            AND e.start_at >= NOW() - ($2 * INTERVAL '1 day')
          GROUP BY e.id
        )
        SELECT
          CASE
            WHEN COALESCE(SUM(accepted_count), 0) > 0
              THEN ROUND((SUM(no_show_count) / SUM(accepted_count)) * 100, 1)
            ELSE 0
          END::numeric AS no_show_rate
        FROM per_event
      `,
      [hostUserIds, rangeDays]
    );

    const topVolParams = [hostUserIds, rangeDays];
    const topVolWhere = [
      "e.creator_user_id::text = ANY($1::text[])",
      "e.start_at >= NOW() - ($2 * INTERVAL '1 day')",
      "r.status = 'accepted'",
    ];
    if (opportunityId !== "all") {
      topVolParams.push(opportunityId);
      topVolWhere.push(`e.id::text = $${topVolParams.length}`);
    }
    if (volunteerId !== "all") {
      topVolParams.push(volunteerId);
      topVolWhere.push(`r.attendee_user_id::text = $${topVolParams.length}`);
    }

    const { rows: topVolRows } = await pool.query(
      `
        WITH credits_per_shift AS (
          SELECT
            w.user_id,
            w.event_id,
            COALESCE(SUM(w.kind_amount), 0)::numeric AS credits
          FROM wallet_transactions w
          WHERE w.reason = 'earn_shift'
            AND w.direction = 'credit'
          GROUP BY w.user_id, w.event_id
        )
        SELECT
          u.firstname,
          u.lastname,
          COALESCE(SUM(COALESCE(r.attended_minutes, 0)) / 60.0, 0)::numeric AS total_hours,
          COALESCE(SUM(COALESCE(c.credits, 0)), 0)::numeric AS total_credits,
          COUNT(DISTINCT r.event_id)::int AS shift_count
        FROM event_rsvps r
        JOIN events e ON e.id = r.event_id
        JOIN userdata u ON u.id = r.attendee_user_id
        LEFT JOIN credits_per_shift c
          ON c.user_id = r.attendee_user_id
         AND c.event_id = r.event_id
        WHERE ${topVolWhere.join(" AND ")}
        GROUP BY u.id, u.firstname, u.lastname
        ORDER BY total_credits DESC
        LIMIT 10
      `,
      topVolParams
    );

    const { rows: opportunityRows } = await pool.query(
      `
        SELECT id, title
        FROM events
        WHERE creator_user_id::text = ANY($1::text[])
        ORDER BY start_at DESC NULLS LAST, id DESC
      `,
      [hostUserIds]
    );

    const { rows: volunteerRows } = await pool.query(
      `
        SELECT DISTINCT
          u.id,
          u.firstname,
          u.lastname
        FROM event_rsvps r
        JOIN events e ON e.id = r.event_id
        JOIN userdata u ON u.id = r.attendee_user_id
        WHERE e.creator_user_id::text = ANY($1::text[])
        ORDER BY u.firstname ASC, u.lastname ASC
      `,
      [hostUserIds]
    );

    return res.json({
      hoursByMonth: hoursRows.map((row) => ({
        month: row.month,
        hours: Number(row.hours) || 0,
      })),
      fillRateByMonth: fillRows.map((row) => ({
        month: row.month,
        rate: Number(row.rate) || 0,
      })),
      noShowRate: Number(noShowRow?.no_show_rate) || 0,
      impactByMonth: impactRows.map((row) => ({
        month: row.month,
        value: Number(row.value) || 0,
      })),
      topVolunteers: topVolRows.map((row) => ({
        firstname: row.firstname || "",
        lastname: row.lastname || "",
        total_hours: Number(row.total_hours) || 0,
        total_credits: Number(row.total_credits) || 0,
        shift_count: Number(row.shift_count) || 0,
      })),
      opportunityList: opportunityRows.map((row) => ({
        id: String(row.id),
        title: row.title || "Untitled event",
      })),
      volunteerList: volunteerRows.map((row) => ({
        id: String(row.id),
        firstname: row.firstname || "",
        lastname: row.lastname || "",
      })),
    });
  } catch (error) {
    console.error("[orgPortalApi] GET /reports error:", error);
    return res.status(500).json({ error: "Unable to load reports data" });
  }
});

orgPortalRouter.get("/kpis", async (req, res) => {
  try {
    const hostUserIds = await resolveUserIdCandidates(req);

    const { rows: [hoursRow] = [] } = await pool.query(
      `
        SELECT COALESCE(SUM(COALESCE(r.attended_minutes, 0)), 0)::numeric / 60.0 AS total_hours
        FROM event_rsvps r
        JOIN events e ON e.id = r.event_id
        WHERE e.creator_user_id::text = ANY($1::text[])
          AND r.verification_status = 'verified'
      `,
      [hostUserIds]
    );

    const { rows: [fillRow] = [] } = await pool.query(
      `
        WITH per_event AS (
          SELECT
            e.id,
            e.capacity::numeric AS capacity,
            COUNT(r.id)::numeric AS accepted_count
          FROM events e
          LEFT JOIN event_rsvps r
            ON r.event_id = e.id
           AND r.status = 'accepted'
          WHERE e.creator_user_id::text = ANY($1::text[])
            AND e.capacity IS NOT NULL
            AND e.capacity > 0
          GROUP BY e.id, e.capacity
        )
        SELECT COALESCE(ROUND(AVG(LEAST(1.0, accepted_count / capacity)) * 100, 1), 0)::numeric AS fill_rate
        FROM per_event
      `,
      [hostUserIds]
    );

    const scopedPoolPrefixes = hostUserIds.map((id) => `u${id}${POOL_SCOPE_SEP}`);
    const { rows: [creditsRow] = [] } = await pool.query(
      `
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
          )::numeric AS impact_credits
        FROM funding_pools fp
        JOIN UNNEST($1::text[]) pref(prefix)
          ON LEFT(fp.slug, LENGTH(pref.prefix)) = pref.prefix
        LEFT JOIN pool_transactions pt ON pt.pool_id = fp.id
      `,
      [scopedPoolPrefixes]
    );

    const { rows: [noShowRow] = [] } = await pool.query(
      `
        WITH per_event AS (
          SELECT
            e.id,
            COUNT(*) FILTER (WHERE r.no_show = true)::numeric AS no_show_count,
            COUNT(*) FILTER (WHERE r.status = 'accepted')::numeric AS accepted_count
          FROM events e
          LEFT JOIN event_rsvps r ON r.event_id = e.id
          WHERE e.creator_user_id::text = ANY($1::text[])
          GROUP BY e.id
        )
        SELECT
          CASE
            WHEN COALESCE(SUM(accepted_count), 0) > 0
              THEN ROUND((SUM(no_show_count) / SUM(accepted_count)) * 100, 1)
            ELSE 0
          END::numeric AS no_show_rate
        FROM per_event
      `,
      [hostUserIds]
    );

    const { rows: [lastEventCountRow] = [] } = await pool.query(
      `
        SELECT COUNT(*)::int AS event_count
        FROM events
        WHERE creator_user_id::text = ANY($1::text[])
          AND start_at >= NOW() - INTERVAL '30 days'
          AND start_at < NOW()
      `,
      [hostUserIds]
    );

    const { rows: [prevEventCountRow] = [] } = await pool.query(
      `
        SELECT COUNT(*)::int AS event_count
        FROM events
        WHERE creator_user_id::text = ANY($1::text[])
          AND start_at >= NOW() - INTERVAL '60 days'
          AND start_at < NOW() - INTERVAL '30 days'
      `,
      [hostUserIds]
    );

    const { rows: [lastHoursRow] = [] } = await pool.query(
      `
        SELECT COALESCE(SUM(COALESCE(r.attended_minutes, 0)), 0)::numeric / 60.0 AS hours
        FROM event_rsvps r
        JOIN events e ON e.id = r.event_id
        WHERE e.creator_user_id::text = ANY($1::text[])
          AND e.start_at >= NOW() - INTERVAL '30 days'
          AND e.start_at < NOW()
          AND r.verification_status = 'verified'
      `,
      [hostUserIds]
    );

    const { rows: [prevHoursRow] = [] } = await pool.query(
      `
        SELECT COALESCE(SUM(COALESCE(r.attended_minutes, 0)), 0)::numeric / 60.0 AS hours
        FROM event_rsvps r
        JOIN events e ON e.id = r.event_id
        WHERE e.creator_user_id::text = ANY($1::text[])
          AND e.start_at >= NOW() - INTERVAL '60 days'
          AND e.start_at < NOW() - INTERVAL '30 days'
          AND r.verification_status = 'verified'
      `,
      [hostUserIds]
    );

    const { rows: [lastFillRow] = [] } = await pool.query(
      `
        WITH per_event AS (
          SELECT
            e.id,
            e.capacity::numeric AS capacity,
            COUNT(r.id)::numeric AS accepted_count
          FROM events e
          LEFT JOIN event_rsvps r
            ON r.event_id = e.id
           AND r.status = 'accepted'
          WHERE e.creator_user_id::text = ANY($1::text[])
            AND e.start_at >= NOW() - INTERVAL '30 days'
            AND e.start_at < NOW()
            AND e.capacity IS NOT NULL
            AND e.capacity > 0
          GROUP BY e.id, e.capacity
        )
        SELECT COALESCE(ROUND(AVG(LEAST(1.0, accepted_count / capacity)) * 100, 1), 0)::numeric AS fill_rate
        FROM per_event
      `,
      [hostUserIds]
    );

    const { rows: [prevFillRow] = [] } = await pool.query(
      `
        WITH per_event AS (
          SELECT
            e.id,
            e.capacity::numeric AS capacity,
            COUNT(r.id)::numeric AS accepted_count
          FROM events e
          LEFT JOIN event_rsvps r
            ON r.event_id = e.id
           AND r.status = 'accepted'
          WHERE e.creator_user_id::text = ANY($1::text[])
            AND e.start_at >= NOW() - INTERVAL '60 days'
            AND e.start_at < NOW() - INTERVAL '30 days'
            AND e.capacity IS NOT NULL
            AND e.capacity > 0
          GROUP BY e.id, e.capacity
        )
        SELECT COALESCE(ROUND(AVG(LEAST(1.0, accepted_count / capacity)) * 100, 1), 0)::numeric AS fill_rate
        FROM per_event
      `,
      [hostUserIds]
    );

    const totalHours = Number(hoursRow?.total_hours) || 0;
    const fillRate = Number(fillRow?.fill_rate) || 0;
    const impactCredits = Number(creditsRow?.impact_credits) || 0;
    const noShowRate = Number(noShowRow?.no_show_rate) || 0;

    const hasLast30 = Number(lastEventCountRow?.event_count) > 0;
    const hasPrev30 = Number(prevEventCountRow?.event_count) > 0;

    const totalHoursChange = hasLast30 && hasPrev30
      ? (Number(lastHoursRow?.hours) || 0) - (Number(prevHoursRow?.hours) || 0)
      : 0;

    const fillRateChange = hasLast30 && hasPrev30
      ? (Number(lastFillRow?.fill_rate) || 0) - (Number(prevFillRow?.fill_rate) || 0)
      : 0;

    return res.json({
      totalHours: Math.round(totalHours * 10) / 10,
      fillRate: Math.round(fillRate * 10) / 10,
      impactCredits: Math.round(impactCredits * 1000) / 1000,
      noShowRate: Math.round(noShowRate * 10) / 10,
      totalHoursChange: Math.round(totalHoursChange * 10) / 10,
      fillRateChange: Math.round(fillRateChange * 10) / 10,
    });
  } catch (error) {
    console.error("[orgPortalApi] GET /kpis error:", error);
    return res.status(500).json({ error: "Unable to load KPIs" });
  }
});

export default orgPortalRouter;
