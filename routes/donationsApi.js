import express from "express";
import { createManualDonation, confirmSquareDonation, claimDonation } from "../controllers/donationsApiController.js";

const donationsApiRouter = express.Router();

donationsApiRouter.post("/manual", createManualDonation);
donationsApiRouter.post("/square/confirm", confirmSquareDonation);
donationsApiRouter.post("/claim", claimDonation);

export default donationsApiRouter;
