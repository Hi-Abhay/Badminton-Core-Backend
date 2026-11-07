const express = require("express");
const router = express.Router();
const matchController = require("../controllers/matchController");
const importedAuth = require("../middleware/authMiddleware");

// Safely resolve auth handler whether exported directly or as an object
const auth =
  typeof importedAuth === "function"
    ? importedAuth
    : importedAuth?.authMiddleware ||
      importedAuth?.protect ||
      importedAuth?.verifyToken ||
      importedAuth?.default;

// Runtime sanity checks
if (typeof auth !== "function") {
  throw new TypeError(
    `[matchRoutes] Expected authMiddleware to be a function, but received ${typeof importedAuth}. Check exports in src/middleware/authMiddleware.js`,
  );
}

const requiredHandlers = [
  "createMatch",
  "getMatchById",
  "respondToInvitation",
  "getUserMatches",
  "recordToss",
  "recordPoint",
  "undoPoint",
  "getLiveScore",
  "getUserStats",
  "getTeamStats", // <--- ADDED THIS HERE
  "getMutualConnectionsLiveMatches",
  "getMutualConnectionsUpcomingMatches",
  "deleteMatch", // <--- ADD THIS HERE
];

requiredHandlers.forEach((handler) => {
  if (typeof matchController[handler] !== "function") {
    throw new TypeError(
      `[matchRoutes] matchController.${handler} is not a function. Check exports in src/controllers/matchController.js`,
    );
  }
});

/**
 * @swagger
 * tags:
 *   name: Matches
 *   description: Match creation, invitation lifecycle, coin toss, scoring, mutual connections feeds, and statistics
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     CompetitorProfile:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: "64f1a2b3c4d5e6f7a8b9c0d1"
 *         fullName:
 *           type: string
 *           example: "Viktor Axelsen"
 *         avatar:
 *           type: string
 *           nullable: true
 *           example: "https://example.com/avatars/viktor.png"
 *         email:
 *           type: string
 *           example: "viktor@example.com"
 *
 *     SideCompetitor:
 *       type: object
 *       properties:
 *         primaryUser:
 *           $ref: '#/components/schemas/CompetitorProfile'
 *         partnerUser:
 *           $ref: '#/components/schemas/CompetitorProfile'
 *           nullable: true
 *         displayName:
 *           type: string
 *           example: "Viktor Axelsen"
 *
 *     MatchRules:
 *       type: object
 *       properties:
 *         bestOf:
 *           type: integer
 *           enum: [1, 3, 5]
 *           example: 3
 *         pointsPerGame:
 *           type: integer
 *           enum: [11, 15, 21]
 *           example: 21
 *         maxPointCap:
 *           type: integer
 *           example: 30
 *
 *     TossDetails:
 *       type: object
 *       properties:
 *         tossWinner:
 *           $ref: '#/components/schemas/CompetitorProfile'
 *           nullable: true
 *         winnerSide:
 *           type: string
 *           enum: [sideA, sideB]
 *           nullable: true
 *           example: "sideA"
 *         choice:
 *           type: string
 *           enum: [Serve, Receive, Side]
 *           nullable: true
 *           example: "Serve"
 *         isCompleted:
 *           type: boolean
 *           example: true
 *
 *     GameScore:
 *       type: object
 *       properties:
 *         gameNumber:
 *           type: integer
 *           example: 1
 *         sideAScore:
 *           type: integer
 *           example: 21
 *         sideBScore:
 *           type: integer
 *           example: 18
 *         winner:
 *           type: string
 *           enum: [sideA, sideB]
 *           nullable: true
 *           example: "sideA"
 *         isCompleted:
 *           type: boolean
 *           example: true
 *
 *     LiveState:
 *       type: object
 *       properties:
 *         currentGameNumber:
 *           type: integer
 *           example: 1
 *         gamesWonSideA:
 *           type: integer
 *           example: 1
 *         gamesWonSideB:
 *           type: integer
 *           example: 0
 *         currentServer:
 *           type: string
 *           enum: [sideA, sideB]
 *           example: "sideA"
 *         games:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/GameScore'
 *         matchWinner:
 *           type: string
 *           enum: [sideA, sideB]
 *           nullable: true
 *           example: null
 *
 *     Match:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: "650c8f1e9f1a2b3c4d5e6f7a"
 *         title:
 *           type: string
 *           example: "Club Championship Final"
 *         format:
 *           type: string
 *           enum: [SINGLES, DOUBLES]
 *           example: "SINGLES"
 *         createdBy:
 *           type: string
 *           example: "64f1a2b3c4d5e6f7a8b9c0d1"
 *         sideA:
 *           $ref: '#/components/schemas/SideCompetitor'
 *         sideB:
 *           $ref: '#/components/schemas/SideCompetitor'
 *         rules:
 *           $ref: '#/components/schemas/MatchRules'
 *         status:
 *           type: string
 *           enum: [INVITATION_PENDING, ACCEPTED, DECLINED, TOSS_READY, IN_PROGRESS, COMPLETED, CANCELLED]
 *           example: "INVITATION_PENDING"
 *         toss:
 *           $ref: '#/components/schemas/TossDetails'
 *         liveState:
 *           $ref: '#/components/schemas/LiveState'
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *
 *     CreateMatchInput:
 *       type: object
 *       required:
 *         - format
 *         - sideB
 *         - bestOf
 *         - pointsPerGame
 *       properties:
 *         title:
 *           type: string
 *           description: Optional title for match
 *           example: "Club Championship Final"
 *         format:
 *           type: string
 *           enum: [SINGLES, DOUBLES]
 *           default: "SINGLES"
 *           example: "SINGLES"
 *         sideA:
 *           type: object
 *           description: Creator side details (defaults to current user if omitted)
 *           properties:
 *             primaryUser:
 *               type: string
 *               example: "64f1a2b3c4d5e6f7a8b9c0d1"
 *             partnerUser:
 *               type: string
 *               nullable: true
 *               example: null
 *             displayName:
 *               type: string
 *               example: "Viktor Axelsen"
 *         sideB:
 *           type: object
 *           required:
 *             - primaryUser
 *             - displayName
 *           properties:
 *             primaryUser:
 *               type: string
 *               description: MongoDB ObjectId of challenged opponent
 *               example: "64f1a2b3c4d5e6f7a8b9c0d2"
 *             partnerUser:
 *               type: string
 *               nullable: true
 *               example: null
 *             displayName:
 *               type: string
 *               example: "Tai Tzu-ying"
 *         bestOf:
 *           type: integer
 *           enum: [1, 3, 5]
 *           example: 3
 *         pointsPerGame:
 *           type: integer
 *           enum: [11, 15, 21]
 *           example: 21
 *
 *     RespondMatchInput:
 *       type: object
 *       required:
 *         - action
 *       properties:
 *         action:
 *           type: string
 *           enum: [ACCEPT, DECLINE]
 *           example: "ACCEPT"
 *
 *     TossInput:
 *       type: object
 *       required:
 *         - winnerSide
 *         - choice
 *       properties:
 *         winnerSide:
 *           type: string
 *           enum: [sideA, sideB]
 *           example: "sideA"
 *         choice:
 *           type: string
 *           enum: [Serve, Receive, Side]
 *           example: "Serve"
 *
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         message:
 *           type: string
 *           example: "Invalid match request parameters."
 */

// ==========================================
// 1. SPECIFIC STATIC ROUTES
// ==========================================

/**
 * @swagger
 * /matches:
 *   post:
 *     summary: Create a match & challenge opponent (Proceed to Toss)
 *     description: Creates match in INVITATION_PENDING status and dispatches challenge to Side B.
 *     tags: [Matches]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateMatchInput'
 *     responses:
 *       201:
 *         description: Match successfully created.
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
 *                   example: "Match created and request dispatched to opponent."
 *                 match:
 *                   $ref: '#/components/schemas/Match'
 *       400:
 *         description: Invalid input or attempting self-challenge.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized.
 *       500:
 *         description: Server error.
 */
router.post("/", auth, matchController.createMatch);

/**
 * @swagger
 * /matches/my-matches:
 *   get:
 *     summary: Get all matches for the logged-in user
 *     description: Returns matches where user participates as primary player or partner.
 *     tags: [Matches]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [SINGLES, DOUBLES]
 *         description: Filter by format
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [INVITATION_PENDING, ACCEPTED, DECLINED, TOSS_READY, IN_PROGRESS, COMPLETED, CANCELLED]
 *         description: Filter by match status
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
 *           default: 10
 *         description: Matches per page
 *     responses:
 *       200:
 *         description: List of user matches.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                       example: 12
 *                     page:
 *                       type: integer
 *                       example: 1
 *                     limit:
 *                       type: integer
 *                       example: 10
 *                     totalPages:
 *                       type: integer
 *                       example: 2
 *                 matches:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Match'
 *       401:
 *         description: Unauthorized.
 *       500:
 *         description: Server error.
 */
router.get("/my-matches", auth, matchController.getUserMatches);

/**
 * @swagger
 * /matches/my-stats:
 *   get:
 *     summary: Get match statistics for the authenticated user (via token)
 *     description: Returns overall total matches, wins, losses, win rate, and singles/doubles breakdown for the logged-in user.
 *     tags: [Matches]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user statistics retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 player:
 *                   $ref: '#/components/schemas/CompetitorProfile'
 *                 stats:
 *                   type: object
 *                   properties:
 *                     totalMatches:
 *                       type: integer
 *                       example: 18
 *                     completedMatches:
 *                       type: integer
 *                       example: 15
 *                     totalWon:
 *                       type: integer
 *                       example: 11
 *                     totalLost:
 *                       type: integer
 *                       example: 4
 *                     winRate:
 *                       type: string
 *                       example: "73%"
 *       401:
 *         description: Unauthorized.
 */
router.get("/my-stats", auth, matchController.getUserStats);

/**
 * @swagger
 * /matches/mutual-live:
 *   get:
 *     summary: Get live matches where you are mutually connected to both sides
 *     description: Returns only IN_PROGRESS matches where the caller has accepted connections with at least one player on Side A AND at least one player on Side B.
 *     tags: [Matches]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of mutual live matches.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: integer
 *                   example: 1
 *                 matches:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Match'
 *       401:
 *         description: Unauthorized.
 *       500:
 *         description: Server error.
 */
router.get(
  "/mutual-live",
  auth,
  matchController.getMutualConnectionsLiveMatches,
);

/**
 * @swagger
 * /matches/mutual-upcoming:
 *   get:
 *     summary: Get upcoming matches between mutual connections
 *     description: Returns matches in INVITATION_PENDING, ACCEPTED, or TOSS_READY status where caller is connected to at least one player on Side A AND at least one player on Side B.
 *     tags: [Matches]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of mutual upcoming matches.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: integer
 *                   example: 2
 *                 matches:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Match'
 *       401:
 *         description: Unauthorized.
 *       500:
 *         description: Server error.
 */
router.get(
  "/mutual-upcoming",
  auth,
  matchController.getMutualConnectionsUpcomingMatches,
);

// ==========================================
// 2. PARAMETERIZED USER SPECIFIC ROUTES
// ==========================================

/**
 * @swagger
 * /matches/user/{userId}:
 *   get:
 *     summary: Get all matches for a specific player by User ID
 *     description: Returns paginated matches where the specified player competed (Singles or Doubles, Side A or Side B).
 *     tags: [Matches]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the target player
 *         example: "64f1a2b3c4d5e6f7a8b9c0d2"
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [SINGLES, DOUBLES]
 *         description: Filter by match format
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [INVITATION_PENDING, ACCEPTED, DECLINED, TOSS_READY, IN_PROGRESS, COMPLETED, CANCELLED]
 *         description: Filter by match status
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of matches per page
 *     responses:
 *       200:
 *         description: List of player matches returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                       example: 14
 *                     page:
 *                       type: integer
 *                       example: 1
 *                     limit:
 *                       type: integer
 *                       example: 10
 *                     totalPages:
 *                       type: integer
 *                       example: 2
 *                 matches:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Match'
 *       400:
 *         description: Invalid User ID format.
 *       401:
 *         description: Unauthorized.
 *       500:
 *         description: Internal server error.
 */
router.get("/user/:userId", auth, matchController.getUserMatches);

/**
 * @swagger
 * /matches/stats/{userId}:
 *   get:
 *     summary: Get public match statistics for any player by User ID
 *     description: Returns overall matches, wins, losses, win rate, and game breakdowns for any target player.
 *     tags: [Matches]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of target player
 *         example: "6ad90b433a2f23cd67c33aba"
 *     responses:
 *       200:
 *         description: Player statistics retrieved successfully.
 *       400:
 *         description: Invalid User ID format.
 *       404:
 *         description: Player profile not found.
 */
router.get("/stats/:userId", auth, matchController.getUserStats);

/**
 * @swagger
 * /matches/team-stats/{teamId}:
 *   get:
 *     summary: Get public match statistics for a specific team by Team ID
 *     description: Returns overall matches, wins, losses, and win rate for any target team.
 *     tags: [Matches]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of target team
 *         example: "6ad90b433a2f23cd67c33abc"
 *     responses:
 *       200:
 *         description: Team statistics retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 stats:
 *                   type: object
 *                   properties:
 *                     totalMatches:
 *                       type: integer
 *                       example: 10
 *                     completedMatches:
 *                       type: integer
 *                       example: 8
 *                     totalWon:
 *                       type: integer
 *                       example: 5
 *                     totalLost:
 *                       type: integer
 *                       example: 3
 *                     winRate:
 *                       type: string
 *                       example: "63%"
 *       400:
 *         description: Invalid Team ID format.
 *       500:
 *         description: Internal server error.
 */
router.get("/team-stats/:teamId", auth, matchController.getTeamStats); // <--- ADDED THIS HERE

// ==========================================
// 3. MATCH-SPECIFIC SUB-RESOURCE ROUTES
// ==========================================

/**
 * @swagger
 * /matches/{id}/respond:
 *   patch:
 *     summary: Respond to match challenge (Accept / Decline)
 *     description: Called by invited opponent (Side B) to accept or decline the challenge.
 *     tags: [Matches]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Match MongoDB ObjectId
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RespondMatchInput'
 *     responses:
 *       200:
 *         description: Match invitation response processed.
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
 *                   example: "Match challenge accepted. Proceeding to Toss."
 *                 match:
 *                   $ref: '#/components/schemas/Match'
 *       400:
 *         description: Invalid action or invitation is no longer pending.
 *       403:
 *         description: Forbidden. Caller is not Side B.
 *       404:
 *         description: Match not found.
 */
router.patch("/:id/respond", auth, matchController.respondToInvitation);

/**
 * @swagger
 * /matches/{id}/toss:
 *   post:
 *     summary: Record coin toss result & initialize live scoring
 *     description: Saves toss outcome, sets first server, transitions status to IN_PROGRESS, and initializes Game 1.
 *     tags: [Matches]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Match MongoDB ObjectId
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TossInput'
 *     responses:
 *       200:
 *         description: Toss successfully recorded and live match initialized.
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
 *                   example: "Toss completed successfully. Match is now IN_PROGRESS!"
 *                 match:
 *                   $ref: '#/components/schemas/Match'
 *       400:
 *         description: Invalid parameters or toss already finalized.
 *       403:
 *         description: Unauthorized. Caller is not playing in this match.
 *       404:
 *         description: Match not found.
 */
router.post("/:id/toss", auth, matchController.recordToss);

/**
 * @swagger
 * /matches/{id}/live:
 *   get:
 *     summary: Fetch current live scoreboard state
 *     description: Returns sets, active server, point totals, and participants. Accessible by participants and mutual connections.
 *     tags: [Matches]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Match MongoDB ObjectId
 *     responses:
 *       200:
 *         description: Live scoring state retrieved successfully.
 *       400:
 *         description: Invalid match ID format.
 *       403:
 *         description: Access restricted. Must be a participant or mutually connected to both sides.
 *       404:
 *         description: Match not found.
 */
router.get("/:id/live", auth, matchController.getLiveScore);

/**
 * @swagger
 * /matches/{id}/live/point:
 *   post:
 *     summary: Record a point for Side A or Side B
 *     description: Increments score, switches server, evaluates deuce/set/match winners, and updates history.
 *     tags: [Matches]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Match MongoDB ObjectId
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - side
 *             properties:
 *               side:
 *                 type: string
 *                 enum: [sideA, sideB]
 *                 example: "sideA"
 *     responses:
 *       200:
 *         description: Point recorded successfully.
 *       400:
 *         description: Invalid side or match not in progress.
 *       403:
 *         description: Caller is not a participant in this match.
 *       404:
 *         description: Match not found.
 */
router.post("/:id/live/point", auth, matchController.recordPoint);

/**
 * @swagger
 * /matches/{id}/live/undo:
 *   post:
 *     summary: Undo last recorded point
 *     description: Reverts latest score change, restores previous server, and reopens sets/match if previously completed.
 *     tags: [Matches]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Match MongoDB ObjectId
 *     responses:
 *       200:
 *         description: Last point successfully undone.
 *       400:
 *         description: No points available to undo.
 *       403:
 *         description: Caller is not a participant.
 *       404:
 *         description: Match not found.
 */
router.post("/:id/live/undo", auth, matchController.undoPoint);

// ==========================================
// 4. GENERIC MATCH ID ROUTE (MUST REMAIN LAST)
// ==========================================

/**
 * @swagger
 * /matches/{id}:
 *   get:
 *     summary: Fetch match details by ID
 *     description: Retrieve match data, rules, participants, toss, and current score state.
 *     tags: [Matches]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Match MongoDB ObjectId
 *     responses:
 *       200:
 *         description: Match retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 match:
 *                   $ref: '#/components/schemas/Match'
 *       400:
 *         description: Invalid ObjectId format.
 *       401:
 *         description: Unauthorized.
 *       404:
 *         description: Match not found.
 */
router.get("/:id", auth, matchController.getMatchById);

/**
 * @swagger
 * /matches/{id}:
 *   delete:
 *     summary: Delete or dismiss a match
 *     description: Permanently deletes a match. Only the user who created the match (createdBy) is authorized to delete it.
 *     tags: [Matches]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Match MongoDB ObjectId
 *     responses:
 *       200:
 *         description: Match deleted successfully.
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
 *                   example: "Match deleted successfully."
 *       400:
 *         description: Invalid match ID format.
 *       403:
 *         description: Unauthorized. Only the match creator can delete.
 *       404:
 *         description: Match not found.
 *       500:
 *         description: Server error.
 */
router.delete("/:id", auth, matchController.deleteMatch);

module.exports = router;
