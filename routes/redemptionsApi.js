import express from "express";
import {
  getHistoryHandler,
  getOffersHandler,
  redeemHandler,
} from "../controllers/redemptionsApiController.js";

const redemptionsApiRouter = express.Router();

redemptionsApiRouter.get("/offers", getOffersHandler);
redemptionsApiRouter.get("/history", getHistoryHandler);
redemptionsApiRouter.post("/redeem", redeemHandler);

export default redemptionsApiRouter;
