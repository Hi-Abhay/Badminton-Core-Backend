// src/controllers/userController.js

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs'); 
const User = require('../models/userModel');
const Connection = require('../models/connectionModel');

// Helper to sign JWT
const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });
};

// POST /users/register
exports.registerUser = async (req, res) => {
  try {
    const { fullName, email, password, fcmToken, role, profile_image } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'Email already exists.',
      });
    }

    const user = await User.create({
      fullName,
      email,
      password,
      fcmToken: fcmToken || null,
      profile_image: profile_image || null,
      role: role || 'single',
      totalMatch: 0,
      winMatch: 0,
    });

    const token = generateToken(user._id, user.role);

    return res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        profile_image: user.profile_image,
        fcmToken: user.fcmToken,
        totalMatch: user.totalMatch,
        winMatch: user.winMatch,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /users/login
exports.loginUser = async (req, res) => {
  try {
    const { email, password, fcmToken, profile_image } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password.',
      });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    let isUpdated = false;
    if (fcmToken && fcmToken !== user.fcmToken) {
      user.fcmToken = fcmToken;
      isUpdated = true;
    }
    if (profile_image && profile_image !== user.profile_image) {
      user.profile_image = profile_image;
      isUpdated = true;
    }
    if (isUpdated) await user.save();

    const token = generateToken(user._id, user.role);

    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        profile_image: user.profile_image,
        fcmToken: user.fcmToken,
        totalMatch: user.totalMatch,
        winMatch: user.winMatch,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /users/loginByEmail
exports.loginByEmail = async (req, res) => {
  try {
    const { email, profile_image, fcmToken } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an email address.',
      });
    }

    let user = await User.findOne({ email });

    // If user doesn't exist, reject the login
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found. You need to register first.',
      });
    }

    // Update existing user tokens or images if provided
    let isUpdated = false;
    if (profile_image && profile_image !== user.profile_image) {
      user.profile_image = profile_image;
      isUpdated = true;
    }
    if (fcmToken && fcmToken !== user.fcmToken) {
      user.fcmToken = fcmToken;
      isUpdated = true;
    }
    if (isUpdated) await user.save();

    const token = generateToken(user._id, user.role);

    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        profile_image: user.profile_image,
        fcmToken: user.fcmToken,
        totalMatch: user.totalMatch,
        winMatch: user.winMatch,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /users/profile
exports.getUserProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const [user, connectionsCount] = await Promise.all([
      User.findById(userId).lean(),
      Connection.countDocuments({
        $or: [{ requester: userId }, { recipient: userId }],
        status: 'accepted',
      }),
    ]);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        ...user,
        connectionsCount,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /users/allPlayer?cursor=652f...&limit=10&search=kunal
exports.getAllPlayers = async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const limit = Math.min(
      Math.max(1, parseInt(req.query.limit, 10) || 10),
      50,
    );
    const { cursor, search } = req.query;

    const query = { _id: { $ne: currentUserId } };

    // Keyset pagination cursor
    if (cursor) {
      query._id = { ...query._id, $lt: cursor };
    }

    // Name search with regex character escaping (avoids regex crashes on characters like +, ?, ()
    if (search && search.trim() !== '') {
      const sanitizedSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.fullName = { $regex: sanitizedSearch, $options: 'i' };
    }

    const players = await User.find(query)
      .select('fullName role totalMatch winMatch profile_image')
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasNextPage = players.length > limit;
    if (hasNextPage) {
      players.pop();
    }

    // Early return if no players match
    if (players.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        hasNextPage: false,
        nextCursor: null,
        players: [],
      });
    }

    const playerIds = players.map((p) => p._id);
    const playerObjectIds = playerIds.map((id) => new mongoose.Types.ObjectId(id));

    // 1. Fetch relationship state relative to the logged-in user
    // 2. Aggregate total confirmed connections for each player in this page batch
    const [activeConnections, countAggregation] = await Promise.all([
      Connection.find({
        $or: [
          { requester: currentUserId, recipient: { $in: playerIds } },
          { recipient: currentUserId, requester: { $in: playerIds } },
        ],
      }).lean(),

      Connection.aggregate([
        {
          $match: {
            status: 'accepted',
            $or: [
              { requester: { $in: playerObjectIds } },
              { recipient: { $in: playerObjectIds } },
            ],
          },
        },
        {
          $project: {
            users: ['$requester', '$recipient'],
          },
        },
        { $unwind: '$users' },
        {
          $match: {
            users: { $in: playerObjectIds },
          },
        },
        {
          $group: {
            _id: '$users',
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    // Fast O(1) lookup maps
    const connectionCountMap = new Map();
    countAggregation.forEach((item) => {
      connectionCountMap.set(item._id.toString(), item.count);
    });

    const statusMap = new Map();
    activeConnections.forEach((conn) => {
      const otherId =
        conn.requester.toString() === currentUserId
          ? conn.recipient.toString()
          : conn.requester.toString();

      if (conn.status === 'accepted') {
        statusMap.set(otherId, { status: 'connected', connectionId: conn._id });
      } else if (conn.status === 'pending') {
        const isSentByMe = conn.requester.toString() === currentUserId;
        statusMap.set(otherId, {
          status: isSentByMe ? 'pending_sent' : 'pending_received',
          connectionId: conn._id,
        });
      }
    });

    // Merge computed connection properties into each player record
    const enrichedPlayers = players.map((p) => {
      const playerIdStr = p._id.toString();
      const connInfo = statusMap.get(playerIdStr) || {
        status: 'none',
        connectionId: null,
      };

      return {
        ...p,
        connectionStatus: connInfo.status,
        connectionId: connInfo.connectionId,
        connectionsCount: connectionCountMap.get(playerIdStr) || 0,
      };
    });

    const nextCursor = hasNextPage ? players[players.length - 1]._id : null;

    return res.status(200).json({
      success: true,
      count: enrichedPlayers.length,
      hasNextPage,
      nextCursor,
      players: enrichedPlayers,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};