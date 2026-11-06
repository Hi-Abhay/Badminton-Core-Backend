// src/controllers/chatController.js
const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const { emitToUser } = require("../config/socket");
const { sendChatPushNotification } = require("../services/fcmPushService");

/**
- Access or create a 1v1 conversation with an opponent
- POST /api/chats/access
 */
exports.accessConversation = async (req, res) => {
  try {
    const currentUserId = req.user?._id || req.user?.id;
    const { recipientId } = req.body;

    if (!recipientId || !mongoose.Types.ObjectId.isValid(recipientId)) {
      return res.status(400).json({ success: false, message: "Valid recipientId is required." });
    }

    if (String(currentUserId) === String(recipientId)) {
      return res.status(400).json({ success: false, message: "Cannot start a chat with yourself." });
    }

    // Check if an existing 1v1 conversation exists between both players
    let conversation = await Conversation.findOne({
      participants: { $all: [currentUserId, recipientId], $size: 2 },
    })
      .populate("participants", "fullName email profile_image isOnline lastSeen")
      .populate("lastMessage");

    if (conversation) {
      return res.status(200).json({ success: true, conversation });
    }

    // Create a new direct channel
    const createdConv = await Conversation.create({
      participants: [currentUserId, recipientId],
      unreadCounts: {
        [currentUserId.toString()]: 0,
        [recipientId.toString()]: 0,
      },
    });

    conversation = await Conversation.findById(createdConv._id).populate(
      "participants",
      "fullName email profile_image isOnline lastSeen"
    );

    return res.status(201).json({ success: true, conversation });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
- Get all 1v1 conversations for the current user (WhatsApp Inbox)
- GET /api/chats
 */
exports.getMyConversations = async (req, res) => {
  try {
    const currentUserId = req.user?._id || req.user?.id;
    const { page = 1, limit = 20, search = "" } = req.query;

    const currentPage = Math.max(1, parseInt(page, 10));
    const pageSize = Math.max(1, parseInt(limit, 10));
    const skip = (currentPage - 1) * pageSize;

    const query = {
      participants: currentUserId,
      lastMessage: { $ne: null }, // Hide empty stub conversations
    };

    const conversations = await Conversation.find(query)
      .populate("participants", "fullName email profile_image isOnline lastSeen")
      .populate("lastMessage", "text mediaType sender status createdAt")
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean();

    let totalUnread = 0;

    const formatted = conversations
      .map((conv) => {
        const otherUser = conv.participants.find(
          (p) => String(p._id) !== String(currentUserId)
        );

        const unreadCount =
          (conv.unreadCounts && conv.unreadCounts[currentUserId.toString()]) || 0;

        totalUnread += unreadCount;

        return {
          _id: conv._id,
          otherUser: otherUser || null,
          lastMessage: conv.lastMessage || null,
          unreadCount,
          updatedAt: conv.updatedAt,
        };
      })
      .filter((conv) => {
        if (!search.trim()) return true;
        const name = conv.otherUser?.fullName?.toLowerCase() || "";
        return name.includes(search.trim().toLowerCase());
      });

    return res.status(200).json({
      success: true,
      totalUnread,
      page: currentPage,
      conversations: formatted,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
- Get message history for a 1v1 conversation (Cursor Pagination)
- GET /api/chats/:conversationId/messages?limit=30&before=2026-11-01T12:00:00.000Z
 */
exports.getMessages = async (req, res) => {
  try {
    const currentUserId = req.user?._id || req.user?.id;
    const { conversationId } = req.params;
    const { limit = 30, before } = req.query;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ success: false, message: "Invalid Conversation ID." });
    }

    const filter = {
      conversationId,
      deletedFor: { $ne: currentUserId },
    };

    if (before) {
      filter.createdAt = { $lt: new Date(before) };
    }

    const pageSize = Math.min(parseInt(limit, 10), 100);

    const messages = await Message.find(filter)
      .populate("sender", "fullName profile_image")
      .sort({ createdAt: -1 })
      .limit(pageSize)
      .lean();

    return res.status(200).json({
      success: true,
      messages: messages.reverse(), // Chronological order
      hasMore: messages.length === pageSize,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
- Mark all incoming messages in a conversation as read (Double Blue Tick REST Fallback)
- PATCH /api/chats/:conversationId/read
 */
exports.markAsRead = async (req, res) => {
  try {
    const currentUserId = req.user?._id || req.user?.id;
    const { conversationId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ success: false, message: "Invalid Conversation ID." });
    }

    await Message.updateMany(
      {
        conversationId,
        recipient: currentUserId,
        status: { $ne: "read" },
      },
      {
        $set: { status: "read", readAt: new Date() },
      }
    );

    await Conversation.findByIdAndUpdate(conversationId, {
      $set: { [`unreadCounts.${currentUserId.toString()}`]: 0 },
    });

    return res.status(200).json({ success: true, message: "Messages marked as read." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
- Send a message via REST API (Swagger / Fallback) with Real-Time & FCM Push
- POST /api/chats/:conversationId/messages
 */
exports.sendMessageHttp = async (req, res) => {
  try {
    const currentUserId = req.user?._id || req.user?.id;
    const { conversationId } = req.params;
    const { recipientId, text, mediaUrl, mediaType = "text" } = req.body;

    if (!recipientId || !mongoose.Types.ObjectId.isValid(recipientId)) {
      return res.status(400).json({ success: false, message: "Valid recipientId is required." });
    }

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ success: false, message: "Valid conversationId is required." });
    }

    if (!text && !mediaUrl) {
      return res.status(400).json({ success: false, message: "Message text or mediaUrl is required." });
    }

    // 1. Create message
    const message = await Message.create({
      conversationId,
      sender: currentUserId,
      recipient: recipientId,
      text: text || "",
      mediaUrl: mediaUrl || null,
      mediaType,
      status: "sent",
    });

    // 2. Update conversation using modern returnDocument: 'after' syntax
    const updatedConv = await Conversation.findByIdAndUpdate(
      conversationId,
      {
        $set: { lastMessage: message._id },
        $inc: { [`unreadCounts.${recipientId.toString()}`]: 1 },
      },
      { returnDocument: "after" }
    );

    const populated = await Message.findById(message._id).populate(
      "sender",
      "fullName profile_image"
    );

    // 3. Real-time emit to recipient. Returns boolean based on online status.
    const isOnline = emitToUser(recipientId, "new_message", {
      conversationId,
      message: populated,
    });

    // 4. Safely extract recipient unread count for badge sync
    let recipientUnread = 1;
    if (updatedConv?.unreadCounts) {
      if (typeof updatedConv.unreadCounts.get === "function") {
        recipientUnread = updatedConv.unreadCounts.get(recipientId.toString()) || 1;
      } else {
        recipientUnread = updatedConv.unreadCounts[recipientId.toString()] || 1;
      }
    }

    // 5. Send Firebase Push Notification ONLY if user is offline
    if (!isOnline) {
      sendChatPushNotification({
        recipientId,
        senderName: populated?.sender?.fullName || "Player",
        text: text || (mediaUrl ? "Sent an attachment" : ""),
        conversationId,
        unreadCount: recipientUnread,
      }).catch((fcmErr) => console.error("FCM background send notice:", fcmErr?.message || fcmErr));
    }

    return res.status(201).json({
      success: true,
      message: populated,
      deliveredVia: isOnline ? "socket" : "fcm"
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to send message.",
      error: error.message,
    });
  }
};