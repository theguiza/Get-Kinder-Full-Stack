import express from "express";
import { squareWebhookHandler } from "../controllers/squareWebhooksController.js";

const router = express.Router();

router.post("/square", squareWebhookHandler);

export default router;
