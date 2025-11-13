import express from "express";
import { listEvents, getEventById, createEvent, createInvite, updateEvent, draftInviteCopy, downloadEventCalendar, respondToEventRsvp, checkInToEvent } from "../controllers/eventsApiController.js";
import { cancelEvent, completeEvent, deleteDraftEvent } from "../controllers/meEventsApiController.js";

const eventsApiRouter = express.Router();

eventsApiRouter.get("/", listEvents);
eventsApiRouter.post("/", createEvent);
eventsApiRouter.post("/:id/cancel", cancelEvent);
eventsApiRouter.post("/:id/complete", completeEvent);
eventsApiRouter.post("/:id/invites", createInvite);
eventsApiRouter.post("/:id/invite-copy", draftInviteCopy);
eventsApiRouter.post("/:id/rsvp", respondToEventRsvp);
eventsApiRouter.post("/:id/checkins", checkInToEvent);
eventsApiRouter.get("/:id/calendar.ics", downloadEventCalendar);
eventsApiRouter.get("/:id", getEventById);
eventsApiRouter.patch("/:id", updateEvent);
eventsApiRouter.delete("/:id", deleteDraftEvent);

export default eventsApiRouter;
