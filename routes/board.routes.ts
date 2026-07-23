import { Router } from "express";
import { protect } from "../middleware/auth.middleware";
import {
    createBoard,
    getWorkspaceBoards
} from "../controllers/board.controller";


const router = Router();



router.post(
    "/:workspaceId",
    protect,
    createBoard
);



router.get(
    "/:workspaceId",
    protect,
    getWorkspaceBoards
);



export default router;