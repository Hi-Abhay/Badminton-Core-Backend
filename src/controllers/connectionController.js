// controllers/connectionController.js
const Connection = require('../models/connectionModel');
const User = require('../models/userModel');
const { sendNotificationToUsers } = require('../services/notificationService');
const mongoose = require('mongoose');
const USER_FIELDS = 'fullName email profile_image role totalMatch winMatch';

// POST /connections/request
exports.sendRequest = async (req, res) => {
  try {
    const requesterId = req.user?._id || req.user?.id;
    const { recipientId } = req.body;

    if (!requesterId) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    if (!recipientId) {
      return res.status(400).json({ success: false, message: 'recipientId is required.' });
    }

    if (requesterId.toString() === recipientId.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot connect with yourself.' });
    }

    const recipientExists = await User.findById(recipientId);
    if (!recipientExists) {
      return res.status(404).json({ success: false, message: 'Target player not found.' });
    }

    // Determine requester name (fall back to database if not in token)
    let requesterName = req.user?.fullName || req.user?.name;
    if (!requesterName) {
      const requesterDoc = await User.findById(requesterId).select('fullName');
      requesterName = requesterDoc?.fullName || 'A player';
    }

    // Check existing relation in either direction
    const existing = await Connection.findOne({
      $or: [
        { requester: requesterId, recipient: recipientId },
        { requester: recipientId, recipient: requesterId },
      ],
    });

    if (existing) {
      if (existing.status === 'accepted') {
        return res.status(400).json({ success: false, message: 'You are already connected.' });
      }

      if (existing.status === 'pending') {
        // If the other player already sent a request, auto-accept it
        if (existing.requester.toString() === recipientId.toString()) {
          existing.status = 'accepted';
          await existing.save();

          // Notify the other player that the connection is now mutual and accepted
          sendNotificationToUsers(
            [recipientId],
            'Mutual Connection Confirmed!',
            `${requesterName} connected with you! You are now friends.`,
            {
              type: 'CONNECTION_ACCEPTED',
              connectionId: existing._id.toString(),
              senderId: requesterId.toString(),
            }
          ).catch((err) => console.error('Auto-accept notification error:', err));

          return res.status(200).json({
            success: true,
            message: 'Mutual request found. Connection accepted.',
            connection: existing,
          });
        }
        return res.status(400).json({ success: false, message: 'Connection request is already pending.' });
      }

      // Re-send request if it was previously declined
      existing.requester = requesterId;
      existing.recipient = recipientId;
      existing.status = 'pending';
      await existing.save();

      // Notify recipient about the re-sent request
      sendNotificationToUsers(
        [recipientId],
        'New Connection Request',
        `${requesterName} sent you a connection request.`,
        {
          type: 'CONNECTION_REQUEST',
          connectionId: existing._id.toString(),
          senderId: requesterId.toString(),
        }
      ).catch((err) => console.error('Connection request notification error:', err));

      return res.status(200).json({
        success: true,
        message: 'Connection request sent.',
        connection: existing,
      });
    }

    // Create fresh connection request
    const connection = await Connection.create({
      requester: requesterId,
      recipient: recipientId,
      status: 'pending',
    });

    // Notify recipient about the connection request
    sendNotificationToUsers(
      [recipientId],
      'New Connection Request',
      `${requesterName} sent you a connection request.`,
      {
        type: 'CONNECTION_REQUEST',
        connectionId: connection._id.toString(),
        senderId: requesterId.toString(),
      }
    ).catch((err) => console.error('Connection request notification error:', err));

    return res.status(201).json({
      success: true,
      message: 'Connection request sent successfully.',
      connection,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /connections/:connectionId/respond
// Body: { "action": "accept" | "decline" }
exports.respondToRequest = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { connectionId } = req.params;
    const { action } = req.body;

    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be "accept" or "decline".' });
    }

    const connection = await Connection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({ success: false, message: 'Connection request not found.' });
    }

    // Only the recipient can accept or decline
    if (connection.recipient.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to respond to this request.' });
    }

    if (connection.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Request is already ${connection.status}.` });
    }

    let responderName = req.user?.fullName || req.user?.name;
    if (!responderName) {
      const userDoc = await User.findById(userId).select('fullName');
      responderName = userDoc?.fullName || 'A player';
    }

    if (action === 'accept') {
      connection.status = 'accepted';
      await connection.save();

      // Notify the requester that their connection request was accepted
      sendNotificationToUsers(
        [connection.requester],
        'Connection Request Accepted!',
        `${responderName} accepted your connection request. You can now invite them to matches!`,
        {
          type: 'CONNECTION_ACCEPTED',
          connectionId: connection._id.toString(),
          senderId: userId.toString(),
        }
      ).catch((err) => console.error('Connection accepted notification error:', err));

      return res.status(200).json({ success: true, message: 'Connection accepted.', connection });
    }

    // On decline, remove the record
    await Connection.findByIdAndDelete(connectionId);
    return res.status(200).json({ success: true, message: 'Connection request declined.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /connections
// Lists all active connections (friends) for the logged-in player
exports.getMyConnections = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    const connections = await Connection.find({
      $or: [{ requester: userId }, { recipient: userId }],
      status: 'accepted',
    })
      .populate('requester', USER_FIELDS)
      .populate('recipient', USER_FIELDS)
      .lean();

    // Map each item so the client receives the other player's profile directly
    const friends = connections.map((conn) => {
      const isRequester = conn.requester._id.toString() === userId.toString();
      return {
        connectionId: conn._id,
        connectedSince: conn.updatedAt,
        player: isRequester ? conn.recipient : conn.requester,
      };
    });

    return res.status(200).json({
      success: true,
      count: friends.length,
      friends,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /connections/pending
// Incoming requests waiting for your approval
exports.getPendingRequests = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    const pendingRequests = await Connection.find({
      recipient: userId,
      status: 'pending',
    })
      .populate('requester', USER_FIELDS)
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: pendingRequests.length,
      requests: pendingRequests,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /connections/sent
// Outgoing requests you sent that are still pending
exports.getSentRequests = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    const sentRequests = await Connection.find({
      requester: userId,
      status: 'pending',
    })
      .populate('recipient', USER_FIELDS)
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: sentRequests.length,
      requests: sentRequests,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /connections/:connectionId
// Remove a friend or cancel a sent pending request
exports.removeConnection = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { connectionId } = req.params;

    const connection = await Connection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({ success: false, message: 'Connection not found.' });
    }

    const isMember =
      connection.requester.toString() === userId.toString() ||
      connection.recipient.toString() === userId.toString();

    if (!isMember) {
      return res.status(403).json({ success: false, message: 'Not authorized to remove this connection.' });
    }

    await Connection.findByIdAndDelete(connectionId);

    return res.status(200).json({
      success: true,
      message: 'Connection removed successfully.',
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /connections/status/:targetUserId
// Check relationship/connection status between logged-in user and target player
exports.checkConnectionStatus = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { targetUserId } = req.params;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ success: false, message: 'Invalid target user ID format.' });
    }

    // Check if the user is checking themselves
    if (userId.toString() === targetUserId.toString()) {
      return res.status(200).json({
        success: true,
        isConnected: false,
        status: 'self',
        connectionId: null,
      });
    }

    const connection = await Connection.findOne({
      $or: [
        { requester: userId, recipient: targetUserId },
        { requester: targetUserId, recipient: userId },
      ],
    });

    if (!connection) {
      return res.status(200).json({
        success: true,
        isConnected: false,
        status: 'none', // No request exists
        connectionId: null,
      });
    }

    if (connection.status === 'accepted') {
      return res.status(200).json({
        success: true,
        isConnected: true,
        status: 'connected',
        connectionId: connection._id,
        connectedSince: connection.updatedAt,
      });
    }

    if (connection.status === 'pending') {
      const isSentByMe = connection.requester.toString() === userId.toString();
      return res.status(200).json({
        success: true,
        isConnected: false,
        status: isSentByMe ? 'pending_sent' : 'pending_received',
        connectionId: connection._id,
      });
    }

    return res.status(200).json({
      success: true,
      isConnected: false,
      status: connection.status,
      connectionId: connection._id,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};