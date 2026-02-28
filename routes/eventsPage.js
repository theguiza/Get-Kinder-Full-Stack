import { fetchEvents } from "../services/eventsService.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function clampLimit(value) {
  const num = Number(value);
  const fallback = Number.isFinite(num) ? num : DEFAULT_LIMIT;
  return Math.min(Math.max(fallback, 1), MAX_LIMIT);
}

export async function getEventsPage(req, res) {
  const user = req.user ?? null;
  const assetTag = process.env.ASSET_TAG ?? Date.now().toString(36);
  const view = req.query.view === "archive" ? "archive" : "upcoming";
  const limit = clampLimit(req.query.limit);
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
  const initialRouteRaw = typeof req.query.route === "string" ? req.query.route.trim().toLowerCase() : "";
  const initialRoute = ["events", "invites", "my-invites"].includes(initialRouteRaw)
    ? initialRouteRaw
    : "events";

  let initialFeed = [];
  let nextCursor = null;
  try {
    const result = await fetchEvents({
      limit,
      view,
      cursor,
      community_tag: communityTag,
      cause_tag: causeTag,
    });
    initialFeed = Array.isArray(result?.events) ? result.events : [];
    nextCursor = result?.nextCursor || null;
  } catch (err) {
    console.error("[eventsPage] Failed to load events for SSR:", err);
    initialFeed = [];
    nextCursor = null;
  }

  const props = {
    initialRoute,
    initialFeed,
    pagination: {
      limit,
      sort: "relevance",
      view,
      community_tag: communityTag,
      cause_tag: causeTag,
      cursor,
      nextCursor,
    },
    brand: { primary: "#ff5656", ink: "#455a7c" },
    geoCheckinEnabled: false,
  };

  return res.render("events", {
    user,
    props,
    assetTag,
    csrfToken: typeof req.csrfToken === "function" ? req.csrfToken() : null,
  });
}
