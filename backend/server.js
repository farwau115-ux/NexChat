require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");

const User = require("./models/User");
const Message = require("./models/Message");
const ChatRequest = require("./models/ChatRequest");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 8000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!process.env.MONGO_URI || !JWT_SECRET) {
  console.error("MONGO_URI aur JWT_SECRET .env mein required hain.");
  process.exit(1);
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "6mb" }));

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  },
});

const onlineUsers = new Map();

const ALLOWED_AVATARS = new Set([
  "default-1",
  "default-2",
  "default-3",
  "default-4",
  "default-5",
  "default-6",
  "default-7",
  "default-8",
]);

function publicUser(user) {
  return {
    id: user._id.toString(),
    username: user.username,
    email: user.email,
    profilePicture: user.profilePicture || "",
    avatar: user.avatar || "default-1",
  };
}

function tokenFor(user) {
  return jwt.sign(
    { id: user._id.toString() },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function authenticateToken(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Login required.",
    });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);

    req.auth = {
      userId: String(
        payload.id || payload.userId || payload._id || ""
      ),
    };

    if (!mongoose.isValidObjectId(req.auth.userId)) {
      throw new Error("Invalid user ID");
    }

    next();
  } catch (_error) {
    return res.status(401).json({
      success: false,
      message: "Session expire ho gaya. Dobara login karo.",
    });
  }
}

function messageForClient(doc) {
  return {
    id: doc._id.toString(),
    senderId: doc.sender.toString(),
    receiverId: doc.receiver.toString(),
    message: doc.message,
    seen: Boolean(doc.seen),
    seenAt: doc.seenAt || null,
    createdAt: doc.createdAt,
  };
}

function isParticipant(doc, userId) {
  return (
    doc.sender.toString() === userId ||
    doc.receiver.toString() === userId
  );
}

async function isAcceptedConnection(userA, userB) {
  const connection = await ChatRequest.exists({
    status: "accepted",
    $or: [
      { sender: userA, receiver: userB },
      { sender: userB, receiver: userA },
    ],
  });

  return Boolean(connection);
}

function validObjectId(id) {
  return mongoose.isValidObjectId(id);
}

function validImageDataUrl(value) {
  if (
    typeof value !== "string" ||
    value.length > 5 * 1024 * 1024
  ) {
    return false;
  }

  return /^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/.test(
    value
  );
}

// HEALTH CHECK
app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    database:
      mongoose.connection.readyState === 1
        ? "Connected"
        : "Disconnected",
  });
});

// SIGNUP
app.post("/api/auth/signup", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!username || !email || password.length < 8) {
      return res.status(400).json({
        success: false,
        message:
          "Username, valid email aur kam az kam 8-character password required hain.",
      });
    }

    const existing = await User.findOne({
      $or: [{ email }, { username }],
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "Email ya username pehle se registered hai.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const created = await User.create({
      username,
      email,
      password: hashedPassword,
      avatar: "default-1",
      profilePicture: "",
    });

    return res.status(201).json({
      success: true,
      message: "Account created.",
      token: tokenFor(created),
      user: publicUser(created),
    });
  } catch (error) {
    console.error("Signup error:", error);

    return res.status(error.code === 11000 ? 409 : 500).json({
      success: false,
      message:
        error.code === 11000
          ? "Email ya username pehle se registered hai."
          : "Signup failed.",
    });
  }
});

// LOGIN
app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const account = await User.findOne({ email }).select("+password");

    if (
      !account ||
      !(await bcrypt.compare(password, account.password))
    ) {
      return res.status(401).json({
        success: false,
        message: "Email ya password ghalat hai.",
      });
    }

    return res.json({
      success: true,
      token: tokenFor(account),
      user: publicUser(account),
    });
  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      success: false,
      message: "Login failed.",
    });
  }
});

// CURRENT USER
app.get("/api/auth/me", authenticateToken, async (req, res) => {
  try {
    const account = await User.findById(req.auth.userId);

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "User nahi mila.",
      });
    }

    res.json({
      success: true,
      user: publicUser(account),
    });
  } catch (error) {
    console.error("Me error:", error);

    res.status(500).json({
      success: false,
      message: "Profile load nahi hui.",
    });
  }
});

// UPDATE PROFILE PICTURE
app.patch(
  "/api/users/me/profile-picture",
  authenticateToken,
  async (req, res) => {
    try {
      const { profilePicture } = req.body;

      if (!validImageDataUrl(profilePicture)) {
        return res.status(400).json({
          success: false,
          message: "Valid JPG, PNG, WEBP ya GIF image bhejein.",
        });
      }

      const user = await User.findByIdAndUpdate(
        req.auth.userId,
        { profilePicture, avatar: "default-1" },
        { new: true, runValidators: true }
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User nahi mila.",
        });
      }

      io.to(req.auth.userId).emit("profile-updated", {
        user: publicUser(user),
      });

      res.json({
        success: true,
        message: "Profile picture update ho gayi.",
        user: publicUser(user),
      });
    } catch (error) {
      console.error("Profile picture error:", error);

      res.status(500).json({
        success: false,
        message: "Profile picture update nahi hui.",
      });
    }
  }
);

// SELECT DEFAULT AVATAR
app.patch(
  "/api/users/me/avatar",
  authenticateToken,
  async (req, res) => {
    try {
      const { avatar } = req.body;

      if (!ALLOWED_AVATARS.has(avatar)) {
        return res.status(400).json({
          success: false,
          message: "Invalid avatar selected.",
        });
      }

      const user = await User.findByIdAndUpdate(
        req.auth.userId,
        { avatar, profilePicture: "" },
        { new: true, runValidators: true }
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User nahi mila.",
        });
      }

      io.to(req.auth.userId).emit("profile-updated", {
        user: publicUser(user),
      });

      res.json({
        success: true,
        message: "Avatar update ho gaya.",
        user: publicUser(user),
      });
    } catch (error) {
      console.error("Avatar error:", error);

      res.status(500).json({
        success: false,
        message: "Avatar update nahi hua.",
      });
    }
  }
);

// SEARCH USER BY EMAIL
app.get("/api/users/search", authenticateToken, async (req, res) => {
  try {
    const email = String(req.query.email || "")
      .trim()
      .toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Valid email enter karo.",
      });
    }

    const user = await User.findOne({ email }).select(
      "username email profilePicture avatar"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Is email ka user nahi mila.",
      });
    }

    if (user._id.toString() === req.auth.userId) {
      return res.status(400).json({
        success: false,
        message: "Apna email search nahi kar sakte.",
      });
    }

    res.json({
      success: true,
      user: publicUser(user),
    });
  } catch (error) {
    console.error("Email search error:", error);

    res.status(500).json({
      success: false,
      message: "User search nahi ho saka.",
    });
  }
});

// ACCEPTED CONTACTS
app.get("/api/users", authenticateToken, async (req, res) => {
  try {
    const currentId = req.auth.userId;

    const connections = await ChatRequest.find({
      status: "accepted",
      $or: [{ sender: currentId }, { receiver: currentId }],
    }).select("sender receiver");

    const contactIds = [
      ...new Set(
        connections.map((connection) =>
          connection.sender.toString() === currentId
            ? connection.receiver.toString()
            : connection.sender.toString()
        )
      ),
    ];

    const people = await User.find({
      _id: { $in: contactIds },
    })
      .select("username email profilePicture avatar")
      .sort({ username: 1 });

    res.json({
      success: true,
      users: people.map((person) => ({
        ...publicUser(person),
        online: (onlineUsers.get(person._id.toString()) || 0) > 0,
      })),
    });
  } catch (error) {
    console.error("Contacts error:", error);

    res.status(500).json({
      success: false,
      message: "Contacts load nahi hue.",
    });
  }
});

// SEND CHAT REQUEST
app.post(
  "/api/requests/:userId",
  authenticateToken,
  async (req, res) => {
    try {
      const senderId = req.auth.userId;
      const receiverId = req.params.userId;

      if (!validObjectId(receiverId) || receiverId === senderId) {
        return res.status(400).json({
          success: false,
          message: "Receiver ID valid nahi hai.",
        });
      }

      const receiver = await User.findById(receiverId).select(
        "username email profilePicture avatar"
      );

      if (!receiver) {
        return res.status(404).json({
          success: false,
          message: "User nahi mila.",
        });
      }

      if (await isAcceptedConnection(senderId, receiverId)) {
        return res.json({
          success: true,
          connected: true,
          message: "Aap pehle se connected hain.",
        });
      }

      const pending = await ChatRequest.findOne({
        status: "pending",
        $or: [
          { sender: senderId, receiver: receiverId },
          { sender: receiverId, receiver: senderId },
        ],
      });

      if (pending) {
        return res.status(409).json({
          success: false,
          message:
            pending.sender.toString() === senderId
              ? "Request pehle hi bheji ja chuki hai."
              : "Is user ki request aapke paas pending hai.",
        });
      }

      const request = await ChatRequest.create({
        sender: senderId,
        receiver: receiverId,
        status: "pending",
      });

      const sender = await User.findById(senderId).select("username");

      io.to(receiverId).emit("chat-request-received", {
        id: request._id.toString(),
        sender: {
          id: senderId,
          username: sender?.username || "User",
        },
      });

      res.status(201).json({
        success: true,
        message: "Chat request bhej di gayi.",
        request: {
          id: request._id.toString(),
          status: request.status,
          receiver: publicUser(receiver),
        },
      });
    } catch (error) {
      console.error("Send request error:", error);

      res.status(500).json({
        success: false,
        message: "Request send nahi hui.",
      });
    }
  }
);

// GET INCOMING AND OUTGOING REQUESTS
app.get("/api/requests", authenticateToken, async (req, res) => {
  try {
    const currentId = req.auth.userId;

    const [incomingDocs, outgoingDocs] = await Promise.all([
      ChatRequest.find({
        receiver: currentId,
        status: "pending",
      })
        .populate("sender", "username email profilePicture avatar")
        .sort({ createdAt: -1 }),

      ChatRequest.find({
        sender: currentId,
        status: "pending",
      })
        .populate("receiver", "username email profilePicture avatar")
        .sort({ createdAt: -1 }),
    ]);

    res.json({
      success: true,
      incoming: incomingDocs.map((request) => ({
        id: request._id.toString(),
        status: request.status,
        createdAt: request.createdAt,
        user: request.sender ? publicUser(request.sender) : null,
      })),
      outgoing: outgoingDocs.map((request) => ({
        id: request._id.toString(),
        status: request.status,
        createdAt: request.createdAt,
        user: request.receiver ? publicUser(request.receiver) : null,
      })),
    });
  } catch (error) {
    console.error("Load requests error:", error);

    res.status(500).json({
      success: false,
      message: "Requests load nahi huin.",
    });
  }
});

// ACCEPT OR REJECT REQUEST
app.patch(
  "/api/requests/:requestId",
  authenticateToken,
  async (req, res) => {
    try {
      const { requestId } = req.params;
      const currentId = req.auth.userId;
      const status = String(req.body.status || "").toLowerCase();

      if (!validObjectId(requestId)) {
        return res.status(400).json({
          success: false,
          message: "Request ID valid nahi hai.",
        });
      }

      if (!["accepted", "rejected"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Status "accepted" ya "rejected" hona chahiye.',
        });
      }

      const request = await ChatRequest.findOne({
        _id: requestId,
        receiver: currentId,
        status: "pending",
      });

      if (!request) {
        return res.status(404).json({
          success: false,
          message: "Pending incoming request nahi mili.",
        });
      }

      request.status = status;
      await request.save();

      const senderId = request.sender.toString();

      io.to(senderId).emit("chat-request-updated", {
        id: request._id.toString(),
        status,
        userId: currentId,
      });

      io.to(currentId).emit("chat-request-updated", {
        id: request._id.toString(),
        status,
        userId: senderId,
      });

      res.json({
        success: true,
        message:
          status === "accepted"
            ? "Request accept ho gayi. Ab aap chat kar sakte hain."
            : "Request reject ho gayi.",
        request: {
          id: request._id.toString(),
          senderId,
          receiverId: currentId,
          status,
        },
      });
    } catch (error) {
      console.error("Update request error:", error);

      res.status(500).json({
        success: false,
        message: "Request update nahi hui.",
      });
    }
  }
);

// LOAD MESSAGES
app.get(
  "/api/messages/:userId",
  authenticateToken,
  async (req, res) => {
    try {
      const currentId = req.auth.userId;
      const otherId = req.params.userId;

      if (!validObjectId(otherId) || otherId === currentId) {
        return res.status(400).json({
          success: false,
          message: "Invalid user ID.",
        });
      }

      if (!(await isAcceptedConnection(currentId, otherId))) {
        return res.status(403).json({
          success: false,
          message: "Chat ke liye pehle request accept honi chahiye.",
        });
      }

      const docs = await Message.find({
        $or: [
          { sender: currentId, receiver: otherId },
          { sender: otherId, receiver: currentId },
        ],
        deletedFor: { $ne: currentId },
      }).sort({ createdAt: 1 });

      // Incoming unread messages ko read mark karein.
      const unreadIds = docs
        .filter(
          (doc) =>
            doc.receiver.toString() === currentId &&
            !doc.seen
        )
        .map((doc) => doc._id);

      if (unreadIds.length) {
        await Message.updateMany(
          { _id: { $in: unreadIds } },
          { $set: { seen: true, seenAt: new Date() } }
        );

        io.to(otherId).emit("messages-read", {
          readerId: currentId,
          messageIds: unreadIds.map((id) => id.toString()),
        });

        for (const doc of docs) {
          if (unreadIds.some((id) => id.equals(doc._id))) {
            doc.seen = true;
            doc.seenAt = new Date();
          }
        }
      }

      res.json({
        success: true,
        messages: docs.map(messageForClient),
      });
    } catch (error) {
      console.error("Load messages error:", error);

      res.status(500).json({
        success: false,
        message: "Messages load nahi hue.",
      });
    }
  }
);

// DELETE MESSAGE FOR ME
app.delete(
  "/api/messages/:messageId/for-me",
  authenticateToken,
  async (req, res) => {
    try {
      const { messageId } = req.params;

      if (!validObjectId(messageId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid message ID.",
        });
      }

      const doc = await Message.findById(messageId);

      if (!doc) {
        return res.status(404).json({
          success: false,
          message: "Message nahi mila.",
        });
      }

      if (!isParticipant(doc, req.auth.userId)) {
        return res.status(403).json({
          success: false,
          message: "Not allowed.",
        });
      }

      await Message.updateOne(
        { _id: doc._id },
        { $addToSet: { deletedFor: req.auth.userId } }
      );

      res.json({
        success: true,
        message: "Message sirf aapki side se hide ho gaya.",
      });
    } catch (error) {
      console.error("Delete for me error:", error);

      res.status(500).json({
        success: false,
        message: "Message delete nahi hua.",
      });
    }
  }
);

// DELETE MESSAGE FOR EVERYONE
app.delete(
  "/api/messages/:messageId/for-everyone",
  authenticateToken,
  async (req, res) => {
    try {
      const { messageId } = req.params;

      if (!validObjectId(messageId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid message ID.",
        });
      }

      const doc = await Message.findById(messageId);

      if (!doc) {
        return res.status(404).json({
          success: false,
          message: "Message nahi mila.",
        });
      }

      if (doc.sender.toString() !== req.auth.userId) {
        return res.status(403).json({
          success: false,
          message: "Sirf sender message sab ke liye delete kar sakta hai.",
        });
      }

      const senderId = doc.sender.toString();
      const receiverId = doc.receiver.toString();
      const id = doc._id.toString();

      await Message.deleteOne({ _id: doc._id });

      io.to(senderId)
        .to(receiverId)
        .emit("message-deleted-everyone", {
          id,
          senderId,
          receiverId,
        });

      res.json({
        success: true,
        message: "Message dono taraf se delete ho gaya.",
      });
    } catch (error) {
      console.error("Delete for everyone error:", error);

      res.status(500).json({
        success: false,
        message: "Message delete nahi hua.",
      });
    }
  }
);

// CLEAR CONVERSATION FOR ME
app.delete(
  "/api/conversations/:userId",
  authenticateToken,
  async (req, res) => {
    try {
      const currentId = req.auth.userId;
      const otherId = req.params.userId;

      if (!validObjectId(otherId) || otherId === currentId) {
        return res.status(400).json({
          success: false,
          message: "Invalid conversation.",
        });
      }

      if (!(await isAcceptedConnection(currentId, otherId))) {
        return res.status(403).json({
          success: false,
          message: "Accepted connection required.",
        });
      }

      await Message.updateMany(
        {
          $or: [
            { sender: currentId, receiver: otherId },
            { sender: otherId, receiver: currentId },
          ],
        },
        { $addToSet: { deletedFor: currentId } }
      );

      io.to(currentId).emit("conversation-deleted-for-me", {
        otherUserId: otherId,
      });

      res.json({
        success: true,
        message: "Conversation aapki side se clear ho gayi.",
      });
    } catch (error) {
      console.error("Delete conversation error:", error);

      res.status(500).json({
        success: false,
        message: "Conversation clear nahi hui.",
      });
    }
  }
);

// SOCKET.IO AUTHENTICATION
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Authentication required"));
    }

    const payload = jwt.verify(token, JWT_SECRET);
    const userId = String(
      payload.id || payload.userId || payload._id || ""
    );

    if (!validObjectId(userId)) {
      return next(new Error("Invalid token"));
    }

    socket.userId = userId;
    next();
  } catch (_error) {
    next(new Error("Invalid or expired token"));
  }
});

// SOCKET EVENTS
io.on("connection", (socket) => {
  const userId = socket.userId;

  socket.join(userId);
  onlineUsers.set(userId, (onlineUsers.get(userId) || 0) + 1);

  const broadcastOnline = () => {
    const online = [...onlineUsers.entries()]
      .filter(([, count]) => count > 0)
      .map(([id]) => ({ id }));

    io.emit("online-users", online);
  };

  broadcastOnline();

  socket.on("typing", ({ receiverId } = {}) => {
    if (!receiverId || !validObjectId(receiverId)) return;

    socket.to(receiverId).emit("user-typing", {
      userId,
    });
  });

  socket.on("stop-typing", ({ receiverId } = {}) => {
    if (!receiverId || !validObjectId(receiverId)) return;

    socket.to(receiverId).emit("user-stop-typing", {
      userId,
    });
  });

  // SEND PRIVATE MESSAGE
  socket.on(
    "private-message",
    async (payload = {}, acknowledge = () => {}) => {
      try {
        const receiverId = String(payload.receiverId || "");
        const messageText = String(payload.message || "").trim();

        if (!validObjectId(receiverId) || receiverId === userId) {
          return acknowledge({
            success: false,
            message: "Receiver ID invalid hai.",
          });
        }

        if (!messageText || messageText.length > 5000) {
          return acknowledge({
            success: false,
            message: "Message empty ya bohat lamba hai.",
          });
        }

        if (!(await User.exists({ _id: receiverId }))) {
          return acknowledge({
            success: false,
            message: "User nahi mila.",
          });
        }

        if (!(await isAcceptedConnection(userId, receiverId))) {
          return acknowledge({
            success: false,
            message: "Pehle chat request accept honi chahiye.",
          });
        }

        const saved = await Message.create({
          sender: userId,
          receiver: receiverId,
          message: messageText,
          seen: false,
          seenAt: null,
        });

        const outgoing = messageForClient(saved);

        io.to(userId).to(receiverId).emit("private-message", outgoing);

        acknowledge({
          success: true,
          message: outgoing,
        });
      } catch (error) {
        console.error("Socket message error:", error);

        acknowledge({
          success: false,
          message: "Message save/send nahi hua.",
        });
      }
    }
  );

  // MARK MESSAGES AS READ
  socket.on(
    "mark-messages-seen",
    async ({ senderId } = {}, acknowledge = () => {}) => {
      try {
        if (
          !senderId ||
          !validObjectId(senderId) ||
          senderId === userId
        ) {
          return acknowledge({
            success: false,
            message: "Sender ID invalid hai.",
          });
        }

        if (!(await isAcceptedConnection(userId, senderId))) {
          return acknowledge({
            success: false,
            message: "Accepted connection required.",
          });
        }

        const unread = await Message.find({
          sender: senderId,
          receiver: userId,
          seen: { $ne: true },
          deletedFor: { $ne: userId },
        }).select("_id");

        if (!unread.length) {
          return acknowledge({
            success: true,
            messageIds: [],
          });
        }

        const messageIds = unread.map((doc) => doc._id.toString());

        await Message.updateMany(
          { _id: { $in: unread.map((doc) => doc._id) } },
          { $set: { seen: true, seenAt: new Date() } }
        );

        io.to(senderId).emit("messages-read", {
          readerId: userId,
          messageIds,
        });

        acknowledge({
          success: true,
          messageIds,
        });
      } catch (error) {
        console.error("Mark messages seen error:", error);

        acknowledge({
          success: false,
          message: "Read status update nahi hua.",
        });
      }
    }
  );

  socket.on("disconnect", () => {
    const count = Math.max(
      (onlineUsers.get(userId) || 1) - 1,
      0
    );

    if (count === 0) {
      onlineUsers.delete(userId);
    } else {
      onlineUsers.set(userId, count);
    }

    broadcastOnline();
  });
});

// START SERVER
async function startServer() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB Connected Successfully!");

    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Server startup error:", error.message);
    process.exit(1);
  }
}

startServer();