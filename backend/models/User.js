
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
      select: false,
    },

    // Uploaded profile picture URL
    profilePicture: {
      type: String,
      default: "",
      trim: true,
    },

    // Built-in avatar selection
    avatar: {
      type: String,
      default: "default-1",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);
