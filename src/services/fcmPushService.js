// src/services/fcmPushService.js
const { getMessaging } = require("firebase-admin/messaging");
require("../config/firebase"); // Ensures Firebase is initialized first
const User = require("../models/userModel");

/**
- Send 1-on-1 Chat Push Notification via Firebase Admin SDK
 */
const sendChatPushNotification = async ({
  recipientId,
  senderName,
  text,
  conversationId,
  unreadCount = 1,
}) => {
  try {
    if (!recipientId) return;

    // 1. Fetch recipient from DB
    const recipient = await User.findById(recipientId)
      .select("fcmToken fullName")
      .lean();

    if (!recipient || !recipient.fcmToken) {
      console.warn(`⚠️ [FCM Notice] Recipient ${recipientId} has no fcmToken in DB.`);
      return;
    }

    // 2. Build push payload
    const message = {
      token: recipient.fcmToken,
      notification: {
        title: senderName || "New Message",
        body: text || "Sent an attachment",
      },
      data: {
        type: "CHAT_MESSAGE",
        conversationId: String(conversationId),
        recipientId: String(recipientId),
      },
      android: {
        priority: "high",
        notification: {
          channelId: "badminton_core_alerts",
          sound: "default",
          priority: "high",
        },
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: senderName || "New Message",
              body: text || "Sent an attachment",
            },
            badge: Number(unreadCount) || 1, // Ensure it's a number for Apple Push
            sound: "default",
          },
        },
      },
    };

    // 3. Dispatch using modular getMessaging()
    const response = await getMessaging().send(message);
    console.log("✅ FCM Notification dispatched successfully. ID:", response);
  } catch (error) {
    console.error("❌ FCM Send Error:", error.message);

    // Clean up stale or invalidated device tokens
    if (
      error.code === "messaging/registration-token-not-registered" ||
      error.code === "messaging/invalid-registration-token"
    ) {
      console.log(`🧹 Removing stale FCM token for user ${recipientId}`);
      await User.findByIdAndUpdate(recipientId, { $unset: { fcmToken: 1 } });
    }
  }
};

module.exports = { sendChatPushNotification };