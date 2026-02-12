import express from "express";
import { getDonorReceipts, getDonorSummary } from "../controllers/donorApiController.js";

const donorApiRouter = express.Router();

donorApiRouter.get("/summary", getDonorSummary);
donorApiRouter.get("/receipts", getDonorReceipts);

export default donorApiRouter;
