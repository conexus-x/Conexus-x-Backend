import { Router } from "express";
import {
    register,
    login,
    googleAuth,
    googleCallback,
    me,
    updateStatus,
    heartbeat
} from "../controllers/auth.controller";
import { protect } from "../middleware/auth.middleware";

const router = Router();

router.post("/register", register);
router.post("/login", login);

router.get("/google", googleAuth);
router.get("/google/callback", googleCallback);

router.get("/me", protect, me);

router.patch("/status", protect, updateStatus);
router.post("/heartbeat", protect, heartbeat);

export default router;
