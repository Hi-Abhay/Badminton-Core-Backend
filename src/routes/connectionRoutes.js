const express = require("express");
const router = express.Router();
const connectionController = require("../controllers/connectionController");
const { protect } = require("../middleware/authMiddleware");

router.use(protect);

/**
 * @swagger
 * tags:
 *   name: Connections
 *   description: Matchmaking and friend requests
 */

/**
 * @swagger
 * /connections/request:
 *   post:
 *     summary: Send a connection request to another player
 *     tags: [Connections]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recipientId]
 *             properties:
 *               recipientId:
 *                 type: string
 *                 example: 652f1b8a9c1e2b001a4e5f62
 *     responses:
 *       201:
 *         description: Request sent successfully
 *       400:
 *         description: Cannot connect with self or already connected
 */
router.post("/request", connectionController.sendRequest);

/**
 * @swagger
 * /connections/{connectionId}/respond:
 *   patch:
 *     summary: Accept or decline a received connection request
 *     tags: [Connections]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: connectionId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the connection request
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action]
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [accept, decline]
 *                 example: accept
 *     responses:
 *       200:
 *         description: Request updated
 *       403:
 *         description: Not authorized to respond
 */
router.patch("/:connectionId/respond", connectionController.respondToRequest);

/**
 * @swagger
 * /connections:
 *   get:
 *     summary: List all accepted connections for the authenticated player
 *     tags: [Connections]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of connected friends
 */
router.get("/", connectionController.getMyConnections);

/**
 * @swagger
 * /connections/pending:
 *   get:
 *     summary: List incoming connection requests awaiting response
 *     tags: [Connections]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Incoming requests
 */
router.get("/pending", connectionController.getPendingRequests);

/**
 * @swagger
 * /connections/sent:
 *   get:
 *     summary: List outgoing connection requests sent by user
 *     tags: [Connections]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Outgoing pending requests
 */
router.get("/sent", connectionController.getSentRequests);

/**
 * @swagger
 * /connections/{connectionId}:
 *   delete:
 *     summary: Remove a friend or cancel a sent request
 *     tags: [Connections]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: connectionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Connection removed
 *       404:
 *         description: Connection record not found
 */
router.delete("/:connectionId", connectionController.removeConnection);

/**
 * @swagger
 * /connections/status/{targetUserId}:
 *   get:
 *     summary: Check connection status with a user/player
 *     description: Returns whether the logged-in user is connected with the given user, or if a request is pending.
 *     tags: [Connections]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: targetUserId
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the target user
 *     responses:
 *       200:
 *         description: Connection status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 isConnected:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: string
 *                   enum: [connected, pending_sent, pending_received, none, self]
 *                   example: "connected"
 *                 connectionId:
 *                   type: string
 *                   nullable: true
 *                   example: "67226f332a488e5d9c25bb01"
 *                 connectedSince:
 *                   type: string
 *                   format: date-time
 *                   example: "2026-10-30T16:00:00.000Z"
 *       400:
 *         description: Invalid target user ID format
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get("/status/:targetUserId", connectionController.checkConnectionStatus);

module.exports = router;
