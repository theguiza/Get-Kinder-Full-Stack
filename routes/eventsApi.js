import express from "express";
import { listEvents, getEventById, createEvent, createInvite, updateEvent, draftInviteCopy, downloadEventCalendar, respondToEventRsvp, checkInToEvent, verifyEventRsvp, listEventRoster } from "../controllers/eventsApiController.js";
import { getEventRatingStatus, submitEventRating } from "../controllers/eventsRatingsController.js";
import { cancelEvent, completeEvent, deleteDraftEvent } from "../controllers/meEventsApiController.js";
import { ensureOrgRep } from "../middleware/ensureOrgRep.js";

const eventsApiRouter = express.Router();

eventsApiRouter.get("/", listEvents);
eventsApiRouter.post("/", ensureOrgRep, createEvent);
eventsApiRouter.post("/:id/cancel", cancelEvent);
eventsApiRouter.post("/:id/complete", completeEvent);
eventsApiRouter.post("/:id/invites", createInvite);
eventsApiRouter.post("/:id/invite-copy", draftInviteCopy);
eventsApiRouter.post("/:id/rsvp", respondToEventRsvp);
eventsApiRouter.post("/:id/checkins", checkInToEvent);
eventsApiRouter.get("/:id/roster", listEventRoster);
eventsApiRouter.post("/:id/verify", verifyEventRsvp);
eventsApiRouter.post("/:id/ratings", submitEventRating);
eventsApiRouter.get("/:id/ratings/status", getEventRatingStatus);
eventsApiRouter.get("/:id/calendar.ics", downloadEventCalendar);
eventsApiRouter.get("/:id", getEventById);
eventsApiRouter.patch("/:id", ensureOrgRep, updateEvent);
eventsApiRouter.delete("/:id", ensureOrgRep, deleteDraftEvent);

export default eventsApiRouter;
