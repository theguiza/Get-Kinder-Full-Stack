import express from "express";
import {
  listMyEvents,
  getMyPoolSummary,
  getMyPoolTransactions,
  topUpMyPool,
} from "../controllers/meEventsApiController.js";

const meEventsRouter = express.Router();

meEventsRouter.get("/", listMyEvents);
meEventsRouter.get("/pools/summary", getMyPoolSummary);
meEventsRouter.get("/pools/transactions", getMyPoolTransactions);
meEventsRouter.post("/pools/topups", topUpMyPool);

export default meEventsRouter;
