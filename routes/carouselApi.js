import express from "express";
import { listCarouselItems } from "../controllers/carouselApiController.js";

const carouselApiRouter = express.Router();

carouselApiRouter.get("/", listCarouselItems);

export default carouselApiRouter;
