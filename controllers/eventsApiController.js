import pool from "../Backend/db/pg.js";
import { fetchEvents, fetchEventById } from "../services/eventsService.js";
import { sendProspectInviteEmail } from "../kindnessEmailer.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const VISIBILITY_SET = new Set(["public", "fof", "private"]);
const STATUS_SET = new Set(["draft", "published"]);
const ATTENDANCE_SET = new Set(["host_code", "social_proof", "geo"]);
const HOST_INVITE_ALLOWED_STATUSES = new Set(["published", "draft"]);
const EDITABLE_STATUS_SET = new Set(["draft", "published"]);
const RSVP_ACTION_TO_STATUS = new Map([
  ["accept", "accepted"],
  ["decline", "declined"],
]);
const CHECKIN_METHOD_SET = new Set(["host_code", "social_proof", "geo"]);
const INVITE_TONES = {
  friendly: {
    subject: "{{hostName}} invited you to {{eventTitle}}",
    body: `I'd love for you to join me for {{eventTitle}}. It's happening {{eventSummary}} at {{eventLocation}}. Tap the link so we can plan together!`
  },
  hype: {
    subject: "Let's GO – {{eventTitle}} is on!",
    body: `I just locked in {{eventTitle}} and it would be way more fun if you came. {{eventSummary}} · {{eventLocation}}. Grab your spot and let's make it happen.`
  },
  thoughtful: {
    subject: "An invite from {{hostName}}",
    body: `I've been thinking of you and hope you can make {{eventTitle}}. We're meeting {{eventSummary}} at {{eventLocation}}. RSVP if you can join—would mean a lot to see you there.`
  }
};

function clampLimit(value) {
  const num = Number(value);
  const fallback = Number.isFinite(num) ? num : DEFAULT_LIMIT;
  return Math.min(Math.max(fallback, 1), MAX_LIMIT);
}

function clampOffset(value) {
  const num = Number(value);
  return Math.max(Number.isFinite(num) ? num : 0, 0);
}

function sanitizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseTimeRangeInput(value) {
  if (typeof value !== "string") return null;
  const delimiter = value.includes("–") ? "–" : "-";
  const [startRaw, endRaw] = value.split(delimiter).map((part) => part?.trim());
  if (!startRaw || !endRaw) return null;

  const start = parseTime(startRaw);
  const end = parseTime(endRaw);
  if (!start || !end) return null;
  const startTotal = start.hour * 60 + start.minute;
  const endTotal = end.hour * 60 + end.minute;
  if (endTotal <= startTotal) return null;
  return { start, end };
}

function parseTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function zonedTimeToUtc(dateStr, time, tz) {
  if (!dateStr || !time || !tz) return null;
  const [year, month, day] = dateStr.split("-").map((part) => Number(part));
  if (![year, month, day].every(Number.isFinite)) return null;
  const utcDate = new Date(Date.UTC(year, month - 1, day, time.hour, time.minute));
  let localeDate;
  try {
    const localeString = utcDate.toLocaleString("en-US", { timeZone: tz });
    localeDate = new Date(localeString);
  } catch (err) {
    return null;
  }
  const diff = utcDate.getTime() - localeDate.getTime();
  return new Date(utcDate.getTime() + diff);
}

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

function mapEventRowForEdit(row) {
  if (!row) return null;
  const attendance = normalizeAttendanceValue(row.attendance_methods);
  return {
    ...row,
    id: String(row.id),
    creator_user_id: row.creator_user_id ? String(row.creator_user_id) : null,
    start_at: row.start_at ? new Date(row.start_at).toISOString() : null,
    end_at: row.end_at ? new Date(row.end_at).toISOString() : null,
    capacity: row.capacity === null || row.capacity === undefined ? null : Number(row.capacity),
    waitlist_enabled: row.waitlist_enabled !== false,
    reward_pool_kind:
      row.reward_pool_kind === null || row.reward_pool_kind === undefined
        ? 0
        : Number(row.reward_pool_kind),
    attendance_methods: attendance,
    cover_url: row.cover_url || "",
  };
}

export async function listEvents(req, res) {
  try {
    const limit = clampLimit(req.query.limit);
    const offset = clampOffset(req.query.offset);
    const data = await fetchEvents({ limit, offset });
    return res.json({
      ok: true,
      data,
      paging: {
        limit,
        offset,
        count: data.length,
      },
    });
  } catch (error) {
    console.error("[eventsApi] listEvents error:", error);
    return res.status(500).json({ ok: false, error: "Unable to load events" });
  }
}

export async function getEventById(req, res) {
  try {
    const id = req.params.id;
    const event = await fetchEventById(id);
    if (!event) {
      return res.status(404).json({ ok: false, error: "Event not found" });
    }
    const mode = (req.query.mode || "").toLowerCase();
    if (mode === "edit") {
      try {
        const hostId = await resolveUserId(req);
        const { rows } = await pool.query(
          `SELECT * FROM events WHERE id = $1 AND creator_user_id = $2 LIMIT 1`,
          [id, hostId]
        );
        if (!rows[0]) {
          return res.status(403).json({ ok: false, error: "Only the host can edit this event" });
        }
        return res.json({ ok: true, data: mapEventRowForEdit(rows[0]) });
      } catch (err) {
        console.error("[eventsApi] getEventById edit mode error:", err);
        return res.status(500).json({ ok: false, error: "Unable to load event for editing" });
      }
    }
    try {
      const viewerId = await resolveUserId(req);
      const viewerIsHost = event.creator_user_id && viewerId
        ? String(event.creator_user_id) === String(viewerId)
        : false;
      const snapshot = await getEventRsvpSnapshot(event.id, viewerId);
      return res.json({
        ok: true,
        data: {
          ...event,
          viewer_is_host: viewerIsHost,
          viewer_rsvp_status: snapshot.viewer?.status || null,
          viewer_check_in_method: snapshot.viewer?.check_in_method || null,
          viewer_checked_in_at: snapshot.viewer?.checked_in_at || null,
        },
      });
    } catch (viewerErr) {
      console.error("[eventsApi] getEventById viewer context error:", viewerErr);
      return res.json({ ok: true, data: event });
    }
  } catch (error) {
    console.error("[eventsApi] getEventById error:", error);
    return res.status(500).json({ ok: false, error: "Unable to load event" });
  }
}

export async function createInvite(req, res) {
  try {
    const hostId = await resolveUserId(req);
    const eventId = req.params.id;
    const rawEmail = typeof req.body?.invitee_email === "string" ? req.body.invitee_email : req.body?.email;
    const inviteeEmail = rawEmail ? rawEmail.trim().toLowerCase() : "";
    const inviteeName = typeof req.body?.invitee_name === "string" ? req.body.invitee_name.trim() : "";
    const tone = sanitizeTone(req.body?.tone) || "friendly";
    const sendByKai = Boolean(req.body?.send_by_kai);
    const customSubject = sendByKai ? "" : sanitizeString(req.body?.subject);
    const customMessage = sendByKai ? "" : sanitizeMultiline(req.body?.message);

    if (!inviteeEmail) {
      return res.status(400).json({ ok: false, error: "Invitee email is required" });
    }

    const { rows: [eventRow] } = await pool.query(
      `SELECT id, creator_user_id, status, title, start_at FROM events WHERE id = $1 LIMIT 1`,
      [eventId]
    );

    if (!eventRow) {
      return res.status(404).json({ ok: false, error: "Event not found" });
    }
    if (String(eventRow.creator_user_id) !== hostId) {
      return res.status(403).json({ ok: false, error: "Only the host can send invites" });
    }
    if (!HOST_INVITE_ALLOWED_STATUSES.has(eventRow.status)) {
      return res.status(409).json({ ok: false, error: "Invites can only be sent for draft or published events" });
    }

    const { rows: [recipient] } = await pool.query(
      `SELECT id, firstname, lastname, email
         FROM userdata
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1`,
      [inviteeEmail]
    );

    if (recipient && String(recipient.id) === hostId) {
      return res.status(400).json({ ok: false, error: "You cannot invite yourself" });
    }

    const baseUrl = process.env.APP_BASE_URL || "https://getkinder.ai";
    const hostName = req.user?.firstname?.trim() || req.user?.email?.split("@")[0] || "A friend";
    const eventLink = `${baseUrl}/events#/events/${eventId}`;
    const joinLink = `${baseUrl}/register?event=${eventId}`;
    let finalInviteeName = inviteeName;
    let inviteRecord;

    if (recipient) {
      const fullName = inviteeName || [recipient.firstname, recipient.lastname].filter(Boolean).join(" ") || recipient.email;
      finalInviteeName = fullName;
      const { rows } = await pool.query(
        `
          INSERT INTO invites (event_id, sender_user_id, recipient_user_id, invitee_email, invitee_name, status)
          VALUES ($1, $2, $3, $4, $5, 'pending')
          ON CONFLICT (event_id, recipient_user_id)
          DO UPDATE SET status='pending', responded_at=NULL, invitee_email=EXCLUDED.invitee_email, invitee_name=EXCLUDED.invitee_name
          RETURNING id, status, invitee_email, invitee_name
        `,
        [eventId, hostId, recipient.id, inviteeEmail, fullName]
      );
      inviteRecord = rows[0];
    } else {
      const { rows } = await pool.query(
        `
          INSERT INTO invites (event_id, sender_user_id, recipient_user_id, invitee_email, invitee_name, status)
          VALUES ($1, $2, NULL, $3, $4, 'pending')
          ON CONFLICT (event_id, invitee_email)
          DO UPDATE SET status='pending', responded_at=NULL, invitee_name=COALESCE(EXCLUDED.invitee_name, invites.invitee_name)
          RETURNING id, status, invitee_email, invitee_name
        `,
        [eventId, hostId, inviteeEmail, inviteeName || null]
      );
      inviteRecord = rows[0];
      if (!finalInviteeName) {
        finalInviteeName = inviteRecord?.invitee_name || inviteeEmail;
      }
    }

    const emailCopy = buildInviteEmailCopy({
      eventRow,
      hostName,
      inviteeName: finalInviteeName,
      customSubject: customSubject || null,
      customBody: customMessage || null,
      tone,
      eventLink,
      joinLink,
    });
    try {
      await sendProspectInviteEmail({
        to: inviteeEmail,
        inviteeName: finalInviteeName,
        hostName,
        eventTitle: eventRow.title,
        eventLink,
        joinLink,
        subject: emailCopy.subject,
        html: emailCopy.html,
        text: emailCopy.text,
        sendByKai,
      });
    } catch (mailErr) {
      console.error("[eventsApi] invite email failed:", mailErr);
    }

    return res.status(201).json({
      ok: true,
      data: {
        id: inviteRecord.id,
        event_id: eventId,
        event_title: eventRow.title,
        event_starts_at: eventRow.start_at,
        invitee_name: inviteRecord.invitee_name || inviteRecord.invitee_email,
        invitee_email: inviteRecord.invitee_email,
        status: inviteRecord.status,
        subject: emailCopy.subject,
        body: emailCopy.body,
      }
    });
  } catch (error) {
    console.error("[eventsApi] createInvite error:", error);
    return res.status(500).json({ ok: false, error: "Unable to send invite" });
  }
}

export async function draftInviteCopy(req, res) {
  try {
    const hostId = await resolveUserId(req);
    const eventId = req.params.id;
    const tone = sanitizeTone(req.body?.tone) || "friendly";

    const { rows: [eventRow] } = await pool.query(
      `SELECT * FROM events WHERE id = $1 AND creator_user_id = $2 LIMIT 1`,
      [eventId, hostId]
    );

    if (!eventRow) {
      return res.status(404).json({ ok: false, error: "Event not found" });
    }

    const hostName = req.user?.firstname?.trim() || req.user?.email?.split("@")[0] || "A friend";
    const draft = generateInviteDraft({
      tone,
      hostName,
      eventTitle: eventRow.title || "an event",
      eventLocation: sanitizeString(eventRow.location_text) || "Location TBD",
      eventSummary: formatEventSummaryForInvite(eventRow),
    });

    return res.json({ ok: true, data: { tone, ...draft } });
  } catch (error) {
    console.error("[eventsApi] draftInviteCopy error:", error);
    return res.status(500).json({ ok: false, error: "Unable to generate copy" });
  }
}

export async function downloadEventCalendar(req, res) {
  try {
    const hostId = await resolveUserId(req);
    const eventId = req.params.id;
    const { rows: [eventRow] } = await pool.query(
      `SELECT id, creator_user_id, title, description, start_at, end_at, tz, location_text
         FROM events
        WHERE id = $1
        LIMIT 1`,
      [eventId]
    );

    if (!eventRow) {
      return res.status(404).json({ ok: false, error: "Event not found" });
    }

    // Allow any authenticated viewer; we just ensure the request is authed via middleware.
    const start = formatIcsDate(eventRow.start_at);
    const end = formatIcsDate(eventRow.end_at || eventRow.start_at);
    if (!start || !end) {
      return res.status(400).json({ ok: false, error: "Event is missing start/end time" });
    }

    const summary = eventRow.title || "Get Kinder Event";
    const description = eventRow.description || "";
    const location = eventRow.location_text || "";
    const now = formatIcsDate(new Date());
    const baseUrl = process.env.APP_BASE_URL || "https://getkinder.ai";
    const eventLink = `${baseUrl}/events#/events/${eventId}`;
    const uid = `${eventRow.id}@getkinder.ai`;

    const icsLines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Get Kinder//Events//EN",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      description ? `DESCRIPTION:${escapeIcsText(description)}\\n${escapeIcsText(eventLink)}` : `DESCRIPTION:${escapeIcsText(eventLink)}`,
      location ? `LOCATION:${escapeIcsText(location)}` : "",
      `URL:${escapeIcsText(eventLink)}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].filter(Boolean);

    const icsContent = icsLines.join("\r\n");
    const fileName = `${summary.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "event"}.ics`;

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);
    return res.send(icsContent);
  } catch (error) {
    console.error("[eventsApi] downloadEventCalendar error:", error);
    return res.status(500).json({ ok: false, error: "Unable to generate calendar invite" });
  }
}

export async function respondToEventRsvp(req, res) {
  try {
    const attendeeId = await resolveUserId(req);
    const eventId = req.params.id;
    const action = (req.body?.action || "").toLowerCase();
    const targetStatus = RSVP_ACTION_TO_STATUS.get(action);
    if (!targetStatus) {
      return res.status(400).json({ ok: false, error: "Invalid RSVP action" });
    }

    const { rows: [eventRow] } = await pool.query(
      `SELECT id, creator_user_id, status FROM events WHERE id=$1 LIMIT 1`,
      [eventId]
    );
    if (!eventRow) {
      return res.status(404).json({ ok: false, error: "Event not found" });
    }
    if (String(eventRow.creator_user_id) === attendeeId) {
      return res.status(400).json({ ok: false, error: "Hosts do not need to RSVP" });
    }
    if (eventRow.status === "cancelled") {
      return res.status(409).json({ ok: false, error: "Event has been cancelled" });
    }

    await pool.query(
      `INSERT INTO event_rsvps (event_id, attendee_user_id, status)
         VALUES ($1, $2, $3)
       ON CONFLICT (event_id, attendee_user_id)
         DO UPDATE SET status = EXCLUDED.status, updated_at = NOW(), check_in_method = NULL, checked_in_at = NULL`,
      [eventId, attendeeId, targetStatus]
    );

    const snapshot = await getEventRsvpSnapshot(eventId, attendeeId);
    return res.json({
      ok: true,
      data: {
        status: snapshot.viewer?.status || targetStatus,
        rsvp_counts: snapshot.counts,
      },
    });
  } catch (error) {
    console.error("[eventsApi] respondToEventRsvp error:", error);
    return res.status(500).json({ ok: false, error: "Unable to update RSVP" });
  }
}

export async function checkInToEvent(req, res) {
  try {
    const attendeeId = await resolveUserId(req);
    const eventId = req.params.id;
    const method = (req.body?.method || "").toLowerCase();
    if (!CHECKIN_METHOD_SET.has(method)) {
      return res.status(400).json({ ok: false, error: "Invalid check-in method" });
    }

    const { rows: [eventRow] } = await pool.query(
      `SELECT id, attendance_methods, status FROM events WHERE id=$1 LIMIT 1`,
      [eventId]
    );
    if (!eventRow) {
      return res.status(404).json({ ok: false, error: "Event not found" });
    }
    if (eventRow.status === "cancelled") {
      return res.status(409).json({ ok: false, error: "Event has been cancelled" });
    }
    const allowed = ensureArrayValue(eventRow.attendance_methods);
    if (!allowed.includes(method)) {
      return res.status(400).json({ ok: false, error: "This event does not use that check-in method" });
    }

    const { rows: [rsvpRow] } = await pool.query(
      `SELECT status FROM event_rsvps WHERE event_id=$1 AND attendee_user_id=$2 LIMIT 1`,
      [eventId, attendeeId]
    );
    if (!rsvpRow || !["accepted", "checked_in"].includes(rsvpRow.status)) {
      return res.status(409).json({ ok: false, error: "Accept the invite before checking in" });
    }

    await pool.query(
      `UPDATE event_rsvps
          SET status='checked_in',
              check_in_method=$1,
              checked_in_at=NOW(),
              updated_at=NOW()
        WHERE event_id=$2 AND attendee_user_id=$3`,
      [method, eventId, attendeeId]
    );

    const snapshot = await getEventRsvpSnapshot(eventId, attendeeId);
    return res.json({
      ok: true,
      data: {
        status: snapshot.viewer?.status || "checked_in",
        check_in_method: snapshot.viewer?.check_in_method || method,
        checked_in_at: snapshot.viewer?.checked_in_at || new Date().toISOString(),
        rsvp_counts: snapshot.counts,
      },
    });
  } catch (error) {
    console.error("[eventsApi] checkInToEvent error:", error);
    return res.status(500).json({ ok: false, error: "Unable to check in" });
  }
}

export async function updateEvent(req, res) {
  try {
    const hostId = await resolveUserId(req);
    const eventId = req.params.id;
    const body = req.body || {};

    const { rows: [existing] } = await pool.query(
      `SELECT * FROM events WHERE id = $1 LIMIT 1`,
      [eventId]
    );
    if (!existing) {
      return res.status(404).json({ ok: false, error: "Event not found" });
    }
    if (String(existing.creator_user_id) !== hostId) {
      return res.status(403).json({ ok: false, error: "Only the host can edit this event" });
    }

    if (!EDITABLE_STATUS_SET.has(existing.status)) {
      return res.status(409).json({ ok: false, error: "Only draft or published events can be edited" });
    }

    const requestedStatus = STATUS_SET.has(body.status) ? body.status : null;
    const targetStatus = requestedStatus || existing.status;
    const strict = targetStatus === "published";

    const payload = await buildEventPayload(body, { strict, fallback: existing });
    const finalStatus = targetStatus;

    await pool.query(
      `
        UPDATE events
           SET title=$1,
               category=$2,
               start_at=$3,
               end_at=$4,
               tz=$5,
               location_text=$6,
               visibility=$7,
               capacity=$8,
               waitlist_enabled=$9,
               cover_url=$10,
               description=$11,
               reward_pool_kind=$12,
               attendance_methods=$13,
               safety_notes=$14,
               status=$15,
               updated_at = NOW()
         WHERE id = $16
      `,
      [
        payload.title,
        payload.category,
        payload.start_at,
        payload.end_at,
        payload.tz,
        payload.location_text,
        payload.visibility,
        payload.capacity,
        payload.waitlist_enabled,
        payload.cover_url,
        payload.description,
        payload.reward_pool_kind,
        JSON.stringify(payload.attendance_methods),
        payload.safety_notes,
        finalStatus,
        eventId,
      ]
    );

    return res.json({ ok: true, data: { id: eventId, status: finalStatus } });
  } catch (error) {
    console.error("[eventsApi] updateEvent error:", error);
    if (error?.statusCode === 400) {
      return res.status(400).json({ ok: false, error: error.message });
    }
    return res.status(500).json({ ok: false, error: "Unable to update event" });
  }
}

function buildValidationError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function normalizeAttendanceValue(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  if (typeof value === "object" && value !== null) {
    if (Array.isArray(value)) return value;
    const maybeArray = Object.values(value).filter((item) => typeof item === "string");
    return maybeArray.length ? maybeArray : [];
  }
  return [];
}

function ensureArrayValue(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sanitizeMultiline(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").trim();
}

function sanitizeTone(value) {
  if (!value) return null;
  const tone = value.toLowerCase();
  return INVITE_TONES[tone] ? tone : null;
}

function escapeHtml(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatEventSummaryForInvite(eventRow) {
  if (!eventRow?.start_at) return "soon";
  try {
    const tz = eventRow.tz || "UTC";
    const label = new Date(eventRow.start_at).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    });
    return `${label} (${tz})`;
  } catch {
    return String(eventRow.start_at);
  }
}

function applyTemplate(template, tokens) {
  return template.replace(/\{\{(.*?)\}\}/g, (_, key) => tokens[key.trim()] || "");
}

function generateInviteDraft({ tone, hostName, eventTitle, eventLocation, eventSummary }) {
  const template = INVITE_TONES[tone] || INVITE_TONES.friendly;
  const tokens = {
    hostName,
    eventTitle,
    eventLocation,
    eventSummary,
  };
  return {
    subject: applyTemplate(template.subject, tokens).trim(),
    body: applyTemplate(template.body, tokens).trim(),
  };
}

function createMessageHtml(body) {
  if (!body) return "";
  const paragraphs = body.split(/\n{2,}/).map((paragraph) => {
    const safe = escapeHtml(paragraph).replace(/\n/g, "<br/>");
    return `<p>${safe}</p>`;
  });
  return paragraphs.join("\n");
}

function buildInviteEmailCopy({
  eventRow,
  hostName,
  inviteeName,
  customSubject,
  customBody,
  tone,
  eventLink,
  joinLink,
}) {
  const eventTitle = eventRow?.title || "a Get Kinder event";
  const eventLocation = sanitizeString(eventRow?.location_text) || "Location TBD";
  const eventSummary = formatEventSummaryForInvite(eventRow);
  const draft = generateInviteDraft({
    tone: tone || "friendly",
    hostName: hostName || "A friend",
    eventTitle,
    eventLocation,
    eventSummary,
  });
  const subject = customSubject?.trim() ? customSubject.trim() : draft.subject;
  const body = customBody?.trim() ? customBody.trim() : draft.body;
  const greetingName = inviteeName?.split(/\s+/)[0] || "there";
  const messageHtml = createMessageHtml(body) || `<p>${escapeHtml(body)}</p>`;
  const detailsHtml = `<p><strong>Event:</strong> ${escapeHtml(eventTitle)}<br/>${escapeHtml(eventSummary)}<br/>${escapeHtml(eventLocation)}</p>`;
  const eventHref = eventLink || joinLink || (process.env.APP_BASE_URL || "https://getkinder.ai");
  const joinHref = joinLink || eventHref;
  const html = `
    <p>Hi ${escapeHtml(greetingName)},</p>
    ${messageHtml}
    ${detailsHtml}
    <p><a href="${eventHref}" target="_blank" rel="noopener">View event details</a></p>
    <p><a href="${joinHref}" target="_blank" rel="noopener">Join Get Kinder to RSVP</a></p>
    <p>See you there! 💛</p>
  `;
  const text = `Hi ${greetingName},\n\n${body}\n\nEvent: ${eventTitle}\nWhen: ${eventSummary}\nWhere: ${eventLocation}\n\nView: ${eventHref}\nJoin: ${joinHref}\n`;
  return { subject, html, text, body }; // body returned for drafts
}

async function getEventRsvpSnapshot(eventId, userId) {
  const [{ rows: [viewer] }, { rows: [counts] }] = await Promise.all([
    pool.query(
      `SELECT status, check_in_method, checked_in_at
         FROM event_rsvps
        WHERE event_id=$1 AND attendee_user_id=$2
        LIMIT 1`,
      [eventId, userId]
    ),
    pool.query(
      `SELECT
          COUNT(*) FILTER (WHERE status IN ('accepted','checked_in')) AS accepted
         FROM event_rsvps
        WHERE event_id=$1`,
      [eventId]
    ),
  ]);

  return {
    viewer,
    counts: {
      accepted: Number(counts?.accepted) || 0,
    },
  };
}

function formatIcsDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const iso = date.toISOString().replace(/[-:]/g, "").split(".")[0];
  return `${iso}Z`;
}

function escapeIcsText(value) {
  if (!value) return "";
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

async function buildEventPayload(body, { strict = false, fallback = {} } = {}) {
  const base = fallback || {};
  const title = sanitizeString(body.title ?? base.title);
  if (!title) throw buildValidationError("Title is required.");

  const tz = sanitizeString(body.tz ?? base.tz) || "America/Vancouver";
  const locationText = sanitizeString(body.location_text ?? base.location_text);
  if (strict && !locationText) throw buildValidationError("Location is required to publish.");

  const visibility = VISIBILITY_SET.has(body.visibility) ? body.visibility : base.visibility || "public";

  const capacityInput = body.capacity ?? base.capacity;
  let capacity = null;
  if (capacityInput !== undefined && capacityInput !== null && capacityInput !== "") {
    const parsed = Number(capacityInput);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw buildValidationError("Capacity must be a positive number if provided.");
    }
    capacity = parsed;
  }

  const waitlistEnabled = body.waitlist_enabled !== undefined
    ? !!body.waitlist_enabled
    : base.waitlist_enabled !== undefined
      ? !!base.waitlist_enabled
      : true;

  const coverUrl = sanitizeString(body.cover_url ?? base.cover_url) || null;
  const description = sanitizeString(body.description ?? base.description) || null;
  const rewardPoolRaw = body.reward_pool_kind ?? base.reward_pool_kind ?? 0;
  const rewardPool = Number.isFinite(Number(rewardPoolRaw)) ? Math.max(0, Number(rewardPoolRaw)) : 0;
  const safetyNotes = sanitizeString(body.safety_notes ?? base.safety_notes) || null;
  const category = sanitizeString(body.category ?? base.category) || null;

  const attendanceInput = Array.isArray(body.attendance_methods)
    ? body.attendance_methods
    : normalizeAttendanceValue(base.attendance_methods);
  const attendanceMethods = [...new Set(attendanceInput.filter((method) => ATTENDANCE_SET.has(method)))];
  if (!attendanceMethods.length) throw buildValidationError("Select at least one attendance method.");

  const date = sanitizeString(body.date);
  const timeInput = typeof body.time_range === "string" ? body.time_range : body.time;
  const hasNewTime = date || timeInput;
  let startAtIso = base.start_at || null;
  let endAtIso = base.end_at || null;

  if (hasNewTime) {
    if (!date) throw buildValidationError("Date is required when updating time.");
    const range = parseTimeRangeInput(timeInput);
    if (!range) throw buildValidationError("Use HH:mm–HH:mm for time range.");
    const startAt = zonedTimeToUtc(date, range.start, tz);
    const endAt = zonedTimeToUtc(date, range.end, tz);
    if (!startAt || !endAt) throw buildValidationError("Unable to parse date/time with the selected timezone.");
    startAtIso = startAt.toISOString();
    endAtIso = endAt.toISOString();
  } else if (strict && (!startAtIso || !endAtIso)) {
    throw buildValidationError("Date and time are required to publish.");
  }

  return {
    title,
    category,
    start_at: startAtIso,
    end_at: endAtIso,
    tz,
    location_text: locationText || "",
    visibility,
    capacity,
    waitlist_enabled: waitlistEnabled,
    cover_url: coverUrl,
    description,
    reward_pool_kind: rewardPool,
    attendance_methods: attendanceMethods,
    safety_notes: safetyNotes,
  };
}

export async function createEvent(req, res) {
  try {
    const ownerId = await resolveUserId(req);
    const body = req.body || {};
    const status = STATUS_SET.has(body.status) ? body.status : "draft";
    const strict = status === "published";

    const payload = await buildEventPayload(body, { strict });

    const { rows } = await pool.query(
      `
        INSERT INTO events (
          creator_user_id,
          title,
          category,
          start_at,
          end_at,
          tz,
          location_text,
          visibility,
          capacity,
          waitlist_enabled,
          cover_url,
          description,
          reward_pool_kind,
          attendance_methods,
          safety_notes,
          status
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
        )
        RETURNING id, status
      `,
      [
        ownerId,
        payload.title,
        payload.category,
        payload.start_at,
        payload.end_at,
        payload.tz,
        payload.location_text,
        payload.visibility,
        payload.capacity,
        payload.waitlist_enabled,
        payload.cover_url,
        payload.description,
        payload.reward_pool_kind,
        JSON.stringify(payload.attendance_methods),
        payload.safety_notes,
        status,
      ]
    );
    return res.status(201).json({ ok: true, data: rows[0] });
  } catch (error) {
    console.error("[eventsApi] createEvent error:", error);
    if (error?.statusCode === 400) {
      return res.status(400).json({ ok: false, error: error.message });
    }
    if (error?.code === "42P01") {
      return res
        .status(500)
        .json({ ok: false, error: "Events table is missing. Please run migrations." });
    }
    return res.status(500).json({ ok: false, error: "Unable to create event" });
  }
}
