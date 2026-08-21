import { Router } from "express";
import {
    deleteUserAvatar,
    deleteWorkspaceFile,
    getUploadLimits,
    uploadUserAvatar,
    uploadWorkspaceFiles
} from "../controllers/upload.controller";
import { protect } from "../middleware/auth.middleware";
import {
    handleUploadError,
    uploadAttachmentFiles,
    uploadAvatarFile
} from "../middleware/upload.middleware";

const router = Router();

router.use(protect);

router.get("/limits", getUploadLimits);

router.post("/avatar", uploadAvatarFile, uploadUserAvatar);
router.delete("/avatar", deleteUserAvatar);

router.post("/workspace/:workspaceId", uploadAttachmentFiles, uploadWorkspaceFiles);
router.delete("/workspace/:workspaceId", deleteWorkspaceFile);

// Multer rejections are turned into 400s here rather than bubbling up as 500s.
router.use(handleUploadError);

export default router;
