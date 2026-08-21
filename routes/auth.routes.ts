import { Router } from "express";
import {
    register,
    login,
    googleAuth,
    googleCallback,
    me
} from "../controllers/auth.controller";
import { protect } from "../middleware/auth.middleware";

const router = Router();

router.post("/register", register);
router.post("/login", login);

router.get("/google", googleAuth);
router.get("/google/callback", googleCallback);

router.get("/me", protect, me);

export default router;
