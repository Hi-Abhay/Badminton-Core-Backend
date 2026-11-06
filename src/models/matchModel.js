const mongoose = require('mongoose');

// Individual set/game score tracker
const gameScoreSchema = new mongoose.Schema({
  gameNumber: {
    type: Number,
    required: true,
  },
  sideAScore: {
    type: Number,
    default: 0,
  },
  sideBScore: {
    type: Number,
    default: 0,
  },
  winner: {
    type: String,
    enum: ['sideA', 'sideB', null],
    default: null,
  },
  isCompleted: {
    type: Boolean,
    default: false,
  },
});

// Rally point history for live tracking & undo functionality
const scoreHistorySchema = new mongoose.Schema({
  gameNumber: {
    type: Number,
    required: true,
  },
  scoredBy: {
    type: String,
    enum: ['sideA', 'sideB'],
    required: true,
  },
  sideAScore: {
    type: Number,
    required: true,
  },
  sideBScore: {
    type: Number,
    required: true,
  },
  servingSide: {
    type: String,
    enum: ['sideA', 'sideB'],
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

const MatchSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      trim: true,
      default: '', // Optional in Step 3
    },
    format: {
      type: String,
      enum: ['SINGLES', 'DOUBLES'],
      required: true,
      default: 'SINGLES',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Step 2: Competitors
    sideA: {
      primaryUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
      partnerUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null, // Used for Doubles
      },
      displayName: {
        type: String,
        required: true, // e.g., 'Viktor Axelsen' or 'Chia-Soh Titans'
      },
    },
    sideB: {
      primaryUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
      partnerUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null, // Used for Doubles
      },
      displayName: {
        type: String,
        required: true, // e.g., 'Tai Tzu-ying' or 'Alpha Smashers'
      },
    },
    // Step 3: Scoring Rules
    rules: {
      bestOf: {
        type: Number,
        enum: [1, 3, 5],
        default: 3,
        required: true,
      },
      pointsPerGame: {
        type: Number,
        enum: [11, 15, 21],
        default: 21,
        required: true,
      },
      maxPointCap: {
        type: Number,
        default: 30, // Capped at 30 as displayed on Step 4
      },
    },
    // Match invitation & game status
    status: {
      type: String,
      enum: [
        'INVITATION_PENDING', // Invitation sent to Side B
        'ACCEPTED',           // Opponent accepted; ready for Toss
        'DECLINED',           // Opponent rejected
        'TOSS_READY',         // Proceeded to Toss screen
        'IN_PROGRESS',        // Live scoring active
        'COMPLETED',
        'CANCELLED',
      ],
      default: 'INVITATION_PENDING',
    },
    toss: {
      tossWinner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      winnerSide: {
        type: String,
        enum: ['sideA', 'sideB'],
      },
      choice: {
        type: String,
        enum: ['Serve', 'Receive', 'Side'],
      },
      isCompleted: {
        type: Boolean,
        default: false,
      },
    },
    // Live match scoring state (powers live gameplay, sets, and match screen display)
    liveState: {
      currentGameNumber: {
        type: Number,
        default: 1,
      },
      gamesWonSideA: {
        type: Number,
        default: 0,
      },
      gamesWonSideB: {
        type: Number,
        default: 0,
      },
      currentServer: {
        type: String,
        enum: ['sideA', 'sideB'],
        default: 'sideA',
      },
      games: [gameScoreSchema],
      history: [scoreHistorySchema],
      matchWinner: {
        type: String,
        enum: ['sideA', 'sideB', null],
        default: null,
      },
    },
  },
  { timestamps: true }
);

// Performance indexes for /matches/my-matches dashboard queries
MatchSchema.index({ 'sideA.primaryUser': 1, status: 1 });
MatchSchema.index({ 'sideB.primaryUser': 1, status: 1 });
MatchSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Match', MatchSchema);