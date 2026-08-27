import { Router } from "express";
import { protect } from "../middleware/auth.middleware";
import {
    deleteMessage,
    editMessage,
    listMessages,
    logCallEvent,
    sendAttachments,
    sendMessage
} from "../controllers/message.controller";
import {
    handleUploadError,
    uploadAttachmentFiles
} from "../middleware/upload.middleware";

const router = Router();

router.use(protect);

router.get("/:conversationId", listMessages);
router.post("/:conversationId", sendMessage);

// Multipart only on the route that needs it — a plain send is the hot path.
router.post("/:conversationId/attachments", uploadAttachmentFiles, sendAttachments);

router.post("/:conversationId/call", logCallEvent);

router.put("/:messageId", editMessage);
router.delete("/:messageId", deleteMessage);

router.use(handleUploadError);

export default router;
