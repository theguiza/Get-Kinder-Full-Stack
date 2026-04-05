import pool from "../Backend/db/pg.js";
import {
  fetchEvents,
  fetchEventById,
  getEventByIdForVerify,
  getRsvpForUpdate,
  countVerifiedShifts,
  updateEventRsvpVerification,
} from "../services/eventsService.js";
import { processVerifiedEarnShift } from "../services/earnShiftFundingService.js";
import { sendProspectInviteEmail, sendNudgeEmail } from "../kindnessEmailer.js";
import { hasUserOrgMembershipTable, resolveOrgScope } from "../services/orgScopeService.js";
import { promoteWaitlistedAttendees } from "../services/waitlistService.js";
import { applyEventRsvpAction, getEventRsvpSnapshot } from "../services/eventRsvpService.js";
import { buildEventCalendarInvite } from "../services/eventCalendarService.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const VISIBILITY_SET = new Set(["public", "fof", "private"]);
const STATUS_SET = new Set(["draft", "published"]);
const ATTENDANCE_SET = new Set(["host_code", "social_proof", "geo"]);
const VERIFICATION_METHOD_SET = new Set(["host_attest", "qr_stub", "social_proof"]);
const INVITE_ALLOWED_EVENT_STATUSES = new Set(["published", "draft"]);
const INVITE_ELIGIBLE_STATUSES = new Set(["accepted", "checked_in"]);
const INVITE_APPROVAL_REQUIRED_MESSAGE = "You can send this message after you have been approved";
const INVITE_SENDER_HOURLY_LIMIT = 12;
const INVITE_SENDER_DAILY_LIMIT = 40;
const INVITE_RECIPIENT_COOLDOWN_HOURS = 24;
const INVITE_DUPLICATE_WINDOW_HOURS = 24 * 30;
const INVITE_PER_EVENT_SENDER_CAP = 3;
const EDITABLE_STATUS_SET = new Set(["draft", "published"]);
const CHECKIN_METHOD_SET = new Set(["host_code", "social_proof", "geo"]);
const RSVP_THANKS_SESSION_KEY = "eventRsvpThanks";
const INVITE_TONES = {
  friendly: {
    subject: "{{senderName}} invited you to {{eventTitle}}",
    body: `I'd love for you to join me for {{eventTitle}}. It's happening {{eventSummary}} at {{eventLocation}}. Tap the link so we can plan together!`
  },
  hype: {
    subject: "Let's GO – {{eventTitle}} is on!",
    body: `I just locked in {{eventTitle}} and it would be way more fun if you came. {{eventSummary}} · {{eventLocation}}. Grab your spot and let's make it happen.`
  },
  thoughtful: {
    subject: "An invite from {{senderName}}",
    body: `I've been thinking of you and hope you can make {{eventTitle}}. We're meeting {{eventSummary}} at {{eventLocation}}. RSVP if you can join—would mean a lot to see you there.`
  }
};

const DEFAULT_FUNDING_POOL_SLUG = "general";
const FUNDING_POOL_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function clampLimit(value) {
  const num = Number(value);
  const fallback = Number.isFinite(num) ? num : DEFAULT_LIMIT;
  return Math.min(Math.max(fallback, 1), MAX_LIMIT);
}

function sanitizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildAppBaseUrl() {
  return (process.env.APP_BASE_URL || "https://getkinder.ai").replace(/\/+$/, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeInternalPath(value, fallback = "/events") {
  const rawValue = sanitizeString(value);
  if (!rawValue || !rawValue.startsWith("/") || rawValue.startsWith("//")) return fallback;

  try {
    const appBaseUrl = (process.env.APP_BASE_URL || "https://getkinder.ai").replace(/\/+$/, "");
    const candidate = new URL(rawValue, `${appBaseUrl}/`);
    const appOrigin = new URL(appBaseUrl).origin;
    if (candidate.origin !== appOrigin) return fallback;
    return `${candidate.pathname}${candidate.search}${candidate.hash}`;
  } catch {
    return fallback;
  }
}

async function persistRsvpThanksContext(req, payload) {
  if (!req.session || typeof req.session !== "object") return;
  req.session[RSVP_THANKS_SESSION_KEY] = payload;
  if (typeof req.session.save === "function") {
    await new Promise((resolve, reject) => {
      req.session.save((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

function truncateLocationForStorage(value, maxParts = 3) {
  const normalized = sanitizeString(value);
  if (!normalized) return "";
  const parts = normalized
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return "";
  return parts.slice(0, maxParts).join(", ");
}

function normalizeFundingPoolSlug(value, fallback = DEFAULT_FUNDING_POOL_SLUG) {
  const fallbackSlug = typeof fallback === "string" && fallback.trim()
    ? fallback.trim().toLowerCase()
    : DEFAULT_FUNDING_POOL_SLUG;
  const slug = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!slug) return fallbackSlug;
  if (!FUNDING_POOL_SLUG_RE.test(slug)) {
    throw buildValidationError(
      "Funding pool slug must be lowercase letters/numbers and may include - or _ (max 64 chars)."
    );
  }
  return slug;
}

function normalizeCauseTags(value) {
  if (Array.isArray(value)) {
    return value
      .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
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
  if (!Number.isFinite(time.hour) || !Number.isFinite(time.minute)) return null;

  function getPartsInZone(date, timeZone) {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = formatter.formatToParts(date);
    const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return {
      year: Number(byType.year),
      month: Number(byType.month),
      day: Number(byType.day),
      hour: Number(byType.hour),
      minute: Number(byType.minute),
      second: Number(byType.second),
    };
  }

  // Start with a UTC guess and iteratively correct it until the wall time in the target zone matches.
  let guess = new Date(Date.UTC(year, month - 1, day, time.hour, time.minute, 0));
  const targetWallUtc = Date.UTC(year, month - 1, day, time.hour, time.minute, 0);

  for (let i = 0; i < 4; i += 1) {
    let zoned;
    try {
      zoned = getPartsInZone(guess, tz);
    } catch (err) {
      return null;
    }

    if (
      ![zoned.year, zoned.month, zoned.day, zoned.hour, zoned.minute, zoned.second]
        .every(Number.isFinite)
    ) {
      return null;
    }

    const zonedAsUtc = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second
    );
    const deltaMs = targetWallUtc - zonedAsUtc;
    if (deltaMs === 0) break;
    guess = new Date(guess.getTime() + deltaMs);
  }

  return guess;
}

async function getHostScope(req) {
  if (!req._eventsHostScopePromise) {
    req._eventsHostScopePromise = resolveOrgScope(req, {
      allowAdminPreview: false,
      includeOrgMembersForOrgRep: true,
    });
  }
  return req._eventsHostScopePromise;
}

async function resolveUserId(req) {
  const scope = await getHostScope(req);
  return scope.actorUserId;
}

async function resolveHostUserIds(req) {
  const scope = await getHostScope(req);
  return scope.memberUserIds;
}

function eventIsOwnedByHostScope(eventRow, hostUserIds) {
  if (!eventRow?.creator_user_id) return false;
  return hostUserIds.includes(String(eventRow.creator_user_id));
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
    cause_tags: normalizeCauseTags(row.cause_tags),
    impact_credits_base:
      row.impact_credits_base === null || row.impact_credits_base === undefined
        ? 25
        : Number(row.impact_credits_base),
    reliability_weight:
      row.reliability_weight === null || row.reliability_weight === undefined
        ? 1
        : Number(row.reliability_weight),
    funding_pool_slug: row.funding_pool_slug || DEFAULT_FUNDING_POOL_SLUG,
    cover_url: row.cover_url || "",
  };
}

export async function listEvents(req, res) {
  try {
    const limit = clampLimit(req.query.limit);
    const view = req.query.view === "archive" ? "archive" : "upcoming";
    const communityTag = typeof req.query.community_tag === "string" ? req.query.community_tag : "";
    const causeTag = typeof req.query.cause_tag === "string" ? req.query.cause_tag : "";
    const cursor = view === "archive"
      ? {
          before_start_at:
            typeof req.query.before_start_at === "string" ? req.query.before_start_at : null,
          before_id: typeof req.query.before_id === "string" ? req.query.before_id : null,
        }
      : {
          after_start_at:
            typeof req.query.after_start_at === "string" ? req.query.after_start_at : null,
          after_id: typeof req.query.after_id === "string" ? req.query.after_id : null,
        };
    const result = await fetchEvents({
      limit,
      view,
      cursor,
      communityTag,
      causeTag,
    });
    const data = Array.isArray(result?.events) ? result.events : [];
    const nextCursor = result?.nextCursor || null;
    return res.json({
      ok: true,
      data,
      paging: {
        limit,
        view,
        next_cursor: nextCursor,
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
    if (!req.user && !req.isAuthenticated?.()) {
      try {
        const { getBearerToken, verifyBearerToken } = await import('../middleware/auth.js');
        const bearerToken = getBearerToken(req);
        if (bearerToken) {
          const verification = verifyBearerToken(bearerToken);
          if (verification.ok) {
            const userId = Number(verification.decoded?.id ?? verification.decoded?.sub);
            if (Number.isInteger(userId)) {
              const { rows } = await pool.query(
                'SELECT * FROM userdata WHERE id = $1 LIMIT 1',
                [userId]
              );
              if (rows?.[0]) {
                req.user = rows[0];
              }
            }
          }
        }
      } catch (_bearerErr) {
        // silent — proceed as unauthenticated
      }
    }
    const id = req.params.id;
    const event = await fetchEventById(id);
    if (!event) {
      return res.status(404).json({ ok: false, error: "Event not found" });
    }
    const mode = (req.query.mode || "").toLowerCase();
    if (mode === "edit") {
      if (!(req.isAuthenticated && req.isAuthenticated())) {
        return res.status(401).json({ ok: false, error: "unauthorized" });
      }
      try {
        const hostUserIds = await resolveHostUserIds(req);
        const { rows } = await pool.query(
          `SELECT * FROM events WHERE id = $1 LIMIT 1`,
          [id]
        );
        if (!rows[0] || !eventIsOwnedByHostScope(rows[0], hostUserIds)) {
          return res.status(403).json({ ok: false, error: "Only the host can edit this event" });
        }
        return res.json({ ok: true, data: mapEventRowForEdit(rows[0]) });
      } catch (err) {
        console.error("[eventsApi] getEventById edit mode error:", err);
        return res.status(500).json({ ok: false, error: "Unable to load event for editing" });
      }
    }
    if ((req.isAuthenticated && req.isAuthenticated()) || req.user) {
      try {
        const viewerId = await resolveUserId(req);
        const viewerHostUserIds = await resolveHostUserIds(req);
        const viewerIsHost = event.creator_user_id && viewerId
          ? viewerHostUserIds.includes(String(event.creator_user_id))
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
      }
    }
    return res.json({ ok: true, data: event });
  } catch (error) {
    console.error("[eventsApi] getEventById error:", error);
    return res.status(500).json({ ok: false, error: "Unable to load event" });
  }
}

export async function createInvite(req, res) {
  try {
    const senderId = await resolveUserId(req);
    const senderHostUserIds = await resolveHostUserIds(req);
    const eventId = req.params.id;
    const rawEmail = typeof req.body?.invitee_email === "string" ? req.body.invitee_email : req.body?.email;
    const inviteeEmail = rawEmail ? rawEmail.trim().toLowerCase() : "";
    const inviteeName = typeof req.body?.invitee_name === "string" ? req.body.invitee_name.trim() : "";
    const tone = sanitizeTone(req.body?.tone) || "friendly";
    const sendByKai = Boolean(req.body?.send_by_kai);
    const inviteStyle = sanitizeString(req.body?.invite_style).toLowerCase();
    const useCoordinatorInviteStyle = inviteStyle === "org_portal";

    if (!inviteeEmail) {
      return res.status(400).json({ ok: false, error: "Invitee email is required" });
    }

    const senderContext = await resolveInviteSenderContext({
      senderId,
      senderHostUserIds,
      eventId,
      senderEmail: req.user?.email || null,
    });
    if (senderContext.errorCode === "EVENT_NOT_FOUND") {
      return res.status(404).json({ ok: false, error: "Event not found" });
    }
    if (senderContext.errorCode === "INVITE_APPROVAL_REQUIRED") {
      return res.status(403).json({
        ok: false,
        code: "INVITE_APPROVAL_REQUIRED",
        error: INVITE_APPROVAL_REQUIRED_MESSAGE,
      });
    }
    if (senderContext.errorCode === "INVITE_EVENT_STATUS_INVALID") {
      return res.status(409).json({
        ok: false,
        code: "INVITE_EVENT_STATUS_INVALID",
        error: "Invites can only be sent for draft or published events",
      });
    }

    const { eventRow, senderName, senderEmail } = senderContext;

    const { rows: [recipient] } = await pool.query(
      `SELECT id, firstname, lastname, email
         FROM userdata
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1`,
      [inviteeEmail]
    );

    if (recipient && String(recipient.id) === senderId) {
      return res.status(400).json({ ok: false, error: "You cannot invite yourself" });
    }

    const recipientUserId = recipient ? String(recipient.id) : null;
    const blockedByRecipient = await recipientHasBlockedSender({
      recipientUserId,
      senderUserId: senderId,
    });
    if (blockedByRecipient) {
      await logInviteModeration({
        senderUserId: senderId,
        recipientUserId,
        eventId,
        action: "invite_blocked",
        reason: "recipient_blocked_sender",
        metadata: { inviteeEmail },
      });
      return res.status(403).json({
        ok: false,
        code: "INVITE_BLOCKED_BY_RECIPIENT",
        error: "This recipient is not accepting invites from you.",
      });
    }

    const senderLimitViolation = await checkSenderRateLimits(senderId);
    if (senderLimitViolation) {
      await logInviteModeration({
        senderUserId: senderId,
        recipientUserId,
        eventId,
        action: "invite_blocked",
        reason: senderLimitViolation,
        metadata: { inviteeEmail },
      });
      return res.status(429).json({
        ok: false,
        code: "INVITE_RATE_LIMITED",
        error: "You have reached your invite limit. Please try again later.",
      });
    }

    const perEventCount = await countSenderEventInvites({ senderUserId: senderId, eventId });
    if (perEventCount >= INVITE_PER_EVENT_SENDER_CAP) {
      await logInviteModeration({
        senderUserId: senderId,
        recipientUserId,
        eventId,
        action: "invite_blocked",
        reason: "event_sender_cap_reached",
        metadata: { inviteeEmail, perEventCount },
      });
      return res.status(409).json({
        ok: false,
        code: "INVITE_EVENT_CAP_REACHED",
        error: "You can send up to 3 invites for this event.",
      });
    }

    const recentForRecipient = await hasRecipientCooldown({
      senderUserId: senderId,
      inviteeEmail,
    });
    if (recentForRecipient) {
      await logInviteModeration({
        senderUserId: senderId,
        recipientUserId,
        eventId,
        action: "invite_blocked",
        reason: "recipient_cooldown_active",
        metadata: { inviteeEmail },
      });
      return res.status(429).json({
        ok: false,
        code: "INVITE_RECIPIENT_COOLDOWN",
        error: "Please wait before sending another invite to this person.",
      });
    }

    const duplicateInvite = await findDuplicateInviteInWindow({
      eventId,
      recipientUserId,
      inviteeEmail,
    });
    if (duplicateInvite) {
      await logInviteModeration({
        senderUserId: senderId,
        recipientUserId,
        eventId,
        inviteId: duplicateInvite.id,
        action: "invite_blocked",
        reason: "duplicate_invite_window",
        metadata: { inviteeEmail },
      });
      return res.status(409).json({
        ok: false,
        code: "INVITE_DUPLICATE",
        error: "An invite for this person already exists for this event.",
      });
    }

    const baseUrl = process.env.APP_BASE_URL || "https://getkinder.ai";
    const eventLink = `${baseUrl}/events/${encodeURIComponent(eventId)}`;
    const joinLink = `${baseUrl}/register?event=${eventId}`;
    const finalInviteeName = recipient
      ? inviteeName || [recipient.firstname, recipient.lastname].filter(Boolean).join(" ") || recipient.email
      : inviteeName || inviteeEmail;

    let inviteRecord;
    const { rows } = await pool.query(
      `
        INSERT INTO invites (event_id, sender_user_id, recipient_user_id, invitee_email, invitee_name, status)
        VALUES ($1, $2, $3, $4, $5, 'pending')
        ON CONFLICT DO NOTHING
        RETURNING id, status, invitee_email, invitee_name
      `,
      [eventId, senderId, recipient?.id || null, inviteeEmail, finalInviteeName]
    );
    inviteRecord = rows[0];
    if (!inviteRecord) {
      await logInviteModeration({
        senderUserId: senderId,
        recipientUserId,
        eventId,
        action: "invite_blocked",
        reason: "duplicate_invite_conflict",
        metadata: { inviteeEmail },
      });
      return res.status(409).json({
        ok: false,
        code: "INVITE_DUPLICATE",
        error: "An invite for this person already exists for this event.",
      });
    }

    const emailCopy = useCoordinatorInviteStyle
      ? buildCoordinatorInviteEmailCopy({
          eventId,
          eventRow,
          senderName,
          inviteeName: finalInviteeName,
        })
      : buildInviteEmailCopy({
          eventRow,
          senderName,
          senderEmail,
          inviteeName: finalInviteeName,
          tone,
          eventLink,
          joinLink,
        });
    const calendarInvite = useCoordinatorInviteStyle
      ? buildEventCalendarInvite({
          eventId,
          title: eventRow.title,
          description: eventRow.description,
          startAt: eventRow.start_at,
          endAt: eventRow.end_at,
          locationText: eventRow.location_text,
          baseUrl,
        })
      : null;
    try {
      if (useCoordinatorInviteStyle) {
        await sendNudgeEmail({
          to: inviteeEmail,
          subject: emailCopy.subject,
          text: emailCopy.text,
          html: emailCopy.html,
          fromName: senderName || "Get Kinder",
          replyTo: senderEmail || null,
          attachments: calendarInvite
            ? [{
                filename: calendarInvite.fileName,
                content: calendarInvite.content,
                contentType: "text/calendar; charset=utf-8",
              }]
            : undefined,
        });
      } else {
        await sendProspectInviteEmail({
          to: inviteeEmail,
          inviteeName: finalInviteeName,
          hostName: senderName,
          eventTitle: eventRow.title,
          eventLink,
          joinLink,
          subject: emailCopy.subject,
          html: emailCopy.html,
          text: emailCopy.text,
          sendByKai,
          replyTo: senderEmail || null,
        });
      }
    } catch (mailErr) {
      console.error("[eventsApi] invite email failed:", mailErr);
      await logInviteModeration({
        senderUserId: senderId,
        recipientUserId,
        eventId,
        inviteId: inviteRecord.id,
        action: "invite_email_failed",
        reason: "mailer_error",
        metadata: { message: mailErr?.message || "unknown" },
      });
    }

    await logInviteModeration({
      senderUserId: senderId,
      recipientUserId,
      eventId,
      inviteId: inviteRecord.id,
      action: "invite_sent",
      reason: "ok",
      metadata: {
        tone,
        sendByKai,
        inviteStyle: useCoordinatorInviteStyle ? "org_portal" : "default",
        inviteeEmail: inviteRecord.invitee_email,
      },
    });

    const payload = {
      id: inviteRecord.id,
      event_id: eventId,
      event_title: eventRow.title,
      event_starts_at: eventRow.start_at,
      invitee_name: inviteRecord.invitee_name || inviteRecord.invitee_email,
      invitee_email: inviteRecord.invitee_email,
      status: inviteRecord.status,
      subject: emailCopy.subject,
      body: emailCopy.body,
    };
    if (senderEmail) {
      payload.sender_email = senderEmail;
    }

    return res.status(201).json({
      ok: true,
      data: payload,
    });
  } catch (error) {
    console.error("[eventsApi] createInvite error:", error);
    return res.status(500).json({ ok: false, error: "Unable to send invite" });
  }
}

export async function draftInviteCopy(req, res) {
  try {
    const senderId = await resolveUserId(req);
    const senderHostUserIds = await resolveHostUserIds(req);
    const eventId = req.params.id;
    const tone = sanitizeTone(req.body?.tone) || "friendly";

    const senderContext = await resolveInviteSenderContext({
      senderId,
      senderHostUserIds,
      eventId,
      senderEmail: req.user?.email || null,
    });
    if (senderContext.errorCode === "EVENT_NOT_FOUND") {
      return res.status(404).json({ ok: false, error: "Event not found" });
    }
    if (senderContext.errorCode === "INVITE_APPROVAL_REQUIRED") {
      return res.status(403).json({
        ok: false,
        code: "INVITE_APPROVAL_REQUIRED",
        error: INVITE_APPROVAL_REQUIRED_MESSAGE,
      });
    }
    if (senderContext.errorCode === "INVITE_EVENT_STATUS_INVALID") {
      return res.status(409).json({
        ok: false,
        code: "INVITE_EVENT_STATUS_INVALID",
        error: "Invites can only be sent for draft or published events",
      });
    }

    const { eventRow, senderName, senderEmail } = senderContext;
    const draft = generateInviteDraft({
      tone,
      senderName,
      eventTitle: eventRow.title || "an event",
      eventLocation: sanitizeString(eventRow.location_text) || "Location TBD",
      eventSummary: formatEventSummaryForInvite(eventRow),
    });

    return res.json({
      ok: true,
      data: {
        tone,
        ...draft,
        sender_name: senderName,
        sender_email: senderEmail || null,
      },
    });
  } catch (error) {
    console.error("[eventsApi] draftInviteCopy error:", error);
    return res.status(500).json({ ok: false, error: "Unable to generate copy" });
  }
}

export async function downloadEventCalendar(req, res) {
  try {
    const eventId = req.params.id;
    const { rows: [eventRow] } = await pool.query(
      `SELECT id, title, description, start_at, end_at, tz, location_text, status
         FROM events
        WHERE id = $1
        LIMIT 1`,
      [eventId]
    );

    if (!eventRow || String(eventRow.status || "").toLowerCase() !== "published") {
      return res.status(404).json({ ok: false, error: "Event not found" });
    }

    const calendarInvite = buildEventCalendarInvite({
      eventId: eventRow.id,
      title: eventRow.title,
      description: eventRow.description,
      startAt: eventRow.start_at,
      endAt: eventRow.end_at,
      locationText: eventRow.location_text,
    });
    if (!calendarInvite) {
      return res.status(400).json({ ok: false, error: "Event is missing start/end time" });
    }

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"${calendarInvite.fileName}\"`);
    return res.send(calendarInvite.content);
  } catch (error) {
    console.error("[eventsApi] downloadEventCalendar error:", error);
    return res.status(500).json({ ok: false, error: "Unable to generate calendar invite" });
  }
}

export async function respondToEventRsvp(req, res) {
  try {
    const attendeeId = await resolveUserId(req);
    const hostUserIds = await resolveHostUserIds(req);
    const eventId = req.params.id;
    const action = (req.body?.action || "").toLowerCase();
    const reason = sanitizeString(req.body?.reason) || null;
    const requireExistingForDecline = req.body?.require_existing === true;
    const result = await applyEventRsvpAction({
      eventId,
      attendeeId,
      action,
      hostUserIds,
      reason,
      requireExistingForDecline,
    });
    if (!result.ok) {
      return res.status(result.statusCode).json({
        ok: false,
        ...(result.code ? { code: result.code } : {}),
        error: result.error,
      });
    }

    if (action === "accept") {
      const defaultReturnTo = eventId ? `/events/${encodeURIComponent(eventId)}` : "/events";
      const returnToHref = sanitizeInternalPath(req.body?.return_to, defaultReturnTo);
      await persistRsvpThanksContext(req, {
        returnToHref,
        eventId: eventId ? String(eventId) : null,
        savedAt: new Date().toISOString(),
      });

      if (result.data?.status === "pending") {
        try {
          await sendPendingApprovalNotifications({
            eventId,
            attendeeId,
          });
        } catch (notificationError) {
          console.error("[eventsApi] pending approval notification failed:", notificationError);
        }
      }
    } else if (action === "decline" && result.data?.previous_status && result.data.previous_status !== "declined") {
      try {
        await sendRsvpCancellationNotifications({
          eventId,
          attendeeId,
          previousStatus: result.data.previous_status,
        });
      } catch (notificationError) {
        console.error("[eventsApi] RSVP cancellation notification failed:", notificationError);
      }
    }

    return res.json({
      ok: true,
      data: {
        status: result.data.status,
        rsvp_counts: result.data.counts,
        ...(result.data.message ? { message: result.data.message } : {}),
      },
    });
  } catch (error) {
    console.error("[eventsApi] respondToEventRsvp error:", error);
    return res.status(500).json({ ok: false, error: "Unable to update RSVP" });
  }
}

export async function checkInToEvent(req, res) {
  try {
    const requesterId = await resolveUserId(req);
    const hostUserIds = await resolveHostUserIds(req);
    if (!requesterId) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    const eventId = req.params.id;
    const requestedMethod = sanitizeString(req.body?.method).toLowerCase();
    const requestedAttendeeRaw = req.body?.attendee_user_id ?? req.body?.userId;
    const requestedAttendeeId = requestedAttendeeRaw === undefined || requestedAttendeeRaw === null
      ? null
      : String(requestedAttendeeRaw).trim();

    const { rows: [eventRow] } = await pool.query(
      `SELECT id, creator_user_id, attendance_methods, status FROM events WHERE id=$1 LIMIT 1`,
      [eventId]
    );
    if (!eventRow) {
      return res.status(404).json({ ok: false, error: "Event not found" });
    }
    if (eventRow.status === "cancelled") {
      return res.status(409).json({ ok: false, error: "Event has been cancelled" });
    }
    const allowed = ensureArrayValue(eventRow.attendance_methods);

    const isHostOverride =
      requestedAttendeeId &&
      eventIsOwnedByHostScope(eventRow, hostUserIds) &&
      String(requestedAttendeeId) !== String(requesterId);
    const attendeeId = isHostOverride ? requestedAttendeeId : requesterId;

    let method = CHECKIN_METHOD_SET.has(requestedMethod) ? requestedMethod : "";
    if (!method) {
      // Host/manual check-in defaults to host_code when available, otherwise first allowed method.
      if (allowed.includes("host_code")) method = "host_code";
      else if (allowed.length > 0 && CHECKIN_METHOD_SET.has(String(allowed[0]).toLowerCase())) {
        method = String(allowed[0]).toLowerCase();
      }
    }
    if (!CHECKIN_METHOD_SET.has(method)) {
      return res.status(400).json({ ok: false, error: "Invalid check-in method" });
    }
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

export async function listEventRoster(req, res) {
  try {
    const hostUserIds = await resolveHostUserIds(req);
    const eventId = req.params.id;
    const { rows: [eventRow] } = await pool.query(
      `SELECT id, creator_user_id FROM events WHERE id=$1 LIMIT 1`,
      [eventId]
    );
    if (!eventRow) {
      return res.status(404).json({ ok: false, error: "Event not found" });
    }
    if (!eventIsOwnedByHostScope(eventRow, hostUserIds)) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const { rows } = await pool.query(
      `
        SELECT r.attendee_user_id,
               r.status,
               r.verification_status,
               r.attended_minutes,
               r.checked_in_at,
               u.firstname,
               u.lastname,
               u.email
          FROM event_rsvps r
          JOIN userdata u ON u.id = r.attendee_user_id
         WHERE r.event_id = $1
         ORDER BY r.created_at ASC
      `,
      [eventId]
    );

    return res.json({ ok: true, data: rows });
  } catch (error) {
    console.error("[eventsApi] listEventRoster error:", error);
    return res.status(500).json({ ok: false, error: "Unable to load roster" });
  }
}

export async function verifyEventRsvp(req, res) {
  const userId = await resolveUserId(req);
  const hostUserIds = await resolveHostUserIds(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const eventId = req.params.id;
  const attendeeUserIdRaw = req.body?.attendee_user_id;
  const attendeeUserId = attendeeUserIdRaw ? String(attendeeUserIdRaw).trim() : "";
  if (!attendeeUserId) {
    return res.status(400).json({ ok: false, error: "attendee_user_id is required" });
  }

  const decisionRaw = sanitizeString(req.body?.decision).toLowerCase();
  const decision = decisionRaw === "rejected" ? "rejected" : "verified";
  const notes = sanitizeString(req.body?.notes) || null;
  const attendedMinutesRaw = req.body?.attended_minutes;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const eventRow = await getEventByIdForVerify(client, eventId);
    if (!eventRow) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "Event not found" });
    }
    if (!eventIsOwnedByHostScope(eventRow, hostUserIds)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const rsvpRow = await getRsvpForUpdate(client, eventId, attendeeUserId);
    if (!rsvpRow) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "RSVP not found" });
    }

    if (rsvpRow.verification_status === "verified") {
      const totalVerified = await countVerifiedShifts(client, attendeeUserId);
      const funding = await processVerifiedEarnShift({
        client,
        attendeeUserId,
        eventId,
      });
      const pendingCredits = funding?.pending ? Number(funding?.amount) || 0 : 0;
      const awardedCredits = funding?.pending ? 0 : Number(funding?.amount) || 0;
      await client.query("COMMIT");
      return res.json({
        ok: true,
        already_verified: true,
        verification_status: "verified",
        attended_minutes: rsvpRow.attended_minutes ?? null,
        impact_credits_awarded: awardedCredits,
        impact_credits_pending: pendingCredits,
        credit_request_status: funding?.pending ? "pending" : funding?.already_awarded ? "approved" : null,
        unlocked_after_3: totalVerified >= 3,
        total_verified_shifts: totalVerified,
      });
    }

    let attendedMinutes = null;
    if (attendedMinutesRaw !== undefined && attendedMinutesRaw !== null && attendedMinutesRaw !== "") {
      const parsed = Number(attendedMinutesRaw);
      if (Number.isFinite(parsed)) {
        attendedMinutes = Math.trunc(parsed);
      }
    }
    if (!Number.isFinite(attendedMinutes)) {
      if (eventRow.start_at && eventRow.end_at) {
        const start = new Date(eventRow.start_at);
        const end = new Date(eventRow.end_at);
        const diffMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
        attendedMinutes = diffMinutes;
      } else {
        attendedMinutes = 60;
      }
    }
    attendedMinutes = Math.min(480, Math.max(15, attendedMinutes));

    await updateEventRsvpVerification(client, {
      eventId,
      attendeeUserId,
      decision,
      attendedMinutes,
      notes,
    });

    if (decision === "rejected") {
      const totalVerified = await countVerifiedShifts(client, attendeeUserId);
      await client.query("COMMIT");
      return res.json({
        ok: true,
        verification_status: "rejected",
        attended_minutes: attendedMinutes,
        impact_credits_awarded: 0,
        impact_credits_pending: 0,
        credit_request_status: null,
        unlocked_after_3: totalVerified >= 3,
        total_verified_shifts: totalVerified,
      });
    }

    const funding = await processVerifiedEarnShift({
      client,
      attendeeUserId,
      eventId,
    });
    const pendingCredits = funding?.pending ? Number(funding?.amount) || 0 : 0;
    const awardedCredits = funding?.pending ? 0 : Number(funding?.amount) || 0;

    const totalVerifiedAfter = await countVerifiedShifts(client, attendeeUserId);
    await client.query("COMMIT");
    return res.json({
      ok: true,
      verification_status: "verified",
      attended_minutes: attendedMinutes,
      impact_credits_awarded: awardedCredits,
      impact_credits_pending: pendingCredits,
      credit_request_status: funding?.pending ? "pending" : funding?.already_awarded ? "approved" : null,
      unlocked_after_3: totalVerifiedAfter >= 3,
      total_verified_shifts: totalVerifiedAfter,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[eventsApi] verifyEventRsvp error:", error);
    return res.status(500).json({ ok: false, error: "Unable to verify attendance" });
  } finally {
    client.release();
  }
}

export async function updateEvent(req, res) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const hostUserIds = await resolveHostUserIds(req);
    const eventId = req.params.id;
    const body = req.body || {};

    const { rows: [existing] } = await client.query(
      `SELECT * FROM events WHERE id = $1 LIMIT 1 FOR UPDATE`,
      [eventId]
    );
    if (!existing) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "Event not found" });
    }
    if (!eventIsOwnedByHostScope(existing, hostUserIds)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ ok: false, error: "Only the host can edit this event" });
    }

    if (!EDITABLE_STATUS_SET.has(existing.status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ ok: false, error: "Only draft or published events can be edited" });
    }

    const requestedStatus = STATUS_SET.has(body.status) ? body.status : null;
    const targetStatus = requestedStatus || existing.status;
    const strict = targetStatus === "published";

    const payload = await buildEventPayload(body, { strict, fallback: existing });
    const finalStatus = targetStatus;
    const locationLat = parseFloat(body.location_lat) || null;
    const locationLng = parseFloat(body.location_lng) || null;

    await client.query(
      `
        UPDATE events
           SET title=$1,
               category=$2,
               start_at=$3,
               end_at=$4,
               tz=$5,
               location_text=$6,
               location_lat=$7,
               location_lng=$8,
               org_name=$9,
               community_tag=$10,
               cause_tags=$11::text[],
               requirements=$12,
               verification_method=$13,
               impact_credits_base=$14,
               reliability_weight=$15,
               visibility=$16,
               capacity=$17,
               waitlist_enabled=$18,
               cover_url=$19,
               description=$20,
               reward_pool_kind=$21,
               funding_pool_slug=$22,
               attendance_methods=$23,
               safety_notes=$24,
               status=$25,
               updated_at = NOW()
         WHERE id = $26
      `,
      [
        payload.title,
        payload.category,
        payload.start_at,
        payload.end_at,
        payload.tz,
        payload.location_text,
        locationLat,
        locationLng,
        payload.org_name,
        payload.community_tag,
        payload.cause_tags,
        payload.requirements,
        payload.verification_method,
        payload.impact_credits_base,
        payload.reliability_weight,
        payload.visibility,
        payload.capacity,
        payload.waitlist_enabled,
        payload.cover_url,
        payload.description,
        payload.reward_pool_kind,
        payload.funding_pool_slug,
        JSON.stringify(payload.attendance_methods),
        payload.safety_notes,
        finalStatus,
        eventId,
      ]
    );

    await promoteWaitlistedAttendees({ runner: client, eventId });
    await client.query("COMMIT");
    return res.json({ ok: true, data: { id: eventId, status: finalStatus } });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("[eventsApi] updateEvent error:", error);
    if (error?.statusCode === 400) {
      return res.status(400).json({ ok: false, error: error.message });
    }
    return res.status(500).json({ ok: false, error: "Unable to update event" });
  } finally {
    client.release();
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

function sanitizeTone(value) {
  if (!value) return null;
  const tone = value.toLowerCase();
  return INVITE_TONES[tone] ? tone : null;
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

function generateInviteDraft({ tone, senderName, eventTitle, eventLocation, eventSummary }) {
  const template = INVITE_TONES[tone] || INVITE_TONES.friendly;
  const tokens = {
    senderName,
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

function formatSenderName(senderRow, fallbackEmail) {
  const first = sanitizeString(senderRow?.firstname);
  const last = sanitizeString(senderRow?.lastname);
  const full = `${first} ${last}`.trim();
  if (full) return full;
  const email = sanitizeString(senderRow?.email || fallbackEmail);
  if (!email.includes("@")) return "A friend";
  return email.split("@")[0].replace(/[._-]+/g, " ").trim() || "A friend";
}

async function resolveInviteSenderContext({ senderId, senderHostUserIds = [], eventId, senderEmail }) {
  const { rows: [eventRow] } = await pool.query(
    `SELECT id, creator_user_id, status, title, description, start_at, end_at, tz, location_text
       FROM events
      WHERE id = $1
      LIMIT 1`,
    [eventId]
  );
  if (!eventRow) {
    return { errorCode: "EVENT_NOT_FOUND" };
  }
  if (!INVITE_ALLOWED_EVENT_STATUSES.has(eventRow.status)) {
    return { errorCode: "INVITE_EVENT_STATUS_INVALID" };
  }

  const { rows: [senderRow] } = await pool.query(
    `SELECT u.id,
            u.firstname,
            u.lastname,
            u.email,
            r.status AS rsvp_status
       FROM userdata u
  LEFT JOIN event_rsvps r
         ON r.event_id = $2
        AND r.attendee_user_id = u.id
      WHERE u.id = $1
      LIMIT 1`,
    [senderId, eventId]
  );

  const normalizedHostIds = Array.isArray(senderHostUserIds)
    ? senderHostUserIds.map((value) => String(value))
    : [];
  const isHost = normalizedHostIds.includes(String(eventRow.creator_user_id));
  const senderRsvpStatus = sanitizeString(senderRow?.rsvp_status).toLowerCase();
  const isEligible = isHost || INVITE_ELIGIBLE_STATUSES.has(senderRsvpStatus);
  if (!isEligible) {
    return { errorCode: "INVITE_APPROVAL_REQUIRED" };
  }

  const resolvedEmail = sanitizeString(senderRow?.email || senderEmail).toLowerCase() || null;
  return {
    eventRow,
    senderName: formatSenderName(senderRow, resolvedEmail),
    senderEmail: resolvedEmail,
    isHost,
  };
}

async function checkSenderRateLimits(senderUserId) {
  try {
    const { rows: [counts] } = await pool.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 hour') AS hourly_count,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day') AS daily_count
        FROM invites
        WHERE sender_user_id = $1
      `,
      [senderUserId]
    );
    const hourlyCount = Number(counts?.hourly_count) || 0;
    const dailyCount = Number(counts?.daily_count) || 0;
    if (hourlyCount >= INVITE_SENDER_HOURLY_LIMIT) return "sender_hourly_limit";
    if (dailyCount >= INVITE_SENDER_DAILY_LIMIT) return "sender_daily_limit";
    return null;
  } catch (error) {
    if (error?.code === "42P01") return null;
    throw error;
  }
}

async function countSenderEventInvites({ senderUserId, eventId }) {
  try {
    const { rows: [row] } = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM invites
        WHERE sender_user_id = $1
          AND event_id = $2
      `,
      [senderUserId, eventId]
    );
    return Number(row?.total) || 0;
  } catch (error) {
    if (error?.code === "42P01") return 0;
    throw error;
  }
}

async function hasRecipientCooldown({ senderUserId, inviteeEmail }) {
  try {
    const { rows } = await pool.query(
      `
        SELECT id
        FROM invites
        WHERE sender_user_id = $1
          AND LOWER(invitee_email) = LOWER($2)
          AND created_at >= NOW() - make_interval(hours => $3)
        LIMIT 1
      `,
      [senderUserId, inviteeEmail, INVITE_RECIPIENT_COOLDOWN_HOURS]
    );
    return Boolean(rows[0]);
  } catch (error) {
    if (error?.code === "42P01") return false;
    throw error;
  }
}

async function findDuplicateInviteInWindow({ eventId, recipientUserId, inviteeEmail }) {
  try {
    const { rows } = await pool.query(
      `
        SELECT id
        FROM invites
        WHERE event_id = $1
          AND (
            ($2::text IS NOT NULL AND recipient_user_id::text = $2::text)
            OR LOWER(invitee_email) = LOWER($3)
          )
          AND created_at >= NOW() - make_interval(hours => $4)
        LIMIT 1
      `,
      [eventId, recipientUserId, inviteeEmail, INVITE_DUPLICATE_WINDOW_HOURS]
    );
    return rows[0] || null;
  } catch (error) {
    if (error?.code === "42P01") return null;
    throw error;
  }
}

async function recipientHasBlockedSender({ recipientUserId, senderUserId }) {
  if (!recipientUserId) return false;
  try {
    const { rows } = await pool.query(
      `
        SELECT 1
        FROM invite_sender_blocks
        WHERE blocker_user_id = $1
          AND blocked_user_id = $2
        LIMIT 1
      `,
      [recipientUserId, senderUserId]
    );
    return Boolean(rows[0]);
  } catch (error) {
    if (error?.code === "42P01") return false;
    throw error;
  }
}

async function logInviteModeration({
  eventId,
  inviteId = null,
  senderUserId = null,
  recipientUserId = null,
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
    console.error("[eventsApi] invite moderation log failed:", error);
  }
}

function buildInviteEmailCopy({
  eventRow,
  senderName,
  senderEmail,
  inviteeName,
  tone,
  eventLink,
  joinLink,
}) {
  const eventTitle = eventRow?.title || "a Get Kinder event";
  const eventLocation = sanitizeString(eventRow?.location_text) || "Location TBD";
  const eventSummary = formatEventSummaryForInvite(eventRow);
  const draft = generateInviteDraft({
    tone: tone || "friendly",
    senderName: senderName || "A friend",
    eventTitle,
    eventLocation,
    eventSummary,
  });
  const subject = draft.subject;
  const body = draft.body;
  const greetingName = inviteeName?.split(/\s+/)[0] || "there";
  const messageHtml = createMessageHtml(body) || `<p>${escapeHtml(body)}</p>`;
  const detailsHtml = `<p><strong>Event:</strong> ${escapeHtml(eventTitle)}<br/>${escapeHtml(eventSummary)}<br/>${escapeHtml(eventLocation)}</p>`;
  const eventHref = eventLink || joinLink || (process.env.APP_BASE_URL || "https://getkinder.ai");
  const joinHref = joinLink || eventHref;
  const replyHtml = senderEmail
    ? `<p style="color:#475569;font-size:0.95rem">Reply directly to ${escapeHtml(senderEmail)}.</p>`
    : "";
  const replyText = senderEmail ? `Reply directly to: ${senderEmail}\n` : "";
  const html = `
    <p>Hi ${escapeHtml(greetingName)},</p>
    ${messageHtml}
    ${detailsHtml}
    <p><a href="${eventHref}" target="_blank" rel="noopener">View event details</a></p>
    <p><a href="${joinHref}" target="_blank" rel="noopener">Join Get Kinder to RSVP</a></p>
    ${replyHtml}
    <p>See you there! 💛</p>
  `;
  const text = `Hi ${greetingName},\n\n${body}\n\nEvent: ${eventTitle}\nWhen: ${eventSummary}\nWhere: ${eventLocation}\n\nView: ${eventHref}\nJoin: ${joinHref}\n${replyText}`;
  return { subject, html, text, body }; // body returned for drafts
}

function formatInviteEventDateTime(startAt, endAt, timeZone) {
  if (!startAt) return "Date TBD";
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) return "Date TBD";
  const end = endAt ? new Date(endAt) : null;
  const tz = String(timeZone || "America/Vancouver");
  const startLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(start);
  const endLabel = end && !Number.isNaN(end.getTime())
    ? new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: tz,
      }).format(end)
    : null;
  return endLabel ? `${startLabel} - ${endLabel} (${tz})` : `${startLabel} (${tz})`;
}

function buildPendingApprovalEmailCopy({
  adminFirstName,
  attendeeName,
  attendeeEmail,
  eventId,
  eventTitle,
  description,
  startAt,
  endAt,
  timeZone,
  locationText,
} = {}) {
  const greetingName = sanitizeString(adminFirstName) || "there";
  const safeTitle = eventTitle || "Get Kinder opportunity";
  const safeLocation = sanitizeString(locationText) || "Location TBD";
  const safeDescription = sanitizeString(description);
  const whenLabel = formatInviteEventDateTime(startAt, endAt, timeZone);
  const baseUrl = buildAppBaseUrl();
  const eventHref = `${baseUrl}/events/${encodeURIComponent(String(eventId || ""))}`;
  const orgPortalHref = `${baseUrl}/org-portal`;
  const attendeeLabel = sanitizeString(attendeeName) || attendeeEmail || "A volunteer";
  const attendeeLine = attendeeEmail && attendeeEmail !== attendeeLabel
    ? `${attendeeLabel} (${attendeeEmail})`
    : attendeeLabel;

  const html = `
    <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5">
      <p>Hi ${escapeHtml(greetingName)},</p>
      <p><strong>${escapeHtml(attendeeLine)}</strong> has requested approval for <strong>${escapeHtml(safeTitle)}</strong>.</p>
      <p style="margin:0 0 16px">
        <strong>When:</strong> ${escapeHtml(whenLabel)}<br/>
        <strong>Where:</strong> ${escapeHtml(safeLocation)}
      </p>
      ${safeDescription ? `<p style="margin:0 0 16px">${escapeHtml(safeDescription)}</p>` : ""}
      <p style="margin:0 0 16px">
        <a href="${orgPortalHref}" target="_blank" rel="noopener" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#455a7c;color:#ffffff;text-decoration:none;font-weight:700;margin-right:8px">Review in Org Portal</a>
        <a href="${eventHref}" target="_blank" rel="noopener" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#ff5656;color:#ffffff;text-decoration:none;font-weight:700">View Event</a>
      </p>
      <p>There is now a pending approval waiting in your organization queue.</p>
    </div>
  `;
  const text = [
    `Hi ${greetingName},`,
    "",
    `${attendeeLine} has requested approval for ${safeTitle}.`,
    `When: ${whenLabel}`,
    `Where: ${safeLocation}`,
    safeDescription ? `Details: ${safeDescription}` : "",
    "",
    `Review in Org Portal: ${orgPortalHref}`,
    `View event: ${eventHref}`,
    "",
    "There is now a pending approval waiting in your organization queue.",
  ].filter(Boolean).join("\n");

  return {
    subject: `Pending approval for ${safeTitle}`,
    html,
    text,
  };
}

async function getRsvpNotificationContext(eventId, attendeeId) {
  const normalizedEventId = String(eventId || "").trim();
  const normalizedAttendeeId = String(attendeeId || "").trim();
  if (!normalizedEventId || !normalizedAttendeeId) {
    return { eventRow: null, attendeeRow: null, normalizedEventId, normalizedAttendeeId };
  }

  const [{ rows: [eventRow] = [] }, { rows: [attendeeRow] = [] }] = await Promise.all([
    pool.query(
      `
        SELECT
          e.id,
          e.title,
          e.description,
          e.start_at,
          e.end_at,
          e.tz,
          e.location_text,
          e.creator_user_id,
          creator.firstname AS creator_firstname,
          creator.lastname AS creator_lastname,
          creator.email AS creator_email,
          creator.org_id AS creator_org_id
        FROM events e
        LEFT JOIN userdata creator
          ON creator.id = e.creator_user_id
        WHERE e.id = $1
        LIMIT 1
      `,
      [normalizedEventId]
    ),
    pool.query(
      `
        SELECT firstname, lastname, email
        FROM userdata
        WHERE id = $1
        LIMIT 1
      `,
      [normalizedAttendeeId]
    ),
  ]);

  return {
    eventRow: eventRow || null,
    attendeeRow: attendeeRow || null,
    normalizedEventId,
    normalizedAttendeeId,
  };
}

async function getEventNotificationRecipients(eventRow) {
  const recipients = [];
  const seenEmails = new Set();
  const orgId = Number(eventRow.creator_org_id);
  if (Number.isInteger(orgId) && orgId > 0 && await hasUserOrgMembershipTable()) {
    const { rows } = await pool.query(
      `
        SELECT DISTINCT
          u.firstname,
          u.lastname,
          u.email
        FROM public.user_org_memberships m
        JOIN public.userdata u
          ON u.id = m.user_id
        WHERE m.org_id = $1
          AND COALESCE(m.is_active, true) = true
          AND LOWER(COALESCE(m.role, 'admin')) = 'admin'
          AND u.email IS NOT NULL
        ORDER BY u.email
      `,
      [orgId]
    );
    rows.forEach((row) => {
      const email = sanitizeString(row.email).toLowerCase();
      if (!email || seenEmails.has(email)) return;
      seenEmails.add(email);
      recipients.push({
        firstName: sanitizeString(row.firstname),
        email,
      });
    });
  }

  if (Number.isInteger(orgId) && orgId > 0) {
    const { rows } = await pool.query(
      `
        SELECT DISTINCT firstname, lastname, email
        FROM public.userdata
        WHERE org_id = $1
          AND org_rep = true
          AND email IS NOT NULL
        ORDER BY email
      `,
      [orgId]
    );
    rows.forEach((row) => {
      const email = sanitizeString(row.email).toLowerCase();
      if (!email || seenEmails.has(email)) return;
      seenEmails.add(email);
      recipients.push({
        firstName: sanitizeString(row.firstname),
        email,
      });
    });
  }

  const creatorEmail = sanitizeString(eventRow.creator_email).toLowerCase();
  if (!recipients.length && creatorEmail) {
    recipients.push({
      firstName: sanitizeString(eventRow.creator_firstname),
      email: creatorEmail,
    });
  }

  return recipients;
}

function buildRsvpCancellationEmailCopy({
  adminFirstName,
  attendeeName,
  attendeeEmail,
  eventId,
  eventTitle,
  startAt,
  endAt,
  timeZone,
  locationText,
  previousStatus,
} = {}) {
  const greetingName = sanitizeString(adminFirstName) || "there";
  const safeTitle = eventTitle || "Get Kinder opportunity";
  const safeLocation = sanitizeString(locationText) || "Location TBD";
  const whenLabel = formatInviteEventDateTime(startAt, endAt, timeZone);
  const baseUrl = buildAppBaseUrl();
  const eventHref = `${baseUrl}/events/${encodeURIComponent(String(eventId || ""))}`;
  const orgPortalHref = `${baseUrl}/org-portal`;
  const attendeeLabel = sanitizeString(attendeeName) || attendeeEmail || "A volunteer";
  const attendeeLine = attendeeEmail && attendeeEmail !== attendeeLabel
    ? `${attendeeLabel} (${attendeeEmail})`
    : attendeeLabel;
  const priorLabel = sanitizeString(previousStatus).replace(/_/g, " ") || "active RSVP";

  const html = `
    <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5">
      <p>Hi ${escapeHtml(greetingName)},</p>
      <p><strong>${escapeHtml(attendeeLine)}</strong> cancelled their attendance for <strong>${escapeHtml(safeTitle)}</strong>.</p>
      <p style="margin:0 0 16px">
        <strong>Previous status:</strong> ${escapeHtml(priorLabel)}<br/>
        <strong>When:</strong> ${escapeHtml(whenLabel)}<br/>
        <strong>Where:</strong> ${escapeHtml(safeLocation)}
      </p>
      <p style="margin:0 0 16px">
        <a href="${orgPortalHref}" target="_blank" rel="noopener" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#455a7c;color:#ffffff;text-decoration:none;font-weight:700;margin-right:8px">Open Org Portal</a>
        <a href="${eventHref}" target="_blank" rel="noopener" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#ff5656;color:#ffffff;text-decoration:none;font-weight:700">View Event</a>
      </p>
      <p>The volunteer is no longer attending this event.</p>
    </div>
  `;
  const text = [
    `Hi ${greetingName},`,
    "",
    `${attendeeLine} cancelled their attendance for ${safeTitle}.`,
    `Previous status: ${priorLabel}`,
    `When: ${whenLabel}`,
    `Where: ${safeLocation}`,
    "",
    `Open Org Portal: ${orgPortalHref}`,
    `View event: ${eventHref}`,
    "",
    "The volunteer is no longer attending this event.",
  ].filter(Boolean).join("\n");

  return {
    subject: `Attendance cancelled for ${safeTitle}`,
    html,
    text,
  };
}

async function sendPendingApprovalNotifications({ eventId, attendeeId }) {
  const { eventRow, attendeeRow, normalizedEventId } = await getRsvpNotificationContext(eventId, attendeeId);
  if (!eventRow) return;

  const recipients = await getEventNotificationRecipients(eventRow);
  if (!recipients.length) return;

  const attendeeName = [attendeeRow?.firstname, attendeeRow?.lastname]
    .map((value) => sanitizeString(value))
    .filter(Boolean)
    .join(" ");
  const attendeeEmail = sanitizeString(attendeeRow?.email);

  const deliveryResults = await Promise.allSettled(
    recipients.map((recipient) => {
      const emailCopy = buildPendingApprovalEmailCopy({
        adminFirstName: recipient.firstName,
        attendeeName,
        attendeeEmail,
        eventId: eventRow.id,
        eventTitle: eventRow.title,
        description: eventRow.description,
        startAt: eventRow.start_at,
        endAt: eventRow.end_at,
        timeZone: eventRow.tz,
        locationText: eventRow.location_text,
      });
      return sendNudgeEmail({
        to: recipient.email,
        subject: emailCopy.subject,
        text: emailCopy.text,
        html: emailCopy.html,
        fromName: "Get Kinder",
      });
    })
  );

  deliveryResults.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error("[eventsApi] pending approval email failed:", {
        eventId: normalizedEventId,
        recipient: recipients[index]?.email || null,
        error: result.reason?.message || result.reason,
      });
    }
  });
}

async function sendRsvpCancellationNotifications({ eventId, attendeeId, previousStatus }) {
  const { eventRow, attendeeRow, normalizedEventId } = await getRsvpNotificationContext(eventId, attendeeId);
  if (!eventRow) return;

  const recipients = await getEventNotificationRecipients(eventRow);
  if (!recipients.length) return;

  const attendeeName = [attendeeRow?.firstname, attendeeRow?.lastname]
    .map((value) => sanitizeString(value))
    .filter(Boolean)
    .join(" ");
  const attendeeEmail = sanitizeString(attendeeRow?.email);

  const deliveryResults = await Promise.allSettled(
    recipients.map((recipient) => {
      const emailCopy = buildRsvpCancellationEmailCopy({
        adminFirstName: recipient.firstName,
        attendeeName,
        attendeeEmail,
        eventId: eventRow.id,
        eventTitle: eventRow.title,
        startAt: eventRow.start_at,
        endAt: eventRow.end_at,
        timeZone: eventRow.tz,
        locationText: eventRow.location_text,
        previousStatus,
      });
      return sendNudgeEmail({
        to: recipient.email,
        subject: emailCopy.subject,
        text: emailCopy.text,
        html: emailCopy.html,
        fromName: "Get Kinder",
      });
    })
  );

  deliveryResults.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error("[eventsApi] RSVP cancellation email failed:", {
        eventId: normalizedEventId,
        recipient: recipients[index]?.email || null,
        error: result.reason?.message || result.reason,
      });
    }
  });
}

function buildCoordinatorInviteEmailCopy({
  eventId,
  eventRow,
  senderName,
  inviteeName,
}) {
  const greetingName = inviteeName?.split(/\s+/)[0] || "there";
  const safeTitle = eventRow?.title || "a Get Kinder opportunity";
  const safeLocation = sanitizeString(eventRow?.location_text) || "Location TBD";
  const safeDescription = sanitizeString(eventRow?.description);
  const coordinatorName = sanitizeString(senderName) || "Our coordinator";
  const whenLabel = formatInviteEventDateTime(eventRow?.start_at, eventRow?.end_at, eventRow?.tz);
  const baseUrl = buildAppBaseUrl();
  const publishedEvent = String(eventRow?.status || "").toLowerCase() === "published";
  const eventHref = publishedEvent
    ? `${baseUrl}/events/${encodeURIComponent(String(eventId || ""))}`
    : `${baseUrl}/register?event=${encodeURIComponent(String(eventId || ""))}`;
  const calendarHref = `${baseUrl}/api/events/${encodeURIComponent(String(eventId || ""))}/calendar.ics`;
  const html = `
    <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5">
      <p>Hi ${escapeHtml(greetingName)},</p>
      <p>${escapeHtml(coordinatorName)} thinks you would be a great fit for <strong>${escapeHtml(safeTitle)}</strong>.</p>
      <p>We would love to invite you to join this opportunity.</p>
      <p style="margin:0 0 16px">
        <strong>When:</strong> ${escapeHtml(whenLabel)}<br/>
        <strong>Where:</strong> ${escapeHtml(safeLocation)}
      </p>
      ${safeDescription ? `<p style="margin:0 0 16px">${escapeHtml(safeDescription)}</p>` : ""}
      <p style="margin:0 0 16px">
        <a href="${eventHref}" target="_blank" rel="noopener" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#455a7c;color:#ffffff;text-decoration:none;font-weight:700;margin-right:8px">View Event Details</a>
        <a href="${calendarHref}" target="_blank" rel="noopener" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#ff5656;color:#ffffff;text-decoration:none;font-weight:700">Add to Calendar</a>
      </p>
      <p>You can also use the attached calendar invite file.</p>
      <p>If this feels like a fit, we would love to have you with us.</p>
    </div>
  `;
  const text = [
    `Hi ${greetingName},`,
    "",
    `${coordinatorName} thinks you would be a great fit for ${safeTitle}.`,
    "We would love to invite you to join this opportunity.",
    `When: ${whenLabel}`,
    `Where: ${safeLocation}`,
    safeDescription ? `Details: ${safeDescription}` : "",
    "",
    `View event details: ${eventHref}`,
    `Add to calendar: ${calendarHref}`,
    "",
    "A calendar invite is also attached.",
    "If this feels like a fit, we would love to have you with us.",
  ].filter(Boolean).join("\n");
  return {
    subject: `${coordinatorName} invited you to ${safeTitle}`,
    html,
    text,
  };
}

async function buildEventPayload(body, { strict = false, fallback = {} } = {}) {
  const base = fallback || {};
  const title = sanitizeString(body.title ?? base.title);
  if (!title) throw buildValidationError("Title is required.");

  const tz = sanitizeString(body.tz ?? base.tz) || "America/Vancouver";
  const locationText = truncateLocationForStorage(body.location_text ?? base.location_text);
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
  const orgName = sanitizeString(body.org_name ?? base.org_name) || null;
  if (!orgName) throw buildValidationError("Organization is required.");
  const communityTag = sanitizeString(body.community_tag ?? base.community_tag) || null;
  const requirements = sanitizeString(body.requirements ?? base.requirements) || null;
  const causeTagsInput = body.cause_tags ?? base.cause_tags;
  const causeTags = normalizeCauseTags(causeTagsInput);
  if (!causeTags.length) throw buildValidationError("Cause tag is required.");
  const category = sanitizeString(body.category ?? base.category) || causeTags[0] || null;
  const verificationMethodInput = sanitizeString(body.verification_method ?? base.verification_method);
  const verificationMethod = VERIFICATION_METHOD_SET.has(verificationMethodInput)
    ? verificationMethodInput
    : "host_attest";
  const impactCreditsRaw = body.impact_credits_base ?? base.impact_credits_base ?? 25;
  const impactCreditsBase = Number.isFinite(Number(impactCreditsRaw))
    ? Math.max(0, Math.trunc(Number(impactCreditsRaw)))
    : 25;
  const reliabilityRaw = body.reliability_weight ?? base.reliability_weight ?? 1;
  const reliabilityWeight = Number.isFinite(Number(reliabilityRaw))
    ? Math.max(0, Math.trunc(Number(reliabilityRaw)))
    : 1;
  const fundingPoolSlug = normalizeFundingPoolSlug(
    body.funding_pool_slug ?? base.funding_pool_slug,
    DEFAULT_FUNDING_POOL_SLUG
  );

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
    org_name: orgName,
    community_tag: communityTag,
    cause_tags: causeTags,
    requirements,
    verification_method: verificationMethod,
    impact_credits_base: impactCreditsBase,
    reliability_weight: reliabilityWeight,
    visibility,
    capacity,
    waitlist_enabled: waitlistEnabled,
    cover_url: coverUrl,
    description,
    reward_pool_kind: rewardPool,
    funding_pool_slug: fundingPoolSlug,
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
    const locationLat = parseFloat(body.location_lat) || null;
    const locationLng = parseFloat(body.location_lng) || null;

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
          location_lat,
          location_lng,
          org_name,
          community_tag,
          cause_tags,
          requirements,
          verification_method,
          impact_credits_base,
          reliability_weight,
          visibility,
          capacity,
          waitlist_enabled,
          cover_url,
          description,
          reward_pool_kind,
          funding_pool_slug,
          attendance_methods,
          safety_notes,
          status
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::text[],$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
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
        locationLat,
        locationLng,
        payload.org_name,
        payload.community_tag,
        payload.cause_tags,
        payload.requirements,
        payload.verification_method,
        payload.impact_credits_base,
        payload.reliability_weight,
        payload.visibility,
        payload.capacity,
        payload.waitlist_enabled,
        payload.cover_url,
        payload.description,
        payload.reward_pool_kind,
        payload.funding_pool_slug,
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
