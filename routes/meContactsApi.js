import express from "express";
import { listContacts } from "../controllers/meContactsController.js";

const meContactsRouter = express.Router();

meContactsRouter.get("/", listContacts);

export default meContactsRouter;
