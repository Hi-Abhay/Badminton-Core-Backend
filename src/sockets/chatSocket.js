const jwt = require("jsonwebtoken");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/userModel");

// In-memory mapping: userId (string) -> Set of active WebSocket instances
const userSockets = new Map();

/**
 * Send payload to a specific user across all their open devices
 */
const sendToPlayer = (userId, payload) => {
  if (!userId) return false;
  const sockets = userSockets.get(userId.toString());
  if (!sockets || sockets.size === 0) return false;

  const serialized = JSON.stringify(payload);
  sockets.forEach((ws) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(serialized);
    }
  });
  return true;
};

const setupChatSocket = (wss) => {
  wss.on("connection", async (ws, req) => {
    try {
      // 1. Authenticate via token in query string: ws://domain.com?token=xxx
      const url = new URL(req.url, "http://localhost");
      const token = url.searchParams.get("token");

      if (!token) {
        ws.close(4001, "Auth token missing");
        return;
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = decoded._id || decoded.id;

      if (!userId) {
        ws.close(4002, "Invalid token payload");
        return;
      }

      ws.userId = userId.toString();

      // Register connection
      if (!userSockets.has(ws.userId)) {
        userSockets.set(ws.userId, new Set());
      }
      userSockets.get(ws.userId).add(ws);

      // Mark user online
      await User.findByIdAndUpdate(ws.userId, { isOnline: true });

      // 2. Incoming Packet Router
      ws.on("message", async (rawMessage) => {
        try {
          const packet = JSON.parse(rawMessage);
          const { action, conversationId, recipientId, text, mediaUrl, mediaType, tempId } = packet;

          // ==========================================
          // ACTION: SEND MESSAGE (1v1 Direct)
          // ==========================================
          if (action === "send_message") {
            if (!conversationId || !recipientId || (!text && !mediaUrl)) return;

            // Check if recipient is currently online on any socket
            const isRecipientOnline = userSockets.has(recipientId.toString());
            const status = isRecipientOnline ? "delivered" : "sent";

            // Persist message
            const message = await Message.create({
              conversationId,
              sender: ws.userId,
              recipient: recipientId,
              text,
              mediaUrl: mediaUrl || null,
              mediaType: mediaType || "text",
              status,
            });

            // Update parent conversation
            await Conversation.findByIdAndUpdate(conversationId, {
              $set: { lastMessage: message._id },
              $inc: { [`unreadCounts.${recipientId.toString()}`]: 1 },
            });

            const populated = await Message.findById(message._id).populate(
              "sender",
              "fullName profile_image"
            );

            // Acknowledge back to sender (resolves optimistic local message on client)
            ws.send(
              JSON.stringify({
                type: "message_sent_ack",
                tempId,
                message: populated,
                status,
              })
            );

            // Deliver directly to recipient's socket
            const delivered = sendToPlayer(recipientId, {
              type: "new_message",
              conversationId,
              message: populated,
            });

            // If recipient is offline, fire FCM push alert
            if (!delivered) {
              // triggerFCMNotification(recipientId, {
              //   title: populated.sender.fullName,
              //   body: text || "Sent an attachment",
              //   data: { conversationId, type: "CHAT_MESSAGE" },
              // });
            }
          }

          // ==========================================
          // ACTION: MARK MESSAGES AS READ (Double Blue Tick)
          // ==========================================
          else if (action === "mark_read") {
            if (!conversationId || !recipientId) return;

            await Message.updateMany(
              {
                conversationId,
                sender: recipientId,
                recipient: ws.userId,
                status: { $ne: "read" },
              },
              {
                $set: { status: "read", readAt: new Date() },
              }
            );

            await Conversation.findByIdAndUpdate(conversationId, {
              $set: { [`unreadCounts.${ws.userId}`]: 0 },
            });

            // Notify the original sender that their messages were read
            sendToPlayer(recipientId, {
              type: "messages_read",
              conversationId,
              readBy: ws.userId,
            });
          }

          // ==========================================
          // ACTION: TYPING STATUS
          // ==========================================
          else if (action === "typing" || action === "stop_typing") {
            if (recipientId) {
              sendToPlayer(recipientId, {
                type: action,
                conversationId,
                fromUserId: ws.userId,
              });
            }
          }
        } catch (err) {
          console.error("Socket packet processing error:", err);
        }
      });

      // 3. Connection Cleanup & Presence
      ws.on("close", async () => {
        const userSet = userSockets.get(ws.userId);
        if (userSet) {
          userSet.delete(ws);
          if (userSet.size === 0) {
            userSockets.delete(ws.userId);
            await User.findByIdAndUpdate(ws.userId, {
              isOnline: false,
              lastSeen: new Date(),
            });
          }
        }
      });
    } catch (authErr) {
      ws.close(4003, "Authentication failed");
    }
  });
};

module.exports = { setupChatSocket };