import { Router } from "express";
import { protect } from "../middleware/auth.middleware";
import { moduleFrom, requireModuleAccess } from "../middleware/access.middleware";
import {
    createCollection,
    getModuleCollections,
    updateCollection,
    deleteCollection
} from "../controllers/collection.controller";


const router=Router();


router.post(
    "/:moduleId",
    protect,
    requireModuleAccess(moduleFrom.param),
    createCollection
);


router.get(
    "/:moduleId",
    protect,
    requireModuleAccess(moduleFrom.param),
    getModuleCollections
);


router.put(
    "/:collectionId",
    protect,
    requireModuleAccess(moduleFrom.collectionParam),
    updateCollection
);


router.delete(
    "/:collectionId",
    protect,
    requireModuleAccess(moduleFrom.collectionParam),
    deleteCollection
);


export default router;