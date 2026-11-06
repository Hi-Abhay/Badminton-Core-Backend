// src/models/notificationModel.js
const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    body: {
      type: String,
      required: true,
      trim: true,
    },
    // In src/models/notificationModel.js
    type: {
      type: String,
      enum: [
        "NEW_MATCH",
        "MATCH_CREATED",
        "MATCH_CHALLENGE",
        "CHALLENGE_ACCEPTED",
        "CHALLENGE_DECLINED",
        "MATCH_CONFIRMED",
        "TOSS_COMPLETED",
        "MATCH_LIVE",
        "GAME_WON",
        "MATCH_COMPLETED",
        "CONNECTION_REQUEST",
        "CONNECTION_ACCEPTED",
        "GENERAL",
      ],
      default: "GENERAL",
    },
    matchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      default: null,
    },
    data: {
      type: Map,
      of: String,
      default: {},
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true },
);

notificationSchema.index({ recipient: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
