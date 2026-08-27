import { Router } from "express";
import { protect } from "../middleware/auth.middleware";
import {
    addMembers,
    createGroup,
    listContacts,
    listConversations,
    markRead,
    openDirectConversation,
    removeMember,
    updateConversation
} from "../controllers/conversation.controller";

const router = Router();

router.use(protect);

/**
 * Two-segment routes are declared BEFORE the single-segment ones, the same rule
 * the automation routes follow: `/:workspaceId/direct` must never be read as a
 * conversation id.
 */
/**
 * Meet spans every workspace the caller belongs to, so the LIST takes no
 * workspace id at all. `/contacts` is declared first for the usual reason: a
 * literal segment must never be readable as an id.
 */
router.get("/", listConversations);
router.get("/contacts", listContacts);
router.post("/:workspaceId/direct", openDirectConversation);
router.post("/:workspaceId/group", createGroup);

router.put("/:conversationId", updateConversation);
router.post("/:conversationId/members", addMembers);
router.delete("/:conversationId/members/:userId", removeMember);
router.post("/:conversationId/read", markRead);

export default router;
