import { Router } from "express";
import { protect } from "../middleware/auth.middleware";

import {

    createItem,

    getGroupItems,

    updateItem,

    deleteItem

} from "../controllers/item.controller"

const router = Router();

router.post(

    "/:groupId",
    protect,

    createItem

);

router.get(

    "/:groupId",
    protect,

    getGroupItems

);

router.put(

    "/:itemId",
    protect,

    updateItem

);

router.delete(

    "/:itemId",
    protect,

    deleteItem

);

export default router;