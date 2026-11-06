// src/routes/chatRoutes.js
const express = require("express");
const router = express.Router();
const chatController = require("../controllers/chatController");
const { protect } = require("../middleware/authMiddleware");

// All chat operations require authentication
router.use(protect);

/**
 * @swagger
 * tags:
 *   name: Chats
 *   description: 1-on-1 direct messaging, conversation threads, and message history
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     ChatUser:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: "6543216789abcdef12345678"
 *         fullName:
 *           type: string
 *           example: "Viktor Axelsen"
 *         email:
 *           type: string
 *           example: "viktor@example.com"
 *         profile_image:
 *           type: string
 *           nullable: true
 *           example: "https://example.com/avatar.png"
 *         isOnline:
 *           type: boolean
 *           example: true
 *         lastSeen:
 *           type: string
 *           format: date-time
 *           example: "2026-11-01T18:30:00.000Z"
 *     ChatMessage:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: "6543216789abcdef12345690"
 *         conversationId:
 *           type: string
 *           example: "6543216789abcdef12345688"
 *         sender:
 *           type: string
 *           example: "6543216789abcdef12345678"
 *         recipient:
 *           type: string
 *           example: "6543216789abcdef12345679"
 *         text:
 *           type: string
 *           example: "Are we playing singles today?"
 *         mediaUrl:
 *           type: string
 *           nullable: true
 *           example: null
 *         mediaType:
 *           type: string
 *           enum: [text, image, audio, video, document]
 *           example: "text"
 *         status:
 *           type: string
 *           enum: [sent, delivered, read]
 *           example: "delivered"
 *         readAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           example: null
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2026-11-01T18:32:00.000Z"
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           example: "2026-11-01T18:32:00.000Z"
 *     ConversationItem:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: "6543216789abcdef12345688"
 *         otherUser:
 *           $ref: '#/components/schemas/ChatUser'
 *         lastMessage:
 *           $ref: '#/components/schemas/ChatMessage'
 *         unreadCount:
 *           type: integer
 *           example: 3
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           example: "2026-11-01T18:32:00.000Z"
 */

/**
 * @swagger
 * /chats/access:
 *   post:
 *     summary: Access or initiate a 1-on-1 conversation
 *     description: Finds an existing conversation channel between the authenticated user and recipient, or creates a new one.
 *     tags: [Chats]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - recipientId
 *             properties:
 *               recipientId:
 *                 type: string
 *                 description: MongoDB ObjectId of the opponent
 *                 example: "6543216789abcdef12345679"
 *     responses:
 *       200:
 *         description: Existing conversation retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 conversation:
 *                   type: object
 *       201:
 *         description: New conversation created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 conversation:
 *                   type: object
 *       400:
 *         description: Missing or invalid recipientId
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post("/access", chatController.accessConversation);

/**
 * @swagger
 * /chats:
 *   get:
 *     summary: Get all 1-on-1 conversations for current user
 *     description: Returns a WhatsApp-style conversation inbox sorted by recent activity with the other player's profile, unread counters, and last message.
 *     tags: [Chats]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Conversations per page
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Filter conversations by opponent name
 *     responses:
 *       200:
 *         description: Conversations retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 totalUnread:
 *                   type: integer
 *                   example: 3
 *                 page:
 *                   type: integer
 *                   example: 1
 *                 conversations:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ConversationItem'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get("/", chatController.getMyConversations);

/**
 * @swagger
 * /chats/{conversationId}/messages:
 *   get:
 *     summary: Get paginated message history for a conversation
 *     description: Returns messages in chronological order with cursor-based pagination using the `before` timestamp.
 *     tags: [Chats]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the conversation
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 30
 *         description: Number of messages to return
 *       - in: query
 *         name: before
 *         schema:
 *           type: string
 *           format: date-time
 *         description: ISO date string for cursor pagination (fetches messages sent before this timestamp)
 *     responses:
 *       200:
 *         description: Messages retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 hasMore:
 *                   type: boolean
 *                   example: true
 *                 messages:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ChatMessage'
 *       400:
 *         description: Invalid conversation ID
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get("/:conversationId/messages", chatController.getMessages);

/**
 * @swagger
 * /chats/{conversationId}/read:
 *   patch:
 *     summary: Mark messages in conversation as read
 *     description: Sets status to 'read' for all incoming messages and clears the unread badge count for the user.
 *     tags: [Chats]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the conversation
 *     responses:
 *       200:
 *         description: Messages marked as read successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Messages marked as read."
 *       400:
 *         description: Invalid conversation ID
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.patch("/:conversationId/read", chatController.markAsRead);

/**
 * @swagger
 * /chats/{conversationId}/messages:
 *   post:
 *     summary: Send a 1-on-1 message (REST / Swagger)
 *     description: Sends a message to an opponent via HTTP and dispatches it in real time to the recipient's socket if connected.
 *     tags: [Chats]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the conversation
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - recipientId
 *             properties:
 *               recipientId:
 *                 type: string
 *                 example: "6543216789abcdef12345679"
 *               text:
 *                 type: string
 *                 example: "Hey! Ready for our singles match?"
 *               mediaUrl:
 *                 type: string
 *                 nullable: true
 *                 example: null
 *               mediaType:
 *                 type: string
 *                 enum: [text, image, audio, video, document]
 *                 default: text
 *                 example: "text"
 *     responses:
 *       201:
 *         description: Message created and delivered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   $ref: '#/components/schemas/ChatMessage'
 *       400:
 *         description: Missing recipientId or empty message
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post("/:conversationId/messages", chatController.sendMessageHttp);

module.exports = router;