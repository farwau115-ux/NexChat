import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import {
  MessageCircle,
  Send,
  LogOut,
  Users,
  LockKeyhole,
  Mail,
  UserRound,
  LoaderCircle,
  ArrowRight,
  ShieldCheck,
  MoreVertical,
  Trash2,
  X,
  Search,
  UserPlus,
  Check,
  CheckCheck,
  UserX,
  RefreshCw,
  Camera,
} from "lucide-react";

import "./App.css";
import "./ChatFeatures.css";
import "./NexChat-UI-Overrides.css";

const API = "http://localhost:8000";

const authHeaders = (token) => ({
  headers: { Authorization: `Bearer ${token}` },
});

const getId = (item) => item?.id || item?._id || "";

const getPicture = (person) =>
  person?.profilePicture || person?.avatar || "";

function Avatar({ person, className = "avatar" }) {
  const picture = getPicture(person);
  const username = person?.username || "?";

  return (
    <div className={className}>
      {picture ? (
        <img
          src={picture}
          alt={`${username}'s profile`}
          className="profile-picture"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : (
        username.charAt(0).toUpperCase()
      )}
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState("login");

  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
  });

  const [user, setUser] = useState(null);
  const [token, setToken] = useState("");

  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState({});
  const [message, setMessage] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [menuMessageId, setMenuMessageId] = useState(null);

  const [searchEmail, setSearchEmail] = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);

  const [incomingRequests, setIncomingRequests] = useState([]);
  const [outgoingRequests, setOutgoingRequests] = useState([]);
  const [requestActionId, setRequestActionId] = useState("");
  const [sidebarTab, setSidebarTab] = useState("chats");

  const [typingUsers, setTypingUsers] = useState([]);

  const [profilePicture, setProfilePicture] = useState("");
  const [profileUploading, setProfileUploading] = useState(false);

  const typingTimeoutRef = useRef(null);
  const remoteTypingTimeoutsRef = useRef({});
  const socketRef = useRef(null);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  const currentMessages = selected
    ? messages[selected.id] || []
    : [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages, selected, typingUsers]);

  // Keep the picture in sync with the logged-in user.
  useEffect(() => {
    setProfilePicture(getPicture(user));
  }, [user]);

  // Load contacts.
  async function loadUsers() {
    if (!token) return;

    try {
      const { data } = await axios.get(
        `${API}/api/users`,
        authHeaders(token)
      );

      setUsers(data.users || []);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Contacts load nahi huay."
      );
    }
  }

  // Load chat requests.
  async function loadRequests() {
    if (!token) return;

    try {
      const { data } = await axios.get(
        `${API}/api/requests`,
        authHeaders(token)
      );

      setIncomingRequests(data.incoming || []);
      setOutgoingRequests(data.outgoing || []);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Requests load nahi huin."
      );
    }
  }

  useEffect(() => {
    if (!token || !user) return;

    loadUsers();
    loadRequests();
  }, [token, user]);

  // Socket.IO.
  useEffect(() => {
    if (!token || !user) return undefined;

    const socket = io(API, {
      auth: { token },
    });

    socketRef.current = socket;

    const handlePrivateMessage = (msg) => {
      const senderId = msg.senderId;
      const receiverId = msg.receiverId;

      const chatId =
        senderId === user.id ? receiverId : senderId;

      if (!chatId) return;

      setMessages((prev) => {
        const current = prev[chatId] || [];

        const messageId = getId(msg);

        const existingIndex = current.findIndex(
          (item) => getId(item) === messageId
        );

        if (existingIndex !== -1) {
          const updated = [...current];
          updated[existingIndex] = {
            ...updated[existingIndex],
            ...msg,
          };

          return {
            ...prev,
            [chatId]: updated,
          };
        }

        return {
          ...prev,
          [chatId]: [...current, msg].sort(
            (a, b) =>
              new Date(a.createdAt) -
              new Date(b.createdAt)
          ),
        };
      });

      // If a message arrives from the person whose chat is open,
      // notify the backend that this conversation has been viewed.
      if (
        senderId !== user.id &&
        selected?.id === senderId
      ) {
        socket.emit("mark-messages-seen", {
          senderId,
          conversationId: senderId,
        });
      }
    };

    const handleUserTyping = ({ userId } = {}) => {
      if (!userId || userId === user.id) return;

      setTypingUsers((prev) =>
        prev.includes(userId) ? prev : [...prev, userId]
      );

      if (remoteTypingTimeoutsRef.current[userId]) {
        clearTimeout(remoteTypingTimeoutsRef.current[userId]);
      }

      remoteTypingTimeoutsRef.current[userId] =
        setTimeout(() => {
          setTypingUsers((prev) =>
            prev.filter((id) => id !== userId)
          );

          delete remoteTypingTimeoutsRef.current[userId];
        }, 3000);
    };

    const handleUserStopTyping = ({ userId } = {}) => {
      if (!userId) return;

      if (remoteTypingTimeoutsRef.current[userId]) {
        clearTimeout(remoteTypingTimeoutsRef.current[userId]);
        delete remoteTypingTimeoutsRef.current[userId];
      }

      setTypingUsers((prev) =>
        prev.filter((id) => id !== userId)
      );
    };

    const handleMessagesRead = ({
      readerId,
      senderId,
      messageIds,
    } = {}) => {
      const chatId =
        readerId === user.id ? senderId : readerId;

      if (!chatId) return;

      setMessages((prev) => ({
        ...prev,
        [chatId]: (prev[chatId] || []).map((item) => {
          const matches =
            !Array.isArray(messageIds) ||
            messageIds.length === 0 ||
            messageIds.includes(getId(item));

          if (
            item.senderId === user.id &&
            matches
          ) {
            return {
              ...item,
              seen: true,
              seenAt: new Date().toISOString(),
            };
          }

          return item;
        }),
      }));
    };

    socket.on("private-message", handlePrivateMessage);
    socket.on("user-typing", handleUserTyping);
    socket.on("user-stop-typing", handleUserStopTyping);
    socket.on("messages-read", handleMessagesRead);

    socket.on("message-deleted-everyone", ({ id }) => {
      setMessages((prev) => {
        const next = {};

        for (const [chatId, list] of Object.entries(prev)) {
          next[chatId] = list.filter(
            (item) => getId(item) !== id
          );
        }

        return next;
      });

      setMenuMessageId(null);
    });

    socket.on(
      "conversation-deleted-for-me",
      ({ otherUserId }) => {
        if (otherUserId) {
          setMessages((prev) => ({
            ...prev,
            [otherUserId]: [],
          }));
        }
      }
    );

    socket.on("online-users", (online) => {
      setUsers((prev) =>
        prev.map((person) => ({
          ...person,
          online: online.some(
            (item) => getId(item) === getId(person)
          ),
        }))
      );
    });

    socket.on("chat-request-received", loadRequests);

    socket.on("chat-request-updated", () => {
      loadRequests();
      loadUsers();
    });

    socket.on("connect_error", (err) => {
      setError(err.message || "Chat connection failed.");
    });

    return () => {
      socket.off("private-message", handlePrivateMessage);
      socket.off("user-typing", handleUserTyping);
      socket.off("user-stop-typing", handleUserStopTyping);
      socket.off("messages-read", handleMessagesRead);
      socket.disconnect();

      if (socketRef.current === socket) {
        socketRef.current = null;
      }

      Object.values(remoteTypingTimeoutsRef.current).forEach(
        (timer) => clearTimeout(timer)
      );

      remoteTypingTimeoutsRef.current = {};
    };
  }, [token, user, selected?.id]);

  // Stop typing when switching chats.
  useEffect(() => {
    setTypingUsers([]);

    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }

      if (selected?.id && socketRef.current?.connected) {
        socketRef.current.emit("stop-typing", {
          receiverId: selected.id,
        });
      }
    };
  }, [selected?.id]);

  // Load conversation history.
  useEffect(() => {
    if (!token || !user || !selected?.id) {
      return undefined;
    }

    let active = true;

    setHistoryLoading(true);
    setError("");

    axios
      .get(
        `${API}/api/messages/${selected.id}`,
        authHeaders(token)
      )
      .then(({ data }) => {
        if (!active) return;

        const history = data.messages || [];

        setMessages((prev) => {
          const existing = prev[selected.id] || [];
          const byId = new Map();

          [...history, ...existing].forEach((item) => {
            byId.set(getId(item), item);
          });

          return {
            ...prev,
            [selected.id]: [...byId.values()].sort(
              (a, b) =>
                new Date(a.createdAt) -
                new Date(b.createdAt)
            ),
          };
        });

        // Mark incoming messages as read when opening the chat.
        if (socketRef.current?.connected) {
          socketRef.current.emit("mark-messages-seen", {
            senderId: selected.id,
            conversationId: selected.id,
          });
        }
      })
      .catch((err) => {
        if (active) {
          setError(
            err.response?.data?.message ||
              "Purani chat load nahi hui."
          );
        }
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token, user, selected?.id]);

  function updateField(event) {
    setForm((prev) => ({
      ...prev,
      [event.target.name]: event.target.value,
    }));
  }

  // Login and signup.
  async function submitAuth(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const endpoint =
        mode === "signup" ? "signup" : "login";

      const payload =
        mode === "signup"
          ? {
              username: form.username.trim(),
              email: form.email.trim().toLowerCase(),
              password: form.password,
            }
          : {
              email: form.email.trim().toLowerCase(),
              password: form.password,
            };

      const { data } = await axios.post(
        `${API}/api/auth/${endpoint}`,
        payload
      );

      if (mode === "signup") {
        setMode("login");

        setForm({
          username: "",
          email: form.email,
          password: "",
        });

        setError(
          "Account created successfully! Ab login karo."
        );
      } else {
        setToken(data.token);
        setUser(data.user);
        setProfilePicture(getPicture(data.user));
        setError("");
      }
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Request failed. Backend check karo."
      );
    } finally {
      setLoading(false);
    }
  }

  // Search user by email.
  async function searchUser(event) {
    event.preventDefault();
    setError("");
    setSearchResult(null);

    const email = searchEmail.trim().toLowerCase();

    if (!email) {
      setError("Pehle user ka email enter karo.");
      return;
    }

    setSearchLoading(true);

    try {
      const { data } = await axios.get(
        `${API}/api/users/search`,
        {
          ...authHeaders(token),
          params: { email },
        }
      );

      const found = data.user || data;
      const foundId = getId(found);

      if (!foundId) {
        setError("Search response mein user ID nahi mili.");
      } else if (foundId === user.id) {
        setError("Ye tumhara apna account hai!");
      } else {
        setSearchResult(found);
      }
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "User nahi mila. Email check karo."
      );
    } finally {
      setSearchLoading(false);
    }
  }

  // Send chat request.
  async function sendRequest() {
    if (!searchResult) return;

    const targetId = getId(searchResult);
    setRequestActionId(targetId);
    setError("");

    try {
      const { data } = await axios.post(
        `${API}/api/requests/${targetId}`,
        {},
        authHeaders(token)
      );

      setError(data.message || "Chat request send ho gayi!");
      setSearchResult(null);
      setSearchEmail("");

      await loadRequests();
      await loadUsers();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Request send nahi hui."
      );
    } finally {
      setRequestActionId("");
    }
  }

  // Accept or reject a request.
  async function respondToRequest(request, status) {
    const requestId = getId(request);

    setRequestActionId(requestId);
    setError("");

    try {
      const { data } = await axios.patch(
        `${API}/api/requests/${requestId}`,
        { status },
        authHeaders(token)
      );

      setError(
        data.message ||
          (status === "accepted"
            ? "Request accept ho gayi!"
            : "Request reject ho gayi.")
      );

      await loadRequests();
      await loadUsers();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Request update nahi hui."
      );
    } finally {
      setRequestActionId("");
    }
  }

  function openContact(person) {
    setSelected({
      ...person,
      id: getId(person),
    });

    setError("");
    setMenuMessageId(null);
    setMessage("");
  }

  // Upload profile picture.
  async function uploadProfilePicture(event) {
    const file = event.target.files?.[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Sirf image file select karo.");
      event.target.value = "";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("Image 5 MB se chhoti honi chahiye.");
      event.target.value = "";
      return;
    }

    const formData = new FormData();
    formData.append("profilePicture", file);
    formData.append("avatar", file);

    setProfileUploading(true);
    setError("");

    try {
      // This endpoint must exist in server.js.
      const { data } = await axios.put(
        `${API}/api/users/me/profile-picture`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "multipart/form-data",
          },
        }
      );

      const updatedUser =
        data.user || data;

      const picture =
        updatedUser.profilePicture ||
        updatedUser.avatar ||
        data.profilePicture ||
        data.avatar ||
        "";

      if (!picture) {
        setError(
          "Picture upload hui, lekin response mein image URL nahi mili."
        );
      } else {
        setProfilePicture(picture);

        setUser((prev) => ({
          ...prev,
          ...updatedUser,
          profilePicture: picture,
          avatar: picture,
        }));

        setUsers((prev) =>
          prev.map((person) =>
            getId(person) === getId(user)
              ? {
                  ...person,
                  profilePicture: picture,
                  avatar: picture,
                }
              : person
          )
        );

        setError("Profile picture update ho gayi!");
      }
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Picture upload nahi hui. Server endpoint aur upload setup check karo."
      );
    } finally {
      setProfileUploading(false);
      event.target.value = "";
    }
  }

  function logout() {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    if (selected?.id && socketRef.current?.connected) {
      socketRef.current.emit("stop-typing", {
        receiverId: selected.id,
      });
    }

    socketRef.current?.disconnect();

    setToken("");
    setUser(null);
    setUsers([]);
    setSelected(null);
    setMessages({});
    setMessage("");
    setMenuMessageId(null);
    setTypingUsers([]);
    setProfilePicture("");

    setSearchEmail("");
    setSearchResult(null);
    setIncomingRequests([]);
    setOutgoingRequests([]);

    setForm({
      username: "",
      email: "",
      password: "",
    });

    setError("");
  }

  // Typing indicator.
  function handleMessageInput(value) {
    setMessage(value);

    if (!selected?.id || !socketRef.current?.connected) {
      return;
    }

    if (!value.trim()) {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }

      socketRef.current.emit("stop-typing", {
        receiverId: selected.id,
      });

      return;
    }

    socketRef.current.emit("typing", {
      receiverId: selected.id,
    });

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    const receiverId = selected.id;

    typingTimeoutRef.current = setTimeout(() => {
      socketRef.current?.emit("stop-typing", {
        receiverId,
      });

      typingTimeoutRef.current = null;
    }, 1200);
  }

  function stopTyping(receiverId = selected?.id) {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    if (receiverId && socketRef.current?.connected) {
      socketRef.current.emit("stop-typing", {
        receiverId,
      });
    }
  }

  // Send message.
  function sendMessage(event) {
    event.preventDefault();

    if (
      !message.trim() ||
      !selected ||
      !socketRef.current?.connected
    ) {
      setError(
        "Chat connected nahi hai ya message empty hai."
      );
      return;
    }

    const messageText = message.trim();
    const receiverId = selected.id;

    stopTyping(receiverId);
    setError("");

    socketRef.current.emit(
      "private-message",
      {
        receiverId,
        message: messageText,
      },
      (result) => {
        if (!result?.success) {
          setError(
            result?.message || "Message send nahi hua."
          );
        }
      }
    );

    setMessage("");
  }

  // Delete message for current user.
  async function deleteMessageForMe(msg) {
    if (
      !window.confirm(
        "Ye message sirf aapki chat se delete hoga. Continue?"
      )
    ) {
      return;
    }

    try {
      await axios.delete(
        `${API}/api/messages/${getId(msg)}/for-me`,
        authHeaders(token)
      );

      const chatId =
        msg.senderId === user.id
          ? msg.receiverId
          : msg.senderId;

      setMessages((prev) => ({
        ...prev,
        [chatId]: (prev[chatId] || []).filter(
          (item) => getId(item) !== getId(msg)
        ),
      }));

      setMenuMessageId(null);
      setError("");
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Message delete nahi hua."
      );
    }
  }

  // Delete sender's message for both users.
  async function deleteMessageForEveryone(msg) {
    if (msg.senderId !== user.id) return;

    if (
      !window.confirm(
        "Ye message dono users ki chat se permanently delete hoga. Continue?"
      )
    ) {
      return;
    }

    try {
      await axios.delete(
        `${API}/api/messages/${getId(msg)}/for-everyone`,
        authHeaders(token)
      );

      setMessages((prev) => {
        const next = {};

        for (const [chatId, list] of Object.entries(prev)) {
          next[chatId] = list.filter(
            (item) => getId(item) !== getId(msg)
          );
        }

        return next;
      });

      setMenuMessageId(null);
      setError("");
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Message delete nahi hua."
      );
    }
  }

  // Clear conversation for this user only.
  async function deleteConversation() {
    if (!selected) return;

    if (
      !window.confirm(
        `${selected.username} ke saath poori chat sirf aapki side se clear kar dein?`
      )
    ) {
      return;
    }

    try {
      await axios.delete(
        `${API}/api/conversations/${selected.id}`,
        authHeaders(token)
      );

      setMessages((prev) => ({
        ...prev,
        [selected.id]: [],
      }));

      setMenuMessageId(null);
      setError("");
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Chat clear nahi hui."
      );
    }
  }

  // Authentication screen.
  if (!user) {
    return (
      <main className="auth-page">
        <div className="auth-glow glow-one" />
        <div className="auth-glow glow-two" />

        <section className="auth-card">
          <div className="brand">
            <div className="brand-icon">
              <MessageCircle size={25} />
            </div>

            <span>
              nex<span className="accent">chat</span>
            </span>
          </div>

          <div className="auth-badge">
            <span className="status-dot" />
            PRIVATE MESSAGING
          </div>

          <h1>
            {mode === "login"
              ? "Welcome back."
              : "Join the conversation."}
          </h1>

          <p className="auth-subtitle">
            {mode === "login"
              ? "Sign in to continue your conversations."
              : "Create your account and start connecting."}
          </p>

          <form className="auth-form" onSubmit={submitAuth}>
            {mode === "signup" && (
              <label className="field">
                <span>Name</span>

                <div className="input-wrap">
                  <UserRound size={18} />

                  <input
                    name="username"
                    placeholder="Your name"
                    value={form.username}
                    onChange={updateField}
                    maxLength={40}
                    required
                  />
                </div>
              </label>
            )}

            <label className="field">
              <span>Email address</span>

              <div className="input-wrap">
                <Mail size={18} />

                <input
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={updateField}
                  required
                />
              </div>
            </label>

            <label className="field">
              <span>Password</span>

              <div className="input-wrap">
                <LockKeyhole size={18} />

                <input
                  name="password"
                  type="password"
                  placeholder="At least 8 characters"
                  value={form.password}
                  onChange={updateField}
                  minLength={8}
                  required
                />
              </div>
            </label>

            {error && <div className="notice">{error}</div>}

            <button
              className="primary-btn"
              disabled={loading}
              type="submit"
            >
              {loading ? (
                <LoaderCircle className="spin" size={19} />
              ) : (
                <>
                  {mode === "login"
                    ? "Sign in"
                    : "Create account"}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          <p className="switch-auth">
            {mode === "login"
              ? "New to Nexchat?"
              : "Already have an account?"}

            <button
              type="button"
              onClick={() => {
                setMode(
                  mode === "login" ? "signup" : "login"
                );
                setError("");
              }}
            >
              {mode === "login"
                ? " Create account"
                : " Sign in"}
            </button>
          </p>

          <div className="secure-note">
            <ShieldCheck size={15} />
            Secure authentication · Private accounts
          </div>
        </section>

        <p className="page-foot">
          BUILT FOR BETTER CONVERSATIONS
        </p>
      </main>
    );
  }

  // Main chat application.
  return (
    <main className="chat-app">
      <aside className="sidebar">
        <div className="brand sidebar-brand">
          <div className="brand-icon">
            <MessageCircle size={23} />
          </div>

          <span>
            nex<span className="accent">chat</span>
          </span>
        </div>

        <div className="sidebar-heading">
          <span>FIND PEOPLE</span>
          <Search size={16} />
        </div>

        <form className="search-user-form" onSubmit={searchUser}>
          <input
            type="email"
            value={searchEmail}
            onChange={(event) => {
              setSearchEmail(event.target.value);
              setSearchResult(null);
            }}
            placeholder="Enter user's email"
            aria-label="Search user by email"
            required
          />

          <button
            type="submit"
            disabled={searchLoading}
            title="Search user"
          >
            {searchLoading ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <Search size={18} />
            )}
          </button>
        </form>

        {searchResult && (
          <div className="search-result-card">
            <Avatar person={searchResult} />

            <div className="contact-info">
              <strong>{searchResult.username}</strong>
              <span>{searchResult.email}</span>
            </div>

            <button
              className="request-send-btn"
              onClick={sendRequest}
              disabled={Boolean(requestActionId)}
              title="Send chat request"
            >
              {requestActionId === getId(searchResult) ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <UserPlus size={17} />
              )}
            </button>
          </div>
        )}

        <div
          className="sidebar-tabs"
          role="tablist"
          aria-label="Sidebar sections"
        >
          <button
            type="button"
            role="tab"
            aria-selected={sidebarTab === "chats"}
            className={`sidebar-tab ${
              sidebarTab === "chats" ? "active" : ""
            }`}
            onClick={() => setSidebarTab("chats")}
          >
            <MessageCircle size={16} />
            <span>Chats</span>
            <span className="tab-count">
              {users.filter(
                (person) => getId(person) !== getId(user)
              ).length}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={sidebarTab === "requests"}
            className={`sidebar-tab ${
              sidebarTab === "requests" ? "active" : ""
            }`}
            onClick={() => setSidebarTab("requests")}
          >
            <UserPlus size={16} />
            <span>Requests</span>

            {incomingRequests.length + outgoingRequests.length > 0 && (
              <span className="tab-count request-count">
                {incomingRequests.length + outgoingRequests.length}
              </span>
            )}
          </button>
        </div>

        <div className="sidebar-content">
          {sidebarTab === "requests" ? (
            <div className="requests-panel">
              <div className="sidebar-section-title">
                <span>INCOMING</span>

                <div className="section-title-actions">
                  <span className="section-count">
                    {incomingRequests.length}
                  </span>

                  <button
                    className="small-refresh"
                    type="button"
                    onClick={() => {
                      loadRequests();
                      loadUsers();
                    }}
                    title="Refresh requests"
                    aria-label="Refresh requests"
                  >
                    <RefreshCw size={14} />
                  </button>
                </div>
              </div>

              <div className="request-list">
                {incomingRequests.map((request) => {
                  const sender = request.user || {};
                  const requestId = getId(request);

                  return (
                    <div className="request-card" key={requestId}>
                      <Avatar person={sender} />

                      <div className="contact-info">
                        <strong>{sender.username || "New user"}</strong>
                        <span>Wants to connect</span>
                      </div>

                      <button
                        className="request-accept-btn"
                        title="Accept request"
                        aria-label={`Accept ${sender.username || "user"}'s request`}
                        disabled={requestActionId === requestId}
                        onClick={() =>
                          respondToRequest(request, "accepted")
                        }
                      >
                        {requestActionId === requestId ? (
                          <LoaderCircle className="spin" size={16} />
                        ) : (
                          <Check size={16} />
                        )}
                      </button>

                      <button
                        className="request-reject-btn"
                        title="Reject request"
                        aria-label={`Reject ${sender.username || "user"}'s request`}
                        disabled={requestActionId === requestId}
                        onClick={() =>
                          respondToRequest(request, "rejected")
                        }
                      >
                        <UserX size={16} />
                      </button>
                    </div>
                  );
                })}

                {incomingRequests.length === 0 && (
                  <div className="request-empty">
                    <UserPlus size={20} />
                    <span>No incoming requests</span>
                  </div>
                )}
              </div>

              <div className="sidebar-section-title sent-title">
                <span>SENT REQUESTS</span>
                <span className="section-count">
                  {outgoingRequests.length}
                </span>
              </div>

              <div className="request-list">
                {outgoingRequests.map((request) => {
                  const receiver = request.user || {};

                  return (
                    <div
                      className="request-card sent-request-card"
                      key={getId(request)}
                    >
                      <Avatar person={receiver} />

                      <div className="contact-info">
                        <strong>{receiver.username || "User"}</strong>
                        <span>Waiting for response</span>
                      </div>

                      <span className="pending-label">Pending</span>
                    </div>
                  );
                })}

                {outgoingRequests.length === 0 && (
                  <div className="request-empty compact-empty">
                    <span>No sent requests</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="contacts-heading">
                <div>
                  <span className="contacts-heading-title">
                    YOUR CHATS
                  </span>
                  <span className="contacts-heading-subtitle">
                    People you’ve connected with
                  </span>
                </div>

                <Users size={17} />
              </div>

              <div className="contact-list">
                {users
                  .filter(
                    (person) => getId(person) !== getId(user)
                  )
                  .map((person) => (
                    <button
                      key={getId(person)}
                      className={`contact ${
                        selected?.id === getId(person)
                          ? "active"
                          : ""
                      }`}
                      onClick={() => openContact(person)}
                    >
                      <div className="contact-avatar-wrap">
                        <Avatar person={person} />

                        <span
                          className={`presence ${
                            person.online ? "online" : ""
                          }`}
                        />
                      </div>

                      <div className="contact-info">
                        <strong>{person.username}</strong>
                        <span>
                          {person.online ? "Online now" : "Offline"}
                        </span>
                      </div>

                      <span
                        className={`presence-label ${
                          person.online ? "online-text" : ""
                        }`}
                        aria-label={person.online ? "Online" : "Offline"}
                      >
                        {person.online ? "●" : ""}
                      </span>
                    </button>
                  ))}

                {users.filter(
                  (person) => getId(person) !== getId(user)
                ).length === 0 && (
                  <div className="empty-contacts">
                    <Users size={25} />
                    <p>No chats yet</p>
                    <span>
                      Search a user's email above and send a chat request.
                    </span>

                    <button
                      type="button"
                      className="empty-requests-button"
                      onClick={() => setSidebarTab("requests")}
                    >
                      View requests
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="profile-box">
          <button
            type="button"
            className="profile-picture-button"
            title="Change profile picture"
            onClick={() => fileInputRef.current?.click()}
            disabled={profileUploading}
          >
            <Avatar
              person={{
                ...user,
                profilePicture: profilePicture || user.profilePicture,
              }}
              className="avatar profile-avatar"
            />

            <span className="camera-badge">
              {profileUploading ? (
                <LoaderCircle className="spin" size={13} />
              ) : (
                <Camera size={13} />
              )}
            </span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={uploadProfilePicture}
          />

          <div className="contact-info">
            <strong>{user.username}</strong>
            <span>My account</span>
          </div>

          <button
            className="icon-btn"
            onClick={logout}
            title="Logout"
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <section className="conversation">
        {selected ? (
          <>
            <header className="chat-header">
              <Avatar person={selected} />

              <div className="contact-info">
                <strong>{selected.username}</strong>

                <span>
                  <i
                    className={`tiny-dot ${
                      selected.online ? "online" : ""
                    }`}
                  />
                  {selected.online ? "Online" : "Offline"}
                </span>
              </div>

              <div className="chat-header-actions">
                <div className="header-lock">
                  <ShieldCheck size={17} />
                  Connected
                </div>

                <button
                  className="chat-action-btn"
                  onClick={deleteConversation}
                  title="Delete chat"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </header>

            <div className="message-area">
              <div className="conversation-date">
                YOUR CONVERSATION
              </div>

              {historyLoading && currentMessages.length === 0 && (
                <div className="chat-loading">
                  Loading saved messages…
                </div>
              )}

              {!historyLoading && currentMessages.length === 0 && (
                <div className="chat-empty-state">
                  <MessageCircle size={24} />
                  <span>No messages yet. Say hello!</span>
                </div>
              )}

              {currentMessages.map((msg) => {
                const mine = msg.senderId === user.id;
                const msgId = getId(msg);

                return (
                  <div
                    key={msgId}
                    className={`message-row ${mine ? "mine" : ""}`}
                  >
                    <div className="message-bubble">
                      <p>{msg.message}</p>

                      <div className="message-meta">
                        <time>
                          {new Date(msg.createdAt).toLocaleTimeString(
                            [],
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                            }
                          )}
                        </time>

                        {mine && (
                          <CheckCheck
                            size={16}
                            className={
                              msg.seen
                                ? "message-read-tick"
                                : "message-sent-tick"
                            }
                            aria-label={
                              msg.seen ? "Read" : "Sent"
                            }
                            title={
                              msg.seen
                                ? "Read"
                                : "Sent"
                            }
                          />
                        )}
                      </div>

                      <button
                        className="message-menu-trigger"
                        aria-label="Message options"
                        title="Message options"
                        onClick={() =>
                          setMenuMessageId((old) =>
                            old === msgId ? null : msgId
                          )
                        }
                      >
                        <MoreVertical size={16} />
                      </button>

                      {menuMessageId === msgId && (
                        <div className="message-menu">
                          <button
                            onClick={() => deleteMessageForMe(msg)}
                          >
                            <X size={15} />
                            Delete for me
                          </button>

                          {mine && (
                            <button
                              className="danger-option"
                              onClick={() =>
                                deleteMessageForEveryone(msg)
                              }
                            >
                              <Trash2 size={15} />
                              Delete for everyone
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {typingUsers.includes(selected.id) && (
                <div className="typing-indicator">
                  <span className="typing-name">
                    {selected.username}
                  </span>
                  <span> is typing</span>

                  <span className="typing-dots" aria-label="Typing">
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {error && <div className="chat-error">{error}</div>}

            <form className="message-form" onSubmit={sendMessage}>
              <input
                value={message}
                onChange={(event) =>
                  handleMessageInput(event.target.value)
                }
                placeholder={`Message ${selected.username}...`}
                maxLength={5000}
              />

              <button
                className="send-btn"
                type="submit"
                disabled={!message.trim()}
              >
                <Send size={18} />
              </button>
            </form>

            <p className="composer-note">
              Messages are saved after refresh. Use ⋮ for
              message delete options.
            </p>
          </>
        ) : (
          <>
            {error && <div className="chat-error">{error}</div>}

            <div className="welcome-chat">
              <div className="welcome-icon">
                <MessageCircle size={37} />
              </div>

              <h2>
                Your conversations, <span>reimagined.</span>
              </h2>

              <p>
                Search a user's email, send a request, and
                wait for acceptance to start chatting.
              </p>
            </div>
          </>
        )}
      </section>

      {error && (
        <div className="app-toast" role="status">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError("")}
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </main>
  );
}