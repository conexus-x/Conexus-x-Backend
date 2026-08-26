import { Router } from "express";
import {
    register,
    login,
    googleAuth,
    googleCallback,
    verifyOtp,
    resendOtp,
    saveOnboarding,
    me,
    updateStatus,
    updatePreferences,
    heartbeat
} from "../controllers/auth.controller";
import { protect } from "../middleware/auth.middleware";

const router = Router();

router.post("/register", register);
router.post("/login", login);

// Signup email verification. Public by necessity — the caller has no session
// yet; that is the whole point of the step.
router.post("/verify-otp", verifyOtp);
router.post("/resend-otp", resendOtp);

router.get("/google", googleAuth);
router.get("/google/callback", googleCallback);

router.get("/me", protect, me);

// The signup funnel's answers. Protected: it writes to the caller's own row.
router.post("/onboarding", protect, saveOnboarding);

router.patch("/status", protect, updateStatus);

// UI settings that follow the person rather than the browser.
router.patch("/preferences", protect, updatePreferences);
router.post("/heartbeat", protect, heartbeat);

export default router;
