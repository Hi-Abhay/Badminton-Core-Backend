const Team = require("../models/teamModel");
const User = require("../models/userModel");

const PLAYER_PROJECTION = "fullName role profile_image totalMatch winMatch";

// Helper to count active teams a user is already part of
const getUserTeamCount = async (userId) => {
  return await Team.countDocuments({
    $or: [{ player1: userId }, { player2: userId, player2Status: "accepted" }],
  });
};

// 1. POST /teams - Create Team
exports.createTeam = async (req, res) => {
  try {
    const creatorId = req.user.id || req.user._id;
    const { teamName, teamType, player2, teamCode } = req.body;

    if (!teamName || !teamType) {
      return res
        .status(400)
        .json({
          success: false,
          message: "teamName and teamType are required.",
        });
    }

    const creatorTeamCount = await getUserTeamCount(creatorId);
    if (creatorTeamCount >= 2) {
      return res
        .status(400)
        .json({
          success: false,
          message: "You have already joined the maximum limit of 2 teams.",
        });
    }

    let partnerId = null;
    let partnerStatus = "none";

    if (player2) {
      if (player2 === creatorId.toString()) {
        return res
          .status(400)
          .json({
            success: false,
            message: "You cannot add yourself as Player 2.",
          });
      }

      const partnerUser = await User.findById(player2);
      if (!partnerUser) {
        return res
          .status(404)
          .json({ success: false, message: "Player 2 not found." });
      }

      const partnerTeamCount = await getUserTeamCount(player2);
      if (partnerTeamCount >= 2) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "The selected partner has already reached the limit of 2 active teams.",
          });
      }

      partnerId = player2;
      partnerStatus = "pending";
    }

    const team = await Team.create({
      teamName,
      teamType,
      teamCode: teamCode ? teamCode.toUpperCase() : undefined,
      player1: creatorId,
      player2: partnerId,
      player2Status: partnerStatus,
    });

    const populatedTeam = await Team.findById(team._id)
      .populate("player1", PLAYER_PROJECTION)
      .populate("player2", PLAYER_PROJECTION)
      .lean();

    return res.status(201).json({
      success: true,
      message: partnerId
        ? "Team created and invitation sent to Player 2."
        : "Team created successfully.",
      team: populatedTeam,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(409)
        .json({
          success: false,
          message: "Team code already exists. Please choose another.",
        });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 2. GET /teams/:id - Get Team by ID
exports.getTeamById = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id)
      .populate("player1", PLAYER_PROJECTION)
      .populate("player2", PLAYER_PROJECTION)
      .lean();

    if (!team)
      return res
        .status(404)
        .json({ success: false, message: "Team not found." });
    return res.status(200).json({ success: true, team });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 3. GET /teams - Get All Teams (Optimized with Cursor Pagination)
exports.getAllTeams = async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(1, parseInt(req.query.limit, 10) || 10),
      50,
    );
    const { cursor, teamType, search } = req.query;
    const query = {};

    if (cursor) query._id = { $lt: cursor };
    if (teamType) query.teamType = teamType;
    if (search) query.teamName = { $regex: search.trim(), $options: "i" };

    const teams = await Team.find(query)
      .populate("player1", PLAYER_PROJECTION)
      .populate("player2", PLAYER_PROJECTION)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasNextPage = teams.length > limit;
    if (hasNextPage) teams.pop();
    const nextCursor = hasNextPage ? teams[teams.length - 1]._id : null;

    return res
      .status(200)
      .json({
        success: true,
        count: teams.length,
        hasNextPage,
        nextCursor,
        teams,
      });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 4. PATCH /teams/:id - Update Team
exports.updateTeam = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { teamName, teamType, player2 } = req.body;
    const team = await Team.findById(req.params.id);

    if (!team)
      return res
        .status(404)
        .json({ success: false, message: "Team not found." });
    if (team.player1.toString() !== userId.toString()) {
      return res
        .status(403)
        .json({
          success: false,
          message: "Only Player 1 can update team details.",
        });
    }

    if (player2 !== undefined) {
      if (player2 === null || player2 === "") {
        team.player2 = null;
        team.player2Status = "none";
      } else if (player2 !== team.player2?.toString()) {
        if (player2 === team.player1.toString()) {
          return res
            .status(400)
            .json({
              success: false,
              message: "Player 1 cannot be added as Player 2.",
            });
        }
        const partner = await User.findById(player2);
        if (!partner)
          return res
            .status(404)
            .json({ success: false, message: "Target Player 2 not found." });

        const partnerCount = await getUserTeamCount(player2);
        if (partnerCount >= 2)
          return res
            .status(400)
            .json({
              success: false,
              message: "Target partner is already in 2 teams.",
            });

        team.player2 = player2;
        team.player2Status = "pending";
      }
    }

    if (teamName) team.teamName = teamName;
    if (teamType) team.teamType = teamType;

    await team.save();
    const updatedTeam = await Team.findById(team._id)
      .populate("player1", PLAYER_PROJECTION)
      .populate("player2", PLAYER_PROJECTION)
      .lean();

    return res
      .status(200)
      .json({
        success: true,
        message: "Team updated successfully.",
        team: updatedTeam,
      });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 5. PATCH /teams/:id/respond - Accept or Decline Team Invitation
exports.respondToInvite = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { action } = req.body; // 'ACCEPT' or 'DECLINE'

    if (!["ACCEPT", "DECLINE"].includes(action)) {
      return res
        .status(400)
        .json({ success: false, message: "Action must be ACCEPT or DECLINE." });
    }

    const team = await Team.findById(req.params.id);
    if (!team)
      return res
        .status(404)
        .json({ success: false, message: "Team not found." });

    if (team.player2?.toString() !== userId.toString()) {
      return res
        .status(403)
        .json({
          success: false,
          message: "You are not the invited player for this team.",
        });
    }
    if (team.player2Status !== "pending") {
      return res
        .status(400)
        .json({
          success: false,
          message: `Invitation is no longer pending (Current: ${team.player2Status}).`,
        });
    }

    if (action === "ACCEPT") {
      const userTeamCount = await getUserTeamCount(userId);
      if (userTeamCount >= 2) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "You cannot accept this invite because you are already in 2 active teams.",
          });
      }
      team.player2Status = "accepted";
    } else {
      team.player2 = null;
      team.player2Status = "none";
    }

    await team.save();
    const updatedTeam = await Team.findById(team._id)
      .populate("player1", PLAYER_PROJECTION)
      .populate("player2", PLAYER_PROJECTION)
      .lean();

    return res.status(200).json({
      success: true,
      message: `Team invitation ${action.toLowerCase()}ed.`,
      team: updatedTeam,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 6. POST /teams/:id/leave - Leave Team
exports.leaveTeam = async (req, res) => {
  try {
    const userId = (req.user.id || req.user._id).toString();
    const team = await Team.findById(req.params.id);

    if (!team)
      return res
        .status(404)
        .json({ success: false, message: "Team not found." });

    const isPlayer1 = team.player1.toString() === userId;
    const isPlayer2 = team.player2?.toString() === userId;

    if (!isPlayer1 && !isPlayer2) {
      return res
        .status(403)
        .json({
          success: false,
          message: "You are not a member of this team.",
        });
    }

    if (isPlayer2) {
      // Player 2 leaves -> They are removed from the team
      team.player2 = null;
      team.player2Status = "none";
      await team.save();
      return res
        .status(200)
        .json({ success: true, message: "You have left the team." });
    }

    if (isPlayer1) {
      // Player 1 leaves -> If Player 2 is accepted, transfer ownership. Otherwise, delete team.
      if (team.player2 && team.player2Status === "accepted") {
        team.player1 = team.player2;
        team.player2 = null;
        team.player2Status = "none";
        await team.save();
        return res
          .status(200)
          .json({
            success: true,
            message: "You left the team. Ownership transferred to Player 2.",
          });
      } else {
        await Team.findByIdAndDelete(team._id);
        return res
          .status(200)
          .json({
            success: true,
            message: "Team dissolved because you were the only active player.",
          });
      }
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 7. DELETE /teams/:id - Delete Team
exports.deleteTeam = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const team = await Team.findById(req.params.id);

    if (!team)
      return res
        .status(404)
        .json({ success: false, message: "Team not found." });
    if (team.player1.toString() !== userId.toString()) {
      return res
        .status(403)
        .json({
          success: false,
          message: "Only the team creator can delete this team.",
        });
    }

    await Team.findByIdAndDelete(req.params.id);
    return res
      .status(200)
      .json({ success: true, message: "Team deleted successfully." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 8. GET /teams/my/teams - Get logged-in user's teams
exports.getMyTeams = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    // Fetching teams where user is either Player 1 or Player 2 
    // (This includes pending invites so the UI can show them)
    const teams = await Team.find({
      $or: [{ player1: userId }, { player2: userId }],
    })
      .populate("player1", PLAYER_PROJECTION)
      .populate("player2", PLAYER_PROJECTION)
      .sort({ _id: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: teams.length,
      teams,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
