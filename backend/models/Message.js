
const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },

    // Message read receipt
    seen: {
      type: Boolean,
      default: false,
    },

    seenAt: {
      type: Date,
      default: null,
    },

    // Hide a message for one user only
    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Efficient conversation queries
messageSchema.index({
  sender: 1,
  receiver: 1,
  createdAt: 1,
});

messageSchema.index({
  receiver: 1,
  sender: 1,
  createdAt: 1,
});

module.exports = mongoose.model("Message", messageSchema);
