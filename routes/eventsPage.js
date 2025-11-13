import { fetchEvents } from "../services/eventsService.js";

export async function getEventsPage(req, res) {
  const user = req.user ?? null;
  const assetTag = process.env.ASSET_TAG ?? Date.now().toString(36);

  let initialFeed = [];
  try {
    initialFeed = await fetchEvents({ limit: 20, offset: 0 });
  } catch (err) {
    console.error("[eventsPage] Failed to load events for SSR:", err);
    initialFeed = [];
  }

  const props = {
    initialRoute: req.query.view || "events",
    initialFeed,
    pagination: { limit: 20, sort: "relevance" },
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
