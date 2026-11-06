// src/controllers/matchController.js
const mongoose = require("mongoose");
const Match = require("../models/matchModel");
const User = require("../models/userModel");
const Connection = require("../models/connectionModel");
const { sendNotificationToUsers } = require("../services/notificationService");
const { emitMatchUpdate, emitToUser } = require("../config/socket");

/**
 * Helper: Safely validate MongoDB ObjectIDs
 */
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

/**
 * Helper: Extract strict primitive string ID to prevent Set.has() mismatch
 */
const getCleanId = (user) => {
  if (!user) return null;
  const idStr = user._id ? user._id.toString() : user.toString();
  return idStr.trim();
};

/**
 * Helper: Fetch all accepted connection IDs for a user as a Set of strings
 */
const getAcceptedFriendIds = async (userId) => {
  const connections = await Connection.find({
    $or: [{ requester: userId }, { recipient: userId }],
    status: "accepted",
  }).select("requester recipient");

  return new Set(
    connections.map((c) =>
      c.requester.toString() === userId.toString()
        ? c.recipient.toString()
        : c.requester.toString(),
    ),
  );
};

/**
 * Helper: Categorize friends into Mutual, Side A only, Side B only
 * (Excludes the match participants)
 */
const getCategorizedConnections = async (sideAStrs, sideBStrs) => {
  const sideASet = new Set(sideAStrs);
  const sideBSet = new Set(sideBStrs);
  const allParticipants = new Set([...sideAStrs, ...sideBStrs]);

  const [connsA, connsB] = await Promise.all([
    Connection.find({
      status: "accepted",
      $or: [
        { requester: { $in: sideAStrs } },
        { recipient: { $in: sideAStrs } },
      ],
    }).select("requester recipient"),
    Connection.find({
      status: "accepted",
      $or: [
        { requester: { $in: sideBStrs } },
        { recipient: { $in: sideBStrs } },
      ],
    }).select("requester recipient"),
  ]);

  const friendsOfA = new Set();
  connsA.forEach((c) => {
    const req = c.requester.toString();
    const rec = c.recipient.toString();
    const friendId = sideASet.has(req) ? rec : req;

    if (!allParticipants.has(friendId)) friendsOfA.add(friendId);
  });

  const friendsOfB = new Set();
  connsB.forEach((c) => {
    const req = c.requester.toString();
    const rec = c.recipient.toString();
    const friendId = sideBSet.has(req) ? rec : req;

    if (!allParticipants.has(friendId)) friendsOfB.add(friendId);
  });

  const mutualFriends = [];
  const onlyAFriends = [];
  const onlyBFriends = [];

  friendsOfA.forEach((id) => {
    if (friendsOfB.has(id)) {
      mutualFriends.push(id);
    } else {
      onlyAFriends.push(id);
    }
  });

  friendsOfB.forEach((id) => {
    if (!friendsOfA.has(id)) {
      onlyBFriends.push(id);
    }
  });

  return { mutualFriends, onlyAFriends, onlyBFriends };
};

/**
 * Helper: Broadcast personalized notifications via FCM
 */
const broadcastMatchEvent = async ({
  sideAPlayerIds,
  sideBPlayerIds,
  title,
  mutualMsg,
  sideAMsg,
  sideBMsg,
  dataPayload,
}) => {
  try {
    const cleanA = sideAPlayerIds.map(getCleanId).filter(Boolean);
    const cleanB = sideBPlayerIds.map(getCleanId).filter(Boolean);
    const excludedParticipants = [...cleanA, ...cleanB];

    const { mutualFriends, onlyAFriends, onlyBFriends } =
      await getCategorizedConnections(cleanA, cleanB);

    const filterExcluded = (friendsArray) => {
      return friendsArray.filter(
        (friendId) => !excludedParticipants.includes(friendId.toString()),
      );
    };

    const finalMutual = filterExcluded(mutualFriends);
    const finalOnlyA = filterExcluded(onlyAFriends);
    const finalOnlyB = filterExcluded(onlyBFriends);

    const tasks = [];

    if (finalMutual.length > 0) {
      tasks.push(
        sendNotificationToUsers(finalMutual, title, mutualMsg, dataPayload),
      );
    }

    if (finalOnlyA.length > 0) {
      tasks.push(
        sendNotificationToUsers(finalOnlyA, title, sideAMsg, dataPayload),
      );
    }

    if (finalOnlyB.length > 0) {
      tasks.push(
        sendNotificationToUsers(finalOnlyB, title, sideBMsg, dataPayload),
      );
    }

    await Promise.allSettled(tasks);
  } catch (err) {
    console.error("Match event broadcast failed:", err);
  }
};

/**
 * Helper: Check if a game/set is won under badminton rules
 */
const checkGameWinner = (sideAScore, sideBScore, targetPoints, maxCap = 30) => {
  if (sideAScore >= maxCap) return "sideA";
  if (sideBScore >= maxCap) return "sideB";
  if (sideAScore >= targetPoints && sideAScore - sideBScore >= 2)
    return "sideA";
  if (sideBScore >= targetPoints && sideBScore - sideAScore >= 2)
    return "sideB";
  return null;
};

/**
 * Create Match & Send Challenge to Opponent + Notify Both Circles
 * POST /matches
 */
exports.createMatch = async (req, res) => {
  try {
    const creatorId = req.user?._id || req.user?.id;
    if (!creatorId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. User not identified.",
      });
    }

    const {
      title,
      format = "SINGLES",
      sideA,
      sideB,
      bestOf,
      pointsPerGame,
    } = req.body;

    if (!sideB?.primaryUser || !sideB?.displayName) {
      return res.status(400).json({
        success: false,
        message:
          "Opponent (Side B) details (primaryUser ID and displayName) are required.",
      });
    }

    if (!isValidObjectId(sideB.primaryUser)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Opponent user ID format.",
      });
    }

    if (creatorId.toString() === sideB.primaryUser.toString()) {
      return res.status(400).json({
        success: false,
        message: "You cannot initiate a match challenge against yourself.",
      });
    }

    const parsedBestOf = Number(bestOf);
    if (![1, 3, 5].includes(parsedBestOf)) {
      return res.status(400).json({
        success: false,
        message: "Invalid bestOf value. Must be 1, 3, or 5.",
      });
    }

    const parsedPoints = Number(pointsPerGame);
    if (![11, 15, 21].includes(parsedPoints)) {
      return res.status(400).json({
        success: false,
        message: "Invalid pointsPerGame. Must be 11, 15, or 21.",
      });
    }

    const creatorName =
      req.user?.fullName || req.user?.name || sideA?.displayName || "A player";
    const sideBName = sideB.displayName;

    const match = await Match.create({
      title:
        title?.trim() ||
        (format === "SINGLES" ? "Singles Match" : "Doubles Match"),
      format,
      createdBy: creatorId,
      sideA: {
        primaryUser: sideA?.primaryUser || creatorId,
        partnerUser: sideA?.partnerUser || null,
        displayName: sideA?.displayName || creatorName,
      },
      sideB: {
        primaryUser: sideB.primaryUser,
        partnerUser: sideB.partnerUser || null,
        displayName: sideBName,
      },
      rules: {
        bestOf: parsedBestOf,
        pointsPerGame: parsedPoints,
        maxPointCap: 30,
      },
      status: "INVITATION_PENDING",
    });

    const populatedMatch = await Match.findById(match._id)
      .populate("sideA.primaryUser", "fullName name avatar email profile_image")
      .populate("sideA.partnerUser", "fullName name avatar email profile_image")
      .populate("sideB.primaryUser", "fullName name avatar email profile_image")
      .populate("sideB.partnerUser", "fullName name avatar email profile_image")
      .populate("createdBy", "fullName name avatar email profile_image");

    const opponentIds = [sideB.primaryUser, sideB.partnerUser].filter(Boolean);

    opponentIds.forEach((oppId) => {
      emitToUser(oppId, "match:challenge_received", {
        message: `${creatorName} challenged you to a match!`,
        match: populatedMatch,
      });
    });

    emitMatchUpdate(match._id, { status: match.status });

    sendNotificationToUsers(
      opponentIds,
      "🏸 New Match Challenge!",
      `${creatorName} challenged you to a ${format.toLowerCase()} match. Tap to respond!`,
      {
        type: "MATCH_CHALLENGE",
        matchId: match._id.toString(),
      },
    ).catch((err) => console.error("Challenge notification error:", err));

    const sideAPlayerIds = [creatorId, sideA?.partnerUser].filter(Boolean);
    const sideBPlayerIds = [sideB.primaryUser, sideB.partnerUser].filter(
      Boolean,
    );

    broadcastMatchEvent({
      sideAPlayerIds,
      sideBPlayerIds,
      title: "New Match Created!",
      mutualMsg: `Your friends ${creatorName} and ${sideBName} scheduled a badminton match!`,
      sideAMsg: `Your friend ${creatorName} scheduled a match against ${sideBName}!`,
      sideBMsg: `Your friend ${sideBName} was challenged to a match by ${creatorName}!`,
      dataPayload: {
        type: "MATCH_CREATED",
        matchId: match._id.toString(),
      },
    });

    return res.status(201).json({
      success: true,
      message: "Match created and challenge dispatched.",
      match: populatedMatch,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to create match.",
      error: error.message,
    });
  }
};

/**
 * Fetch Match Details by ID
 * GET /matches/:id
 */
exports.getMatchById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid match ID format.",
      });
    }

    const match = await Match.findById(id)
      .populate("sideA.primaryUser", "fullName name avatar email profile_image")
      .populate("sideA.partnerUser", "fullName name avatar email profile_image")
      .populate("sideB.primaryUser", "fullName name avatar email profile_image")
      .populate("sideB.partnerUser", "fullName name avatar email profile_image")
      .populate("createdBy", "fullName name avatar email profile_image")
      .populate("toss.tossWinner", "fullName name avatar email profile_image");

    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Match not found.",
      });
    }

    return res.status(200).json({
      success: true,
      match,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error fetching match details.",
      error: error.message,
    });
  }
};

/**
 * Opponent Accepts or Declines Match Request
 * PATCH /matches/:id/respond
 */
exports.respondToInvitation = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { id } = req.params;
    const { action } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid match ID format.",
      });
    }

    if (!["ACCEPT", "DECLINE"].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Expected "ACCEPT" or "DECLINE".',
      });
    }

    const match = await Match.findById(id);
    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Match not found.",
      });
    }

    // FIX: Verify either primary or partner of Side B is responding
    const sideBPlayers = [
      match.sideB.primaryUser?.toString(),
      match.sideB.partnerUser?.toString(),
    ].filter(Boolean);

    if (!sideBPlayers.includes(userId.toString())) {
      return res.status(403).json({
        success: false,
        message:
          "Only the invited opponent team can accept or decline this match.",
      });
    }

    if (match.status !== "INVITATION_PENDING") {
      return res.status(400).json({
        success: false,
        message: `Invitation is no longer pending (current status: ${match.status}).`,
      });
    }

    match.status = action === "ACCEPT" ? "TOSS_READY" : "DECLINED";
    await match.save();

    const updatedMatch = await Match.findById(match._id)
      .populate("sideA.primaryUser", "fullName name avatar email profile_image")
      .populate("sideA.partnerUser", "fullName name avatar email profile_image")
      .populate("sideB.primaryUser", "fullName name avatar email profile_image")
      .populate("sideB.partnerUser", "fullName name avatar email profile_image")
      .populate("createdBy", "fullName name avatar email profile_image");

    const responderName =
      req.user?.fullName ||
      req.user?.name ||
      match.sideB.displayName ||
      "Opponent";
    const creatorId = match.createdBy.toString();

    emitToUser(creatorId, "match:invitation_responded", {
      matchId: match._id.toString(),
      action,
      status: match.status,
      responderName,
      match: updatedMatch,
    });

    emitMatchUpdate(match._id, {
      status: match.status,
      action: "invitation_responded",
    });

    if (action === "ACCEPT") {
      sendNotificationToUsers(
        [creatorId],
        "Challenge Accepted!",
        `${responderName} accepted your challenge! Match is ready for Toss.`,
        { type: "CHALLENGE_ACCEPTED", matchId: match._id.toString() },
      ).catch((err) => console.error("Response push error:", err));

      const sideAPlayerIds = [
        match.sideA.primaryUser,
        match.sideA.partnerUser,
      ].filter(Boolean);
      const sideBPlayerIds = [
        match.sideB.primaryUser,
        match.sideB.partnerUser,
      ].filter(Boolean);

      broadcastMatchEvent({
        sideAPlayerIds,
        sideBPlayerIds,
        title: "Match Confirmed!",
        mutualMsg: `Your friends ${match.sideA.displayName} and ${match.sideB.displayName} confirmed their match! Ready for Toss.`,
        sideAMsg: `Your friend ${match.sideA.displayName}'s challenge against ${match.sideB.displayName} was accepted!`,
        sideBMsg: `Your friend ${match.sideB.displayName} accepted the challenge from ${match.sideA.displayName}!`,
        dataPayload: {
          type: "MATCH_CONFIRMED",
          matchId: match._id.toString(),
        },
      });
    } else {
      sendNotificationToUsers(
        [creatorId],
        "Challenge Declined",
        `${responderName} declined your match challenge.`,
        { type: "CHALLENGE_DECLINED", matchId: match._id.toString() },
      ).catch((err) => console.error("Response push error:", err));
    }

    return res.status(200).json({
      success: true,
      message:
        action === "ACCEPT"
          ? "Match challenge accepted. Proceeding to Toss."
          : "Match challenge declined.",
      match: updatedMatch,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to process match response.",
      error: error.message,
    });
  }
};

/**
 * Record Coin Toss Outcome & Notify Opponents + All Mutual Connections
 * POST /matches/:id/toss
 */
exports.recordToss = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { id } = req.params;
    const { winnerSide, choice } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid match ID format.",
      });
    }

    if (!["sideA", "sideB"].includes(winnerSide)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid winnerSide. Must be "sideA" or "sideB".',
      });
    }

    if (!["Serve", "Receive", "Side"].includes(choice)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid choice. Must be "Serve", "Receive", or "Side".',
      });
    }

    const match = await Match.findById(id);
    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Match not found.",
      });
    }

    // FIX: Verify user is ANY player on the team, not just primary
    const allowedPlayers = [
      match.sideA?.primaryUser?.toString(),
      match.sideA?.partnerUser?.toString(),
      match.sideB?.primaryUser?.toString(),
      match.sideB?.partnerUser?.toString(),
    ].filter(Boolean);

    if (!allowedPlayers.includes(userId.toString())) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized. You are not a player in this match.",
      });
    }

    if (match.toss?.isCompleted || match.status === "IN_PROGRESS") {
      return res.status(400).json({
        success: false,
        message: "Toss has already been completed for this match.",
      });
    }

    let initialServer = "sideA";
    if (winnerSide === "sideA") {
      initialServer = choice === "Receive" ? "sideB" : "sideA";
    } else {
      initialServer = choice === "Serve" ? "sideB" : "sideA";
    }

    // Using primaryUser to save the team record of who won the toss
    const winnerUserId =
      winnerSide === "sideA"
        ? match.sideA.primaryUser
        : match.sideB.primaryUser;

    const tossWinnerName =
      winnerSide === "sideA"
        ? match.sideA.displayName
        : match.sideB.displayName;

    const tossLoserName =
      winnerSide === "sideA"
        ? match.sideB.displayName
        : match.sideA.displayName;

    match.toss = {
      tossWinner: winnerUserId,
      winnerSide,
      choice,
      isCompleted: true,
    };

    match.status = "IN_PROGRESS";
    match.liveState = {
      currentGameNumber: 1,
      gamesWonSideA: 0,
      gamesWonSideB: 0,
      currentServer: initialServer,
      games: [
        {
          gameNumber: 1,
          sideAScore: 0,
          sideBScore: 0,
          winner: null,
          isCompleted: false,
        },
      ],
      history: [],
      matchWinner: null,
    };

    await match.save();

    const updatedMatch = await Match.findById(match._id)
      .populate("sideA.primaryUser", "fullName name avatar email profile_image")
      .populate("sideA.partnerUser", "fullName name avatar email profile_image")
      .populate("sideB.primaryUser", "fullName name avatar email profile_image")
      .populate("sideB.partnerUser", "fullName name avatar email profile_image")
      .populate("toss.tossWinner", "fullName name avatar email profile_image");

    emitMatchUpdate(match._id, {
      type: "TOSS_COMPLETED",
      toss: match.toss,
      status: match.status,
      liveState: match.liveState,
      tossWinnerName,
    });

    const sideAPlayerIds = [match.sideA.primaryUser, match.sideA.partnerUser]
      .map(getCleanId)
      .filter(Boolean);
    const sideBPlayerIds = [match.sideB.primaryUser, match.sideB.partnerUser]
      .map(getCleanId)
      .filter(Boolean);
    const allParticipants = [...sideAPlayerIds, ...sideBPlayerIds];

    const otherPlayers = allParticipants.filter(
      (pId) => pId !== userId.toString(),
    );
    if (otherPlayers.length > 0) {
      sendNotificationToUsers(
        otherPlayers,
        "Toss Result Announced!",
        `${tossWinnerName} won the toss and chose to ${choice}. Match is starting now!`,
        {
          type: "TOSS_COMPLETED",
          matchId: match._id.toString(),
          winner: tossWinnerName,
          winnerSide,
          choice,
        },
      ).catch((err) => console.error("Player toss alert error:", err));
    }

    broadcastMatchEvent({
      sideAPlayerIds,
      sideBPlayerIds,
      title: "Toss Completed — Match LIVE!",
      mutualMsg: `Toss was completed! ${tossWinnerName} won the toss against ${tossLoserName} and chose to ${choice}. Watch live now!`,
      sideAMsg:
        winnerSide === "sideA"
          ? `Toss completed! Your friend ${tossWinnerName} won the toss against ${tossLoserName} and chose to ${choice}. Match is LIVE!`
          : `Toss completed! ${tossWinnerName} won the toss against your friend ${tossLoserName}. Match is LIVE!`,
      sideBMsg:
        winnerSide === "sideB"
          ? `Toss completed! Your friend ${tossWinnerName} won the toss against ${tossLoserName} and chose to ${choice}. Match is LIVE!`
          : `Toss completed! ${tossWinnerName} won the toss against your friend ${tossLoserName}. Match is LIVE!`,
      dataPayload: {
        type: "TOSS_COMPLETED",
        matchId: match._id.toString(),
        winner: tossWinnerName,
        choice,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Toss completed successfully. Match is now IN_PROGRESS!",
      match: updatedMatch,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to record toss.",
      error: error.message,
    });
  }
};

/**
 * Record Point & Notify Players & Mutual Connections on Game / Match Victory
 * POST /matches/:id/live/point
 */
exports.recordPoint = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { id } = req.params;
    const { side } = req.body;

    if (!isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid match ID format." });
    }

    if (!["sideA", "sideB"].includes(side)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid side. Must be "sideA" or "sideB".',
      });
    }

    const match = await Match.findById(id);
    if (!match) {
      return res
        .status(404)
        .json({ success: false, message: "Match not found." });
    }

    // FIX: Verify user is ANY player on the team, not just primary
    const allowedPlayers = [
      match.sideA?.primaryUser?.toString(),
      match.sideA?.partnerUser?.toString(),
      match.sideB?.primaryUser?.toString(),
      match.sideB?.partnerUser?.toString(),
    ].filter(Boolean);

    if (!allowedPlayers.includes(userId.toString())) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized. You are not a player in this match.",
      });
    }

    if (match.status !== "IN_PROGRESS") {
      return res.status(400).json({
        success: false,
        message: `Cannot score. Match status is currently ${match.status}.`,
      });
    }

    const live = match.liveState;
    const targetPoints = match.rules?.pointsPerGame || 21;
    const maxCap = match.rules?.maxPointCap || 30;
    const gamesToWinMatch = Math.ceil((match.rules?.bestOf || 3) / 2);

    let currentGame = live.games.find(
      (g) => g.gameNumber === live.currentGameNumber,
    );
    if (!currentGame) {
      currentGame = {
        gameNumber: live.currentGameNumber,
        sideAScore: 0,
        sideBScore: 0,
        winner: null,
        isCompleted: false,
      };
      live.games.push(currentGame);
    }

    if (side === "sideA") currentGame.sideAScore += 1;
    if (side === "sideB") currentGame.sideBScore += 1;

    live.currentServer = side;

    live.history.push({
      gameNumber: live.currentGameNumber,
      scoredBy: side,
      sideAScore: currentGame.sideAScore,
      sideBScore: currentGame.sideBScore,
      servingSide: side,
      timestamp: new Date(),
    });

    const gameWinner = checkGameWinner(
      currentGame.sideAScore,
      currentGame.sideBScore,
      targetPoints,
      maxCap,
    );

    let matchCompleted = false;
    let gameWon = false;
    let winnerDisplayName = "";
    let loserDisplayName = "";

    if (gameWinner) {
      gameWon = true;
      currentGame.winner = gameWinner;
      currentGame.isCompleted = true;
      winnerDisplayName =
        gameWinner === "sideA"
          ? match.sideA.displayName
          : match.sideB.displayName;
      loserDisplayName =
        gameWinner === "sideA"
          ? match.sideB.displayName
          : match.sideA.displayName;

      if (gameWinner === "sideA") live.gamesWonSideA += 1;
      if (gameWinner === "sideB") live.gamesWonSideB += 1;

      if (live.gamesWonSideA === gamesToWinMatch) {
        live.matchWinner = "sideA";
        match.status = "COMPLETED";
        matchCompleted = true;
      } else if (live.gamesWonSideB === gamesToWinMatch) {
        live.matchWinner = "sideB";
        match.status = "COMPLETED";
        matchCompleted = true;
      } else {
        live.currentGameNumber += 1;
        live.currentServer = gameWinner;
        live.games.push({
          gameNumber: live.currentGameNumber,
          sideAScore: 0,
          sideBScore: 0,
          winner: null,
          isCompleted: false,
        });
      }
    }

    await match.save();

    emitMatchUpdate(match._id, {
      type: "LIVE_SCORE",
      status: match.status,
      liveState: match.liveState,
      latestPoint: {
        scoredBy: side,
        gameNumber: live.currentGameNumber,
        sideAScore: currentGame.sideAScore,
        sideBScore: currentGame.sideBScore,
      },
      gameWon,
      matchCompleted,
      winner: matchCompleted ? winnerDisplayName : null,
    });

    const sideAPlayerIds = [match.sideA.primaryUser, match.sideA.partnerUser]
      .map(getCleanId)
      .filter(Boolean);
    const sideBPlayerIds = [match.sideB.primaryUser, match.sideB.partnerUser]
      .map(getCleanId)
      .filter(Boolean);

    if (matchCompleted) {
      const winningSide = live.matchWinner;
      const winningScore =
        winningSide === "sideA"
          ? `${live.gamesWonSideA} - ${live.gamesWonSideB}`
          : `${live.gamesWonSideB} - ${live.gamesWonSideA}`;

      const winnerPlayerIds =
        winningSide === "sideA" ? sideAPlayerIds : sideBPlayerIds;
      const loserPlayerIds =
        winningSide === "sideA" ? sideBPlayerIds : sideAPlayerIds;

      sendNotificationToUsers(
        winnerPlayerIds,
        "Victory! You Won The Match!",
        `Congratulations! You defeated ${loserDisplayName} (${winningScore})!`,
        {
          type: "MATCH_COMPLETED",
          matchId: match._id.toString(),
          winner: winnerDisplayName,
          finalScore: winningScore,
        },
      ).catch((err) => console.error("Winner notification error:", err));

      sendNotificationToUsers(
        loserPlayerIds,
        "Match Concluded",
        `Match finished. ${winnerDisplayName} won (${winningScore}). Well played!`,
        {
          type: "MATCH_COMPLETED",
          matchId: match._id.toString(),
          winner: winnerDisplayName,
          finalScore: winningScore,
        },
      ).catch((err) => console.error("Loser notification error:", err));

      broadcastMatchEvent({
        sideAPlayerIds,
        sideBPlayerIds,
        title: "🏆 Match Finished!",
        mutualMsg: `🏆 ${winnerDisplayName} won the match against ${loserDisplayName} (${winningScore})! Tap to view full stats.`,
        sideAMsg:
          winningSide === "sideA"
            ? `🎉 Your friend ${winnerDisplayName} won their match against ${loserDisplayName} (${winningScore})!`
            : `Your friend ${loserDisplayName} completed their match against ${winnerDisplayName} (${winningScore}).`,
        sideBMsg:
          winningSide === "sideB"
            ? `🎉 Your friend ${winnerDisplayName} won their match against ${loserDisplayName} (${winningScore})!`
            : `Your friend ${loserDisplayName} completed their match against ${winnerDisplayName} (${winningScore}).`,
        dataPayload: {
          type: "MATCH_COMPLETED",
          matchId: match._id.toString(),
          winner: winnerDisplayName,
          winningSide,
          finalScore: winningScore,
        },
      });
    } else if (gameWon) {
      const gameScore =
        currentGame.winner === "sideA"
          ? `${currentGame.sideAScore} - ${currentGame.sideBScore}`
          : `${currentGame.sideBScore} - ${currentGame.sideAScore}`;

      broadcastMatchEvent({
        sideAPlayerIds,
        sideBPlayerIds,
        title: `Game ${currentGame.gameNumber} Won!`,
        mutualMsg: `${winnerDisplayName} won Game ${currentGame.gameNumber} against ${loserDisplayName} (${gameScore})!`,
        sideAMsg: `${winnerDisplayName} won Game ${currentGame.gameNumber} (${gameScore})!`,
        sideBMsg: `${winnerDisplayName} won Game ${currentGame.gameNumber} (${gameScore})!`,
        dataPayload: {
          type: "GAME_WON",
          matchId: match._id.toString(),
          gameNumber: currentGame.gameNumber,
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: "Point recorded.",
      status: match.status,
      liveState: match.liveState,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to record point.",
      error: error.message,
    });
  }
};

/**
 * Undo Last Point
 * POST /matches/:id/live/undo
 */
exports.undoPoint = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid match ID format." });
    }

    const match = await Match.findById(id);
    if (!match) {
      return res
        .status(404)
        .json({ success: false, message: "Match not found." });
    }

    // FIX: Verify user is ANY player on the team, not just primary
    const allowedPlayers = [
      match.sideA?.primaryUser?.toString(),
      match.sideA?.partnerUser?.toString(),
      match.sideB?.primaryUser?.toString(),
      match.sideB?.partnerUser?.toString(),
    ].filter(Boolean);

    if (!allowedPlayers.includes(userId.toString())) {
      return res.status(403).json({ success: false, message: "Unauthorized." });
    }

    const live = match.liveState;
    if (!live.history || live.history.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No points to undo." });
    }

    const lastPoint = live.history.pop();

    if (match.status === "COMPLETED") {
      match.status = "IN_PROGRESS";
      live.matchWinner = null;
    }

    const game = live.games.find((g) => g.gameNumber === lastPoint.gameNumber);
    if (game) {
      if (game.isCompleted) {
        game.isCompleted = false;
        if (game.winner === "sideA")
          live.gamesWonSideA = Math.max(0, live.gamesWonSideA - 1);
        if (game.winner === "sideB")
          live.gamesWonSideB = Math.max(0, live.gamesWonSideB - 1);
        game.winner = null;

        if (live.currentGameNumber > lastPoint.gameNumber) {
          live.games = live.games.filter(
            (g) => g.gameNumber <= lastPoint.gameNumber,
          );
          live.currentGameNumber = lastPoint.gameNumber;
        }
      }

      if (lastPoint.scoredBy === "sideA")
        game.sideAScore = Math.max(0, game.sideAScore - 1);
      if (lastPoint.scoredBy === "sideB")
        game.sideBScore = Math.max(0, game.sideBScore - 1);
    }

    const prevPoint = live.history[live.history.length - 1];
    if (prevPoint) {
      live.currentServer = prevPoint.servingSide;
    } else {
      let initialServer = "sideA";
      if (match.toss?.winnerSide === "sideA") {
        initialServer = match.toss.choice === "RECEIVE" ? "sideB" : "sideA";
      } else if (match.toss?.winnerSide === "sideB") {
        initialServer = match.toss.choice === "SERVE" ? "sideB" : "sideA";
      }
      live.currentServer = initialServer;
    }

    await match.save();

    emitMatchUpdate(match._id, {
      type: "LIVE_SCORE",
      status: match.status,
      liveState: match.liveState,
      action: "UNDO",
    });

    return res.status(200).json({
      success: true,
      message: "Last point undone.",
      status: match.status,
      liveState: match.liveState,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to undo point.",
      error: error.message,
    });
  }
};

/**
 * Fetch Live Scoreboard
 * GET /matches/:id/live
 */
exports.getLiveScore = async (req, res) => {
  try {
    const rawUserId = req.user?._id || req.user?.id;
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid match ID format." });
    }

    const match = await Match.findById(id)
      .select("title format status rules sideA sideB liveState toss")
      .populate("sideA.primaryUser", "fullName name avatar email profile_image")
      .populate("sideA.partnerUser", "fullName name avatar email profile_image")
      .populate("sideB.primaryUser", "fullName name avatar email profile_image")
      .populate("sideB.partnerUser", "fullName name avatar email profile_image")
      .populate("toss.tossWinner", "fullName name avatar email profile_image");

    if (!match) {
      return res
        .status(404)
        .json({ success: false, message: "Match not found." });
    }

    const currentUserIdStr = rawUserId?.toString();

    const sideAPlayerIds = [
      match.sideA?.primaryUser?._id?.toString(),
      match.sideA?.partnerUser?._id?.toString(),
    ].filter(Boolean);

    const sideBPlayerIds = [
      match.sideB?.primaryUser?._id?.toString(),
      match.sideB?.partnerUser?._id?.toString(),
    ].filter(Boolean);

    const allPlayerIds = [...sideAPlayerIds, ...sideBPlayerIds];
    const isParticipant = currentUserIdStr
      ? allPlayerIds.includes(currentUserIdStr)
      : false;

    if (!isParticipant) {
      if (!currentUserIdStr) {
        return res.status(401).json({
          success: false,
          message: "Authentication required to spectate.",
        });
      }

      const [connectedSideA, connectedSideB] = await Promise.all([
        Connection.exists({
          status: "accepted",
          $or: [
            { requester: currentUserIdStr, recipient: { $in: sideAPlayerIds } },
            { recipient: currentUserIdStr, requester: { $in: sideAPlayerIds } },
          ],
        }),
        Connection.exists({
          status: "accepted",
          $or: [
            { requester: currentUserIdStr, recipient: { $in: sideBPlayerIds } },
            { recipient: currentUserIdStr, requester: { $in: sideBPlayerIds } },
          ],
        }),
      ]);

      if (!connectedSideA || !connectedSideB) {
        return res.status(403).json({
          success: false,
          message:
            "Access restricted. You must be mutually connected to both sides to watch this match.",
        });
      }
    }

    return res.status(200).json({
      success: true,
      matchId: match._id,
      status: match.status,
      isParticipant,
      rules: match.rules,
      sideA: match.sideA,
      sideB: match.sideB,
      toss: match.toss,
      liveState: match.liveState,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch live score.",
      error: error.message,
    });
  }
};

/**
 * Get Matches for Logged-In User or Any Specific Player
 * GET /matches/my-matches
 * GET /matches/user/:userId
 */
exports.getUserMatches = async (req, res) => {
  try {
    const rawUserId =
      req.params.userId || req.query.userId || req.user?._id || req.user?.id;

    if (!rawUserId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required or user must be authenticated.",
      });
    }

    if (!isValidObjectId(rawUserId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid User ID format.",
      });
    }

    const targetUserId = new mongoose.Types.ObjectId(rawUserId);
    const { format, status, page = 1, limit = 10 } = req.query;

    const query = {
      $or: [
        { "sideA.primaryUser": targetUserId },
        { "sideA.partnerUser": targetUserId },
        { "sideB.primaryUser": targetUserId },
        { "sideB.partnerUser": targetUserId },
      ],
    };

    if (format && ["SINGLES", "DOUBLES"].includes(format.toUpperCase())) {
      query.format = format.toUpperCase();
    }

    if (status) {
      query.status = status;
    }

    const currentPage = Math.max(1, parseInt(page, 10));
    const pageSize = Math.max(1, parseInt(limit, 10));
    const skip = (currentPage - 1) * pageSize;

    const [matches, total] = await Promise.all([
      Match.find(query)
        .populate(
          "sideA.primaryUser",
          "fullName name avatar email profile_image",
        )
        .populate(
          "sideA.partnerUser",
          "fullName name avatar email profile_image",
        )
        .populate(
          "sideB.primaryUser",
          "fullName name avatar email profile_image",
        )
        .populate(
          "sideB.partnerUser",
          "fullName name avatar email profile_image",
        )
        .populate("createdBy", "fullName name avatar email profile_image")
        .populate("toss.tossWinner", "fullName name avatar email profile_image")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize),
      Match.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      pagination: {
        total,
        page: currentPage,
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
      matches,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve matches.",
      error: error.message,
    });
  }
};
exports.getMyMatches = exports.getUserMatches;

/**
 * Get Match Statistics for Authenticated User or Any Specific Player
 * GET /matches/stats/:userId
 */
exports.getUserStats = async (req, res) => {
  try {
    const rawTargetId =
      req.params.userId || req.query.userId || req.user?._id || req.user?.id;

    if (!rawTargetId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required or user must be authenticated.",
      });
    }

    if (!isValidObjectId(rawTargetId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid User ID format.",
      });
    }

    const targetUserId = new mongoose.Types.ObjectId(rawTargetId);

    const playerProfile = await User.findById(targetUserId).select(
      "fullName name avatar email profile_image",
    );
    if (!playerProfile) {
      return res.status(404).json({
        success: false,
        message: "Player profile not found.",
      });
    }

    const matchFilter = {
      $or: [
        { "sideA.primaryUser": targetUserId },
        { "sideA.partnerUser": targetUserId },
        { "sideB.primaryUser": targetUserId },
        { "sideB.partnerUser": targetUserId },
      ],
    };

    const statsAggregation = await Match.aggregate([
      { $match: matchFilter },
      {
        $project: {
          format: 1,
          status: 1,
          isSideA: {
            $or: [
              { $eq: ["$sideA.primaryUser", targetUserId] },
              { $eq: ["$sideA.partnerUser", targetUserId] },
            ],
          },
          isSideB: {
            $or: [
              { $eq: ["$sideB.primaryUser", targetUserId] },
              { $eq: ["$sideB.partnerUser", targetUserId] },
            ],
          },
          matchWinner: "$liveState.matchWinner",
        },
      },
      {
        $group: {
          _id: null,
          totalMatches: { $sum: 1 },
          completedMatches: {
            $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] },
          },
          inProgressMatches: {
            $sum: { $cond: [{ $eq: ["$status", "IN_PROGRESS"] }, 1, 0] },
          },
          pendingMatches: {
            $sum: {
              $cond: [
                {
                  $in: [
                    "$status",
                    ["INVITATION_PENDING", "ACCEPTED", "TOSS_READY"],
                  ],
                },
                1,
                0,
              ],
            },
          },
          totalWon: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", "COMPLETED"] },
                    {
                      $or: [
                        {
                          $and: [
                            { $eq: ["$isSideA", true] },
                            { $eq: ["$matchWinner", "sideA"] },
                          ],
                        },
                        {
                          $and: [
                            { $eq: ["$isSideB", true] },
                            { $eq: ["$matchWinner", "sideB"] },
                          ],
                        },
                      ],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
          singlesPlayed: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$format", "SINGLES"] },
                    { $eq: ["$status", "COMPLETED"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          singlesWon: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$format", "SINGLES"] },
                    { $eq: ["$status", "COMPLETED"] },
                    {
                      $or: [
                        {
                          $and: [
                            { $eq: ["$isSideA", true] },
                            { $eq: ["$matchWinner", "sideA"] },
                          ],
                        },
                        {
                          $and: [
                            { $eq: ["$isSideB", true] },
                            { $eq: ["$matchWinner", "sideB"] },
                          ],
                        },
                      ],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
          doublesPlayed: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$format", "DOUBLES"] },
                    { $eq: ["$status", "COMPLETED"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          doublesWon: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$format", "DOUBLES"] },
                    { $eq: ["$status", "COMPLETED"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const result = statsAggregation[0] || {
      totalMatches: 0,
      completedMatches: 0,
      inProgressMatches: 0,
      pendingMatches: 0,
      totalWon: 0,
      singlesPlayed: 0,
      singlesWon: 0,
      doublesPlayed: 0,
      doublesWon: 0,
    };

    const completed = result.completedMatches || 0;
    const won = result.totalWon || 0;
    const lost = Math.max(0, completed - won);
    const winRate = completed > 0 ? Math.round((won / completed) * 100) : 0;

    return res.status(200).json({
      success: true,
      player: {
        _id: playerProfile._id,
        name: playerProfile.fullName || playerProfile.name,
        avatar: playerProfile.avatar || playerProfile.profile_image,
      },
      stats: {
        totalMatches: result.totalMatches,
        completedMatches: completed,
        inProgressMatches: result.inProgressMatches,
        pendingMatches: result.pendingMatches,
        totalWon: won,
        totalLost: lost,
        winRate: `${winRate}%`,
        breakdown: {
          singles: {
            played: result.singlesPlayed,
            won: result.singlesWon,
            lost: Math.max(0, result.singlesPlayed - result.singlesWon),
          },
          doubles: {
            played: result.doublesPlayed,
            won: result.doublesWon,
            lost: Math.max(0, result.doublesPlayed - result.doublesWon),
          },
        },
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to calculate player statistics.",
      error: error.message,
    });
  }
};

/**
 * Mutual Live Feed: Get IN_PROGRESS matches where at least one connection is playing
 * GET /matches/mutual-live
 */
exports.getMutualConnectionsLiveMatches = async (req, res) => {
  try {
    const rawUserId = req.user?._id || req.user?.id;
    if (!rawUserId) {
      return res
        .status(401)
        .json({ success: false, message: "Authentication required." });
    }

    const currentUserId = new mongoose.Types.ObjectId(rawUserId);
    const myFriendIds = await getAcceptedFriendIds(currentUserId);

    if (myFriendIds.size === 0) {
      return res.status(200).json({ success: true, count: 0, matches: [] });
    }

    const friendObjectIds = Array.from(myFriendIds).map(
      (id) => new mongoose.Types.ObjectId(id),
    );

    const liveMatches = await Match.find({
      status: "IN_PROGRESS",
      $or: [
        { "sideA.primaryUser": { $in: friendObjectIds } },
        { "sideA.partnerUser": { $in: friendObjectIds } },
        { "sideB.primaryUser": { $in: friendObjectIds } },
        { "sideB.partnerUser": { $in: friendObjectIds } },
      ],
    })
      .select(
        "title format status rules sideA sideB liveState toss createdAt updatedAt",
      )
      .populate("sideA.primaryUser", "fullName name avatar email profile_image")
      .populate("sideA.partnerUser", "fullName name avatar email profile_image")
      .populate("sideB.primaryUser", "fullName name avatar email profile_image")
      .populate("sideB.partnerUser", "fullName name avatar email profile_image")
      .populate("createdBy", "fullName name avatar email profile_image")
      .populate("toss.tossWinner", "fullName name avatar email profile_image")
      .sort({ updatedAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: liveMatches.length,
      matches: liveMatches,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Upcoming Feed: Pending or scheduled matches where at least one competitor is your connection
 * GET /matches/mutual-upcoming
 */
exports.getMutualConnectionsUpcomingMatches = async (req, res) => {
  try {
    const rawUserId = req.user?._id || req.user?.id;
    if (!rawUserId) {
      return res
        .status(401)
        .json({ success: false, message: "Authentication required." });
    }

    const currentUserId = new mongoose.Types.ObjectId(rawUserId);
    const myFriendIds = await getAcceptedFriendIds(currentUserId);

    if (myFriendIds.size === 0) {
      return res.status(200).json({ success: true, count: 0, matches: [] });
    }

    const friendObjectIds = Array.from(myFriendIds).map(
      (id) => new mongoose.Types.ObjectId(id),
    );
    const upcomingStatuses = ["INVITATION_PENDING", "ACCEPTED", "TOSS_READY"];

    const upcomingMatches = await Match.find({
      status: { $in: upcomingStatuses },
      $or: [
        { "sideA.primaryUser": { $in: friendObjectIds } },
        { "sideA.partnerUser": { $in: friendObjectIds } },
        { "sideB.primaryUser": { $in: friendObjectIds } },
        { "sideB.partnerUser": { $in: friendObjectIds } },
      ],
    })
      .select("title format status rules sideA sideB toss createdAt updatedAt")
      .populate("sideA.primaryUser", "fullName name avatar email profile_image")
      .populate("sideA.partnerUser", "fullName name avatar email profile_image")
      .populate("sideB.primaryUser", "fullName name avatar email profile_image")
      .populate("sideB.partnerUser", "fullName name avatar email profile_image")
      .populate("createdBy", "fullName name avatar email profile_image")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: upcomingMatches.length,
      matches: upcomingMatches,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
