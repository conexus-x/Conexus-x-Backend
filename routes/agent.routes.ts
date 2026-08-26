import { Router } from "express";
import { protect } from "../middleware/auth.middleware";
import { chatWithAgent, confirmAgentAction } from "../controllers/agent.controller";

const router = Router();

router.post("/chat", protect, chatWithAgent);
router.post("/confirm", protect, confirmAgentAction);

export default router;
