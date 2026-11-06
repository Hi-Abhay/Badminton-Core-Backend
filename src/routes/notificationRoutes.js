// src/routes/notificationRoutes.js
const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const { protect } = require("../middleware/authMiddleware");

// All routes require authentication
router.use(protect);

/**
 * @swagger
 * tags:
 *   name: Notifications
 *   description: Push and in-app notification center for matches and challenges
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     NotificationSender:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: "6543216789abcdef12345678"
 *         fullName:
 *           type: string
 *           example: "John Doe"
 *         email:
 *           type: string
 *           example: "johndoe@example.com"
 *         profile_image:
 *           type: string
 *           nullable: true
 *           example: "https://example.com/avatar.png"
 *     NotificationMatch:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: "6543216789abcdef12345679"
 *         title:
 *           type: string
 *           example: "Men's Singles Championship"
 *         format:
 *           type: string
 *           enum: [SINGLES, DOUBLES]
 *           example: "SINGLES"
 *         status:
 *           type: string
 *           example: "INVITATION_PENDING"
 *     NotificationItem:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: "6543216789abcdef12345680"
 *         recipient:
 *           type: string
 *           example: "6543216789abcdef12345681"
 *         sender:
 *           $ref: '#/components/schemas/NotificationSender'
 *         title:
 *           type: string
 *           example: "🏸 New Match Challenge!"
 *         body:
 *           type: string
 *           example: "John Doe challenged you to a singles match. Tap to respond!"
 *         type:
 *           type: string
 *           enum:
 *             - MATCH_CHALLENGE
 *             - MATCH_CREATED
 *             - CHALLENGE_ACCEPTED
 *             - CHALLENGE_DECLINED
 *             - TOSS_COMPLETED
 *             - GAME_WON
 *             - MATCH_COMPLETED
 *             - GENERAL
 *           example: "MATCH_CHALLENGE"
 *         matchId:
 *           $ref: '#/components/schemas/NotificationMatch'
 *         data:
 *           type: object
 *           additionalProperties:
 *             type: string
 *           example:
 *             type: "MATCH_CHALLENGE"
 *             matchId: "6543216789abcdef12345679"
 *         isRead:
 *           type: boolean
 *           example: false
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2026-10-30T16:30:00.000Z"
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           example: "2026-10-30T16:30:00.000Z"
 */

/**
 * @swagger
 * /notifications/unread-count:
 *   get:
 *     summary: Get unread notifications count
 *     description: Returns the total count of unread notifications for the authenticated user.
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Unread notification count retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 unreadCount:
 *                   type: integer
 *                   example: 4
 *       401:
 *         description: Unauthorized - Bearer token missing or invalid
 *       500:
 *         description: Server error
 */
router.get("/unread-count", notificationController.getUnreadNotificationCount);

/**
 * @swagger
 * /notifications:
 *   get:
 *     summary: Get notifications for logged-in user
 *     description: Returns paginated notifications with overall unread count.
 *     tags: [Notifications]
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
 *         description: Number of records per page
 *       - in: query
 *         name: isRead
 *         schema:
 *           type: boolean
 *         description: Filter notifications by read status (true or false)
 *     responses:
 *       200:
 *         description: List of notifications retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 unreadCount:
 *                   type: integer
 *                   example: 4
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                       example: 24
 *                     page:
 *                       type: integer
 *                       example: 1
 *                     limit:
 *                       type: integer
 *                       example: 20
 *                     totalPages:
 *                       type: integer
 *                       example: 2
 *                 notifications:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/NotificationItem'
 *       401:
 *         description: Unauthorized - Bearer token missing or invalid
 *       500:
 *         description: Server error
 */
router.get("/", notificationController.getMyNotifications);

/**
 * @swagger
 * /notifications/mark-all-read:
 *   patch:
 *     summary: Mark all notifications as read
 *     description: Clears all unread notifications for the currently logged-in user.
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read
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
 *                   example: "All notifications marked as read."
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.patch("/mark-all-read", notificationController.markAllAsRead);

/**
 * @swagger
 * /notifications/{id}/read:
 *   patch:
 *     summary: Mark single notification as read
 *     description: Updates isRead flag to true for a given notification ID.
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the notification
 *     responses:
 *       200:
 *         description: Notification updated successfully
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
 *                   example: "Notification marked as read."
 *                 notification:
 *                   $ref: '#/components/schemas/NotificationItem'
 *       400:
 *         description: Invalid ID format
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Notification not found
 *       500:
 *         description: Server error
 */
router.patch("/:id/read", notificationController.markAsRead);

/**
 * @swagger
 * /notifications/{id}:
 *   delete:
 *     summary: Delete a notification
 *     description: Deletes a specific notification belonging to the logged-in user.
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the notification
 *     responses:
 *       200:
 *         description: Notification deleted successfully
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
 *                   example: "Notification deleted successfully."
 *       400:
 *         description: Invalid ID format
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Notification not found
 *       500:
 *         description: Server error
 */
router.delete("/:id", notificationController.deleteNotification);

module.exports = router;