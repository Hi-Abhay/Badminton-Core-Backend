const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
      select: false,
    },
    profile_image: {
      type: String,
      default: null,
      trim: true,
    },
    fcmToken: {
      type: String,
      default: null,
      trim: true,
    },
    role: {
      type: String,
      enum: {
        values: ["single", "double"],
        message: '{VALUE} is not valid. Role must be "single" or "double".',
      },
      default: "single",
    },
    totalMatch: {
      type: Number,
      default: 0,
      min: 0,
    },
    winMatch: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true },
);

// Encrypt password before saving
userSchema.pre("save", async function () {
  if (!this.isModified("password")) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare entered password with hashed password in database
userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
