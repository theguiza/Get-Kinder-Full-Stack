import express from "express";
import { listInvites, updateInvite, deleteInvite } from "../controllers/invitesApiController.js";

const invitesApiRouter = express.Router();

invitesApiRouter.get("/", listInvites);
invitesApiRouter.patch("/:id", updateInvite);
invitesApiRouter.delete("/:id", deleteInvite);

export default invitesApiRouter;
