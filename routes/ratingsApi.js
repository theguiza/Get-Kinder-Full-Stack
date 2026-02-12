import express from "express";
import { getRatingsSummary } from "../controllers/ratingsApiController.js";

const ratingsApiRouter = express.Router();

ratingsApiRouter.get("/summary", getRatingsSummary);

export default ratingsApiRouter;
