import { Router } from "express";
import { protect } from "../middleware/auth.middleware";
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
    createCollection
);


router.get(
    "/:moduleId",
    protect,
    getModuleCollections
);


router.put(
    "/:collectionId",
    protect,
    updateCollection
);


router.delete(
    "/:collectionId",
    protect,
    deleteCollection
);


export default router;