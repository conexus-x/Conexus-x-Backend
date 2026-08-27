import { Router } from "express";
import { protect } from "../middleware/auth.middleware";
import {
    chatWithAgent,
    confirmAgentAction,
    getAgentCredits
} from "../controllers/agent.controller";

const router = Router();

router.post("/chat", protect, chatWithAgent);
router.post("/confirm", protect, confirmAgentAction);
router.get("/credits", protect, getAgentCredits);

export default router;
