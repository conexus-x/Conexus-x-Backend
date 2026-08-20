import { Router } from "express";
import { protect } from "../middleware/auth.middleware";
import {
    getApiKey,
    generateKey
} from "../controllers/apiKey.controller";


const router = Router();


router.get(
    "/",
    protect,
    getApiKey
);


router.post(
    "/generate",
    protect,
    generateKey
);


export default router;
