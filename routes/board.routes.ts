import { Router } from "express";
import { protect } from "../middleware/auth.middleware";
import {
    createBoard,
    getWorkspaceBoards,
    deleteBoard
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



router.delete(
    "/:boardId",
    protect,
    deleteBoard
);

export default router;