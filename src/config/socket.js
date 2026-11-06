// src/config/socket.js
const { WebSocketServer, WebSocket } = require("ws");
const url = require("url");
const jwt = require("jsonwebtoken");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/userModel");
// 1. Import your FCM service
const { sendChatPushNotification } = require("../services/fcmPushService");

let wss = null;
// Track rooms: roomName -> Set of WebSocket clients
const rooms = new Map();

// Helper: Check if a user has any active connected socket
const isUserOnline = (userId) => {
  const room = rooms.get(`user:${userId.toString()}`);
  return !!(room && room.size > 0);
};

// Room management helpers
const joinRoom = (roomName, ws) => {
  if (!rooms.has(roomName)) {
    rooms.set(roomName, new Set());
  }
  rooms.get(roomName).add(ws);
  ws.rooms.add(roomName);
};

const leaveRoom = (roomName, ws) => {
  if (rooms.has(roomName)) {
    rooms.get(roomName).delete(ws);
    if (rooms.get(roomName).size === 0) {
      rooms.delete(roomName);
    }
  }
  ws.rooms?.delete(roomName);
};

/**
- Broadcast match update signal to all clients watching the match or list screens
 */
const emitMatchUpdate = (matchId, extraData = {}) => {
  const message = JSON.stringify({
    event: "match:update",
    matchId: matchId.toString(),
    ...extraData,
  });

  if (wss) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
};

/**
- Send direct event to a single user's socket room
 */
const emitToUser = (userId, eventName, payload = {}) => {
  const room = rooms.get(`user:${userId.toString()}`);
  if (room) {
    const message = JSON.stringify({
      event: eventName,
      type: eventName,
      ...payload,
    });
    room.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
    return true;
  }
  return false;
};

const initSocket = (httpServer) => {
  wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", async (ws, req) => {
    // 1. Authenticate via token in URL query parameter (?token=...)
    const parsedUrl = url.parse(req.url, true);
    const token =
      parsedUrl.query?.token ||
      req.headers["sec-websocket-protocol"]?.replace(/^Bearer\s+/i, "");

    if (!token) {
      ws.close(4001, "Token required");
      return;
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      ws.user = decoded;
      ws.userId = (decoded.id || decoded._id).toString();
      ws.rooms = new Set();

      // Automatically join the user's private room
      joinRoom(`user:${ws.userId}`, ws);

      // Mark user as online in database
      await User.findByIdAndUpdate(ws.userId, { isOnline: true }).catch(
        () => {},
      );
      // console.log(`🔌 Native WS connected for user: ${ws.userId}`);
    } catch (err) {
      // console.error("WS Token verification failed:", err.message);
      ws.close(4002, "Invalid token");
      return;
    }

    // 2. Incoming Packet Router (Matches + 1v1 Chat)
    ws.on("message", async (rawMessage) => {
      try {
        const message = JSON.parse(rawMessage.toString());
        const { action } = message;

        // ==========================================
        // MATCH SCORING ACTIONS
        // ==========================================
        if (action === "join_match" && message.matchId) {
          joinRoom(`match:${message.matchId}`, ws);
          // console.log(`User ${ws.userId} joined match:${message.matchId}`);
        } else if (action === "leave_match" && message.matchId) {
          leaveRoom(`match:${message.matchId}`, ws);
          // console.log(`User ${ws.userId} left match:${message.matchId}`);
        }

        // ==========================================
        // 1v1 CHAT: SEND MESSAGE
        // ==========================================
        else if (action === "send_message") {
          const {
            conversationId,
            recipientId,
            text,
            mediaUrl,
            mediaType,
            tempId,
          } = message;
          if (!conversationId || !recipientId || (!text && !mediaUrl)) return;

          const recipientOnline = isUserOnline(recipientId);
          const initialStatus = recipientOnline ? "delivered" : "sent";

          // Save message to MongoDB
          const newMsg = await Message.create({
            conversationId,
            sender: ws.userId,
            recipient: recipientId,
            text: text || "",
            mediaUrl: mediaUrl || null,
            mediaType: mediaType || "text",
            status: initialStatus,
          });

          // 2. Update conversation & return the updated document using `{ new: true }`
          const updatedConv = await Conversation.findByIdAndUpdate(
            conversationId,
            {
              $set: { lastMessage: newMsg._id },
              $inc: { [`unreadCounts.${recipientId.toString()}`]: 1 },
            },
            { returnDocument: "after" },
          );

          const populatedMsg = await Message.findById(newMsg._id).populate(
            "sender",
            "fullName profile_image",
          );

          // Acknowledge back to sender (resolves optimistic UI on mobile)
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "message_sent_ack",
                event: "message_sent_ack",
                tempId,
                message: populatedMsg,
                status: initialStatus,
              }),
            );
          }

          // 3. Handle Delivery
          if (recipientOnline) {
            // Push directly to recipient's room
            emitToUser(recipientId, "new_message", {
              conversationId,
              message: populatedMsg,
            });
          } else {
            // Recipient is OFFLINE. Extract unread count and trigger FCM
            let recipientUnread = 1;
            if (updatedConv?.unreadCounts) {
              if (typeof updatedConv.unreadCounts.get === "function") {
                recipientUnread =
                  updatedConv.unreadCounts.get(recipientId.toString()) || 1;
              } else {
                recipientUnread =
                  updatedConv.unreadCounts[recipientId.toString()] || 1;
              }
            }

            sendChatPushNotification({
              recipientId,
              senderName: populatedMsg?.sender?.fullName || "Player",
              text: text || (mediaUrl ? "Sent an attachment" : ""),
              conversationId,
              unreadCount: recipientUnread,
            }).catch((fcmErr) =>
              // console.error("FCM WS send error:", fcmErr?.message || fcmErr),
              null
            );
          }
        }

        // ==========================================
        // 1v1 CHAT: MARK MESSAGES AS READ (Double Blue Tick)
        // ==========================================
        else if (action === "mark_read") {
          const { conversationId, recipientId } = message;
          if (!conversationId || !recipientId) return;

          // Update unread messages sent by the other player to "read"
          await Message.updateMany(
            {
              conversationId,
              sender: recipientId,
              recipient: ws.userId,
              status: { $ne: "read" },
            },
            {
              $set: { status: "read", readAt: new Date() },
            },
          );

          // Reset current user's unread counter for this conversation
          await Conversation.findByIdAndUpdate(conversationId, {
            $set: { [`unreadCounts.${ws.userId}`]: 0 },
          });

          // Inform sender that their messages were read
          emitToUser(recipientId, "messages_read", {
            conversationId,
            readBy: ws.userId,
          });
        }

        // ==========================================
        // 1v1 CHAT: TYPING INDICATORS
        // ==========================================
        else if (action === "typing" || action === "stop_typing") {
          const { conversationId, recipientId } = message;
          if (recipientId) {
            emitToUser(recipientId, action, {
              conversationId,
              fromUserId: ws.userId,
            });
          }
        }
      } catch (e) {
        // console.error("WS message parse error:", e);
      }
    });

    // 3. Disconnection & Cleanup
    ws.on("close", async () => {
      if (ws.rooms) {
        ws.rooms.forEach((roomName) => leaveRoom(roomName, ws));
      }

      // If user has no more active socket connections, mark offline
      if (!isUserOnline(ws.userId)) {
        await User.findByIdAndUpdate(ws.userId, {
          isOnline: false,
          lastSeen: new Date(),
        }).catch(() => {});
      }

      // console.log(`❌ Native WS closed for user: ${ws.userId}`);
    });

    ws.on("error", (err) => {
      // console.error(`WS Error for user ${ws.userId}:`, err.message);
    });
  });

  return wss;
};

module.exports = {
  initSocket,
  emitMatchUpdate,
  emitToUser,
};
