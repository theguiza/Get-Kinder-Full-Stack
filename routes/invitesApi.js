import express from "express";
import {
  listInvites,
  updateInvite,
  deleteInvite,
  reportInvite,
  blockInviteSender,
} from "../controllers/invitesApiController.js";

const invitesApiRouter = express.Router();

invitesApiRouter.get("/", listInvites);
invitesApiRouter.patch("/:id", updateInvite);
invitesApiRouter.delete("/:id", deleteInvite);
invitesApiRouter.post("/:id/report", reportInvite);
invitesApiRouter.post("/:id/block", blockInviteSender);

export default invitesApiRouter;
