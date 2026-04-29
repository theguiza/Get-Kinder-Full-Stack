import express from "express";
import { listEvents, getEventById, createEvent, createInvite, createAdminSignup, updateEvent, draftInviteCopy, downloadEventCalendar, respondToEventRsvp, checkInToEvent, verifyEventRsvp, listEventRoster, markEventNoShow } from "../controllers/eventsApiController.js";
import { getEventRatingStatus, submitEventRating } from "../controllers/eventsRatingsController.js";
import { cancelEvent, completeEvent, deleteDraftEvent, forceCancelEvent } from "../controllers/meEventsApiController.js";
import { ensureAuthenticatedApi } from "../middleware/auth.js";
import { ensureOrgRep } from "../middleware/ensureOrgRep.js";
import { fetchEventsByOrg, fetchOrganizations } from "../services/eventsService.js";

const eventsApiRouter = express.Router();
const organizationsApiRouter = express.Router();

organizationsApiRouter.get("/", async (req, res) => {
  try {
    const organizations = await fetchOrganizations();
    return res.json({ organizations });
  } catch (error) {
    console.error("[eventsApi] listOrganizations error:", error);
    return res.status(500).json({ error: "internal_error" });
  }
});

organizationsApiRouter.get("/:orgId/events", async (req, res) => {
  const orgId = Number(req.params.orgId);
  if (!Number.isInteger(orgId) || orgId <= 0) {
    return res.status(400).json({ error: "invalid_org_id" });
  }

  try {
    const events = await fetchEventsByOrg(orgId);
    return res.json({ events });
  } catch (error) {
    console.error("[eventsApi] listEventsByOrganization error:", error);
    return res.status(500).json({ error: "internal_error" });
  }
});

eventsApiRouter.get("/", listEvents);
eventsApiRouter.get("/:id", getEventById);
eventsApiRouter.get("/:id/calendar.ics", downloadEventCalendar);

eventsApiRouter.use(ensureAuthenticatedApi);

eventsApiRouter.post("/", ensureOrgRep, createEvent);
eventsApiRouter.post("/:id/cancel", cancelEvent);
eventsApiRouter.post("/:id/force-cancel", forceCancelEvent);
eventsApiRouter.post("/:id/complete", completeEvent);
eventsApiRouter.post("/:id/invites", createInvite);
eventsApiRouter.post("/:id/admin-signup", createAdminSignup);
eventsApiRouter.post("/:id/invite-copy", draftInviteCopy);
eventsApiRouter.post("/:id/rsvp", respondToEventRsvp);
eventsApiRouter.post("/:id/checkins", checkInToEvent);
eventsApiRouter.get("/:id/roster", listEventRoster);
eventsApiRouter.post("/:id/no-show", markEventNoShow);
eventsApiRouter.post("/:id/verify", verifyEventRsvp);
eventsApiRouter.post("/:id/ratings", submitEventRating);
eventsApiRouter.get("/:id/ratings/status", getEventRatingStatus);
eventsApiRouter.patch("/:id", ensureOrgRep, updateEvent);
eventsApiRouter.delete("/:id", ensureOrgRep, deleteDraftEvent);

export default eventsApiRouter;
export { organizationsApiRouter };
