import { Router } from "express";
import { protect } from "../middleware/auth.middleware";

import {

    createItemValue,

    getItemValues,

    updateItemValue,

    deleteItemValue

} from "../controllers/itemValue.controller";

const router = Router();

router.post(

    "/",
    protect,

    createItemValue

);

router.get(

    "/:itemId",
    protect,

    getItemValues

);

router.put(

    "/:itemValueId",
    protect,

    updateItemValue

);

router.delete(

    "/:itemValueId",
    protect,

    deleteItemValue

);

export default router;