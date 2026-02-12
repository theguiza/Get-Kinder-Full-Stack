import express from "express";
import { getDonorReceipts, getDonorSummary } from "../controllers/donorReceiptsApiController.js";

const donorReceiptsApiRouter = express.Router();

donorReceiptsApiRouter.get("/summary", getDonorSummary);
donorReceiptsApiRouter.get("/receipts", getDonorReceipts);

export default donorReceiptsApiRouter;
