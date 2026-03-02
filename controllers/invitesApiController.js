import pool from "../Backend/db/pg.js";

const PAGE_SIZE = 20;
const MAX_LIMIT = 100;

function clampLimit(value) {
  const num = Number(value);
  const fallback = Number.isFinite(num) ? num : PAGE_SIZE;
  return Math.min(Math.max(fallback, 1), MAX_LIMIT);
}

function clampOffset(value) {
  const num = Number(value);
  return Math.max(Number.isFinite(num) ? num : 0, 0);
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

function sanitizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function writeInviteModerationLog({
  eventId,
  inviteId,
  senderUserId,
  recipientUserId,
  action,
  reason,
  metadata = {},
}) {
  try {
    await pool.query(
      `
        INSERT INTO invite_moderation_logs (
          event_id,
          invite_id,
          sender_user_id,
          recipient_user_id,
          action,
          reason,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      `,
      [
        eventId || null,
        inviteId || null,
        senderUserId || null,
        recipientUserId || null,
        action || "unknown",
        reason || null,
        JSON.stringify(metadata || {}),
      ]
    );
  } catch (error) {
    if (error?.code === "42P01") return;
    console.error("[invitesApi] moderation log write failed:", error);
  }
}

export async function listInvites(req, res) {
  try {
    const userId = await resolveUserId(req);
    const type = (req.query.type || "incoming").toLowerCase() === "outgoing" ? "outgoing" : "incoming";
    const limit = clampLimit(req.query.limit);
    const offset = clampOffset(req.query.offset);

    const bindings = [userId, limit, offset];
    let sql;
    if (type === "incoming") {
      sql = `
        SELECT i.id,
               i.event_id,
               e.title         AS event_title,
               e.start_at      AS event_starts_at,
               TRIM(sender.firstname || ' ' || COALESCE(sender.lastname, '')) AS host_name,
               i.status,
               i.invitee_email,
               i.invitee_name
          FROM invites i
          JOIN events e        ON e.id = i.event_id
          JOIN userdata sender ON sender.id = i.sender_user_id
     LEFT JOIN invite_sender_blocks b
            ON b.blocker_user_id = $1
           AND b.blocked_user_id = i.sender_user_id
         WHERE i.recipient_user_id = $1
           AND b.blocked_user_id IS NULL
         ORDER BY i.created_at DESC
         LIMIT $2 OFFSET $3
      `;
    } else {
      sql = `
        SELECT i.id,
               i.event_id,
               e.title         AS event_title,
               e.start_at      AS event_starts_at,
               COALESCE(i.invitee_name, TRIM(invitee.firstname || ' ' || COALESCE(invitee.lastname, '')), i.invitee_email) AS invitee_name,
               i.invitee_email,
               i.status
          FROM invites i
          JOIN events e        ON e.id = i.event_id
     LEFT JOIN userdata invitee ON invitee.id = i.recipient_user_id
         WHERE i.sender_user_id = $1
         ORDER BY i.created_at DESC
         LIMIT $2 OFFSET $3
      `;
    }

    let rows = [];
    try {
      ({ rows } = await pool.query(sql, bindings));
    } catch (error) {
      if (type === "incoming" && error?.code === "42P01") {
        // Backward-compatible fallback until invite_sender_blocks migration is applied.
        const fallbackSql = `
          SELECT i.id,
                 i.event_id,
                 e.title         AS event_title,
                 e.start_at      AS event_starts_at,
                 TRIM(sender.firstname || ' ' || COALESCE(sender.lastname, '')) AS host_name,
                 i.status,
                 i.invitee_email,
                 i.invitee_name
            FROM invites i
            JOIN events e        ON e.id = i.event_id
            JOIN userdata sender ON sender.id = i.sender_user_id
           WHERE i.recipient_user_id = $1
           ORDER BY i.created_at DESC
           LIMIT $2 OFFSET $3
        `;
        ({ rows } = await pool.query(fallbackSql, bindings));
      } else {
        throw error;
      }
    }

    const enriched = (rows || []).map((row) => ({
      ...row,
      event_time_label: row.event_starts_at ? formatTimeLabel(row.event_starts_at) : null,
    }));

    return res.json({
      ok: true,
      data: enriched,
      paging: {
        limit,
        offset: offset + enriched.length,
        count: enriched.length,
      },
    });
  } catch (error) {
    console.error("[invitesApi] listInvites error:", error);
    return res.status(500).json({ ok: false, error: error.message || "Unable to load invites" });
  }
}

export async function updateInvite(req, res) {
  try {
    const userId = await resolveUserId(req);
    const inviteId = req.params.id;
    const action = (req.body?.action || "").toLowerCase();
    if (!["accept", "decline"].includes(action)) {
      return res.status(400).json({ ok: false, error: "Invalid action" });
    }

    let invite;
    try {
      const { rows } = await pool.query(
        `
          SELECT id, recipient_user_id, status
            FROM invites
           WHERE id = $1
        `,
        [inviteId]
      );
      invite = rows[0];
    } catch (error) {
      if (error?.code === "42P01") {
        return res.status(500).json({
          ok: false,
          error: "Invites table is missing. Please run migrations.",
        });
      }
      throw error;
    }

    if (!invite) {
      return res.status(404).json({ ok: false, error: "Invite not found" });
    }
    if (String(invite.recipient_user_id) !== userId) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }
    if (invite.status !== "pending") {
      return res.json({ ok: true, data: { id: inviteId, status: invite.status } });
    }

    const status = action === "accept" ? "accepted" : "declined";
    await pool.query(
      `
        UPDATE invites
           SET status = $1,
               responded_at = NOW()
         WHERE id = $2
      `,
      [status, inviteId]
    );

    return res.json({ ok: true, data: { id: inviteId, status } });
  } catch (error) {
    console.error("[invitesApi] updateInvite error:", error);
    return res.status(500).json({ ok: false, error: "Unable to update invite" });
  }
}

export async function deleteInvite(req, res) {
  try {
    const userId = await resolveUserId(req);
    const inviteId = req.params.id;

    let invite;
    try {
      const { rows } = await pool.query(
        `
          SELECT id, sender_user_id, status
            FROM invites
           WHERE id = $1
        `,
        [inviteId]
      );
      invite = rows[0];
    } catch (error) {
      if (error?.code === "42P01") {
        return res.status(500).json({
          ok: false,
          error: "Invites table is missing. Please run migrations.",
        });
      }
      throw error;
    }

    if (!invite) {
      return res.status(404).json({ ok: false, error: "Invite not found" });
    }
    if (String(invite.sender_user_id) !== userId) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }
    if (invite.status !== "pending") {
      return res.status(409).json({
        ok: false,
        error: "Only pending invites can be cancelled",
      });
    }

    await pool.query("DELETE FROM invites WHERE id = $1", [inviteId]);
    return res.json({ ok: true, data: { id: inviteId, deleted: true } });
  } catch (error) {
    console.error("[invitesApi] deleteInvite error:", error);
    return res.status(500).json({ ok: false, error: "Unable to cancel invite" });
  }
}

export async function reportInvite(req, res) {
  try {
    const userId = await resolveUserId(req);
    const inviteId = req.params.id;
    const reason = sanitizeText(req.body?.reason) || "abuse";

    const { rows: [invite] } = await pool.query(
      `
        SELECT id, event_id, sender_user_id, recipient_user_id, status
          FROM invites
         WHERE id = $1
         LIMIT 1
      `,
      [inviteId]
    );

    if (!invite) {
      return res.status(404).json({ ok: false, error: "Invite not found" });
    }
    if (String(invite.recipient_user_id) !== userId) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    await pool.query(
      `
        INSERT INTO invite_abuse_reports (
          invite_id,
          reporter_user_id,
          sender_user_id,
          event_id,
          reason,
          status
        )
        VALUES ($1, $2, $3, $4, $5, 'open')
        ON CONFLICT (invite_id, reporter_user_id)
        DO UPDATE SET reason = EXCLUDED.reason, status = 'open', updated_at = NOW()
      `,
      [inviteId, userId, invite.sender_user_id, invite.event_id, reason]
    );

    await writeInviteModerationLog({
      eventId: invite.event_id,
      inviteId,
      senderUserId: invite.sender_user_id,
      recipientUserId: userId,
      action: "invite_reported",
      reason,
      metadata: { status: invite.status },
    });

    return res.json({ ok: true, data: { id: inviteId, reported: true } });
  } catch (error) {
    if (error?.code === "42P01") {
      return res.status(500).json({
        ok: false,
        error: "Invite reporting tables are missing. Please run migrations.",
      });
    }
    console.error("[invitesApi] reportInvite error:", error);
    return res.status(500).json({ ok: false, error: "Unable to report invite" });
  }
}

export async function blockInviteSender(req, res) {
  try {
    const userId = await resolveUserId(req);
    const inviteId = req.params.id;

    const { rows: [invite] } = await pool.query(
      `
        SELECT id, event_id, sender_user_id, recipient_user_id
          FROM invites
         WHERE id = $1
         LIMIT 1
      `,
      [inviteId]
    );

    if (!invite) {
      return res.status(404).json({ ok: false, error: "Invite not found" });
    }
    if (String(invite.recipient_user_id) !== userId) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    await pool.query(
      `
        INSERT INTO invite_sender_blocks (blocker_user_id, blocked_user_id)
        VALUES ($1, $2)
        ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING
      `,
      [userId, invite.sender_user_id]
    );

    const { rowCount } = await pool.query(
      `
        UPDATE invites
           SET status = 'declined',
               responded_at = NOW()
         WHERE recipient_user_id = $1
           AND sender_user_id = $2
           AND status = 'pending'
      `,
      [userId, invite.sender_user_id]
    );

    await writeInviteModerationLog({
      eventId: invite.event_id,
      inviteId,
      senderUserId: invite.sender_user_id,
      recipientUserId: userId,
      action: "sender_blocked",
      reason: "recipient_blocked_sender",
      metadata: { pending_invites_closed: rowCount || 0 },
    });

    return res.json({
      ok: true,
      data: {
        id: inviteId,
        blocked: true,
        pending_closed: rowCount || 0,
      },
    });
  } catch (error) {
    if (error?.code === "42P01") {
      return res.status(500).json({
        ok: false,
        error: "Invite block tables are missing. Please run migrations.",
      });
    }
    console.error("[invitesApi] blockInviteSender error:", error);
    return res.status(500).json({ ok: false, error: "Unable to block sender" });
  }
}

function formatTimeLabel(iso) {
  try {
    const dt = new Date(iso);
    return dt.toLocaleString("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}
