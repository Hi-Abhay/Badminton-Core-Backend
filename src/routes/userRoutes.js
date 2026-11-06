const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const { protect } = require("../middleware/authMiddleware");

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: User authentication and discovery
 */

/**
 * @swagger
 * /users/register:
 *   post:
 *     summary: Register a new player
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, email, password]
 *             properties:
 *               fullName:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               profile_image:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [single, double]
 *               fcmToken:
 *                 type: string
 *     responses:
 *       201:
 *         description: Registered successfully
 */
router.post("/register", userController.registerUser);

/**
 * @swagger
 * /users/login:
 *   post:
 *     summary: Login player and return JWT token
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               profile_image:
 *                 type: string
 *               fcmToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 */
router.post("/login", userController.loginUser);

/**
 * @swagger
 * /users/loginByEmail:
 *   post:
 *     summary: Login or auto-register via Email (Social Login style)
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *               profile_image:
 *                 type: string
 *                 description: Will update the user's image if provided
 *               fullName:
 *                 type: string
 *               fcmToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 */
router.post("/loginByEmail", userController.loginByEmail);

/**
 * @swagger
 * /users/profile:
 *   get:
 *     summary: Get profile of the logged-in player
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Player profile data
 *       401:
 *         description: Unauthorized
 */
router.get("/profile", protect, userController.getUserProfile);

/**
 * @swagger
 * /users/allPlayer:
 *   get:
 *     summary: Get paginated list of all players (keyset cursor pagination)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search players by full name (case-insensitive)
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: User ID cursor for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Maximum number of records to return (1-50)
 *     responses:
 *       200:
 *         description: List of players
 *       401:
 *         description: Unauthorized
 */
router.get("/allPlayer", protect, userController.getAllPlayers);

module.exports = router;