import { Router } from "express";
import { protect } from "../middleware/auth.middleware";
import {
    createGroup,
    getBoardGroups,
    updateGroup,
    deleteGroup
} from "../controllers/group.controller";


const router=Router();


router.post(
    "/:boardId",
    protect,
    createGroup
);


router.get(
    "/:boardId",
    protect,
    getBoardGroups
);


router.put(
    "/:groupId",
    protect,
    updateGroup
);


router.delete(
    "/:groupId",
    protect,
    deleteGroup
);


export default router;