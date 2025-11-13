import express from "express";
import { listMyEvents } from "../controllers/meEventsApiController.js";

const meEventsRouter = express.Router();

meEventsRouter.get("/", listMyEvents);

export default meEventsRouter;
