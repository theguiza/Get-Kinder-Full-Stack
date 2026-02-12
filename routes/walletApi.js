import express from "express";
import { getWalletSummaryHandler } from "../controllers/walletApiController.js";

const walletApiRouter = express.Router();

walletApiRouter.get("/summary", getWalletSummaryHandler);

export default walletApiRouter;
