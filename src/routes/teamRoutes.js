const express = require("express");
const router = express.Router();
const teamController = require("../controllers/teamController");
const { protect } = require("../middleware/authMiddleware");

router.use(protect);

/**
 * @swagger
 * tags:
 *   name: Teams
 *   description: Team management (Club & Doubles)
 */

/**
 * @swagger
 * /teams:
 *   post:
 *     summary: Create a team (Max 2 teams per player)
 *     tags: [Teams]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [teamName, teamType]
 *             properties:
 *               teamName:
 *                 type: string
 *               teamType:
 *                 type: string
 *                 enum: [Club, double]
 *               player2:
 *                 type: string
 *                 nullable: true
 *               teamCode:
 *                 type: string
 *     responses:
 *       201:
 *         description: Team created
 */
router.post("/", teamController.createTeam);

/**
 * @swagger
 * /teams/my-teams:
 *   get:
 *     summary: Get all teams for the logged-in user
 *     tags: [Teams]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of the user's teams (including pending invites)
 */
router.get("/my-teams", teamController.getMyTeams); // <--- ADDED HERE ABOVE /:id

/**
 * @swagger
 * /teams:
 *   get:
 *     summary: Get all teams
 *     tags: [Teams]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: teamType
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of teams
 */
router.get("/", teamController.getAllTeams);

/**
 * @swagger
 * /teams/{id}:
 *   get:
 *     summary: Get team details by ID
 *     tags: [Teams]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Team data
 */
router.get("/:id", teamController.getTeamById);

/**
 * @swagger
 * /teams/{id}:
 *   patch:
 *     summary: Update team details (Creator only)
 *     tags: [Teams]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               teamName:
 *                 type: string
 *               teamType:
 *                 type: string
 *                 enum: [Club, double]
 *               player2:
 *                 type: string
 *     responses:
 *       200:
 *         description: Team updated
 */
router.patch("/:id", teamController.updateTeam);

/**
 * @swagger
 * /teams/{id}/respond:
 *   patch:
 *     summary: Accept or Decline a team invitation (Invited Player 2 only)
 *     tags: [Teams]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
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
 *                 enum: [ACCEPT, DECLINE]
 *     responses:
 *       200:
 *         description: Invitation processed successfully
 */
router.patch("/:id/respond", teamController.respondToInvite);

/**
 * @swagger
 * /teams/{id}/leave:
 *   post:
 *     summary: Leave a team (Player 1 or Player 2)
 *     tags: [Teams]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successfully left the team
 */
router.post("/:id/leave", teamController.leaveTeam);

/**
 * @swagger
 * /teams/{id}:
 *   delete:
 *     summary: Delete team by ID (Creator only)
 *     tags: [Teams]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Team deleted
 */
router.delete("/:id", teamController.deleteTeam);

module.exports = router;
