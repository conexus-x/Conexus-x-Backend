import { Router } from "express";
import { protect } from "../middleware/auth.middleware";
import {
    createColumn,
    getBoardColumns,
    updateColumn,
    deleteColumn
} from "../controllers/column.controller";

const router=Router();


router.post(
    "/:boardId",
    protect,
    createColumn
);


router.get(
    "/:boardId",
    protect,
    getBoardColumns
);


router.put(
    "/:columnId",
    protect,
    updateColumn
);


router.delete(
    "/:columnId",
    protect,
    deleteColumn
);


export default router;