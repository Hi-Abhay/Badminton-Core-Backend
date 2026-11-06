const mongoose = require('mongoose');
const crypto = require('crypto');

const teamSchema = new mongoose.Schema(
  {
    teamName: {
      type: String,
      required: [true, 'Team name is required'],
      trim: true,
      minlength: 2,
      maxlength: 50,
    },
    teamCode: {
      type: String,
      unique: true,
      uppercase: true,
      trim: true,
    },
    teamType: {
      type: String,
      enum: {
        values: ['club', 'double'],
        message: '{VALUE} is not valid. Must be "club" or "double".',
      },
      required: [true, 'Team type is required'],
    },
    player1: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Player 1 (creator) is required'],
      index: true,
    },
    player2: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    player2Status: {
      type: String,
      enum: ['none', 'pending', 'accepted'],
      default: 'none',
    },
  },
  { timestamps: true }
);

// Auto-generate a unique 6-character teamCode before saving if not provided
teamSchema.pre('save', function () {
  if (!this.teamCode) {
    this.teamCode = crypto.randomBytes(3).toString('hex').toUpperCase();
  }
});

module.exports = mongoose.model('Team', teamSchema);