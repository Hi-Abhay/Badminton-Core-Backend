// src/services/notificationService.js
const { messaging } = require("../config/firebase");
const User = require("../models/userModel");
const Notification = require("../models/notificationModel");

/**
 * Sends push notifications to user IDs and saves them in the database
 */
const sendNotificationToUsers = async (userIds, title, body, data = {}) => {
  try {
    if (!userIds || userIds.length === 0) return;

    const uniqueIds = [...new Set(userIds.map((id) => id.toString()))];

    // 1. Persist notification in database for all recipients
    const notificationDocs = uniqueIds.map((recipientId) => ({
      recipient: recipientId,
      sender: data.senderId || null,
      title,
      body,
      type: data.type || "GENERAL",
      matchId: data.matchId || null,
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
    }));

    await Notification.insertMany(notificationDocs);

    // 2. Fetch FCM tokens for recipients
    const users = await User.find({
      _id: { $in: uniqueIds },
      fcmToken: { $ne: null, $exists: true },
    }).select("fcmToken");

    const tokens = users.map((u) => u.fcmToken).filter(Boolean);
    if (tokens.length === 0) return;

    // 3. Dispatch Push Notification via Firebase
    const serializedData = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v)])
    );

    const message = {
      tokens,
      notification: {
        title,
        body,
      },
      data: serializedData,
      android: {
        priority: "high",
        notification: {
          sound: "default",
          channelId: "badminton_match_alerts",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
          },
        },
      },
    };

    const response = await messaging.sendEachForMulticast(message);

    // Clean up stale FCM tokens
    if (response.failureCount > 0) {
      const invalidTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errCode = resp.error?.code;
          if (
            errCode === "messaging/invalid-registration-token" ||
            errCode === "messaging/registration-token-not-registered"
          ) {
            invalidTokens.push(tokens[idx]);
          }
        }
      });

      if (invalidTokens.length > 0) {
        await User.updateMany(
          { fcmToken: { $in: invalidTokens } },
          { $set: { fcmToken: null } }
        );
      }
    }
  } catch (error) {
    console.error("Notification Service Error:", error);
  }
};

module.exports = { sendNotificationToUsers };