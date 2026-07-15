import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";

const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const app = express();
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  credentials: false
}));

// Health check endpoint
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "netchat-backend" });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  transports: ["polling", "websocket"],
  allowEIO3: true
});

// Setup Multer for in-memory uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024 // 100 MB file limit
  }
});

// In-Memory Data Store (No Database)
interface UserSession {
  username: string;
  socketId: string;
  activeChatWith: string | null;
  activeGroupRoom: string | null;
}

interface TempFile {
  fileId: string;
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
  sender: string;
  receiver: string; // can be username or "group:roomId"
  timestamp: number;
}

const onlineUsers = new Map<string, UserSession>(); // socketId -> session
const usernameToSocket = new Map<string, string>(); // username -> socketId
const tempFiles = new Map<string, TempFile>(); // fileId -> TempFile

// Helper to generate a unique random username
function generateRandomUsername(): string {
  const words = ["shadow", "ghost", "alpha", "cyber", "rogue", "nexus", "echo", "blaze", "titan", "wolf", "raven", "neon", "byte", "node", "link", "code", "sync", "wave"];
  
  let attempts = 0;
  while (attempts < 100) {
    const word = words[Math.floor(Math.random() * words.length)];
    const num = Math.floor(10 + Math.random() * 89); // two digit number
    const username = `${word}${num}`;
    
    if (!usernameToSocket.has(username)) {
      return username;
    }
    attempts++;
  }
  return `user${Math.floor(1000 + Math.random() * 8999)}`;
}

// Get active participants list in a group room
function getGroupMembers(roomId: string): string[] {
  const members: string[] = [];
  for (const user of onlineUsers.values()) {
    if (user.activeGroupRoom === roomId) {
      members.push(user.username);
    }
  }
  return members;
}

// Broadcast list of all active online usernames to all clients
function broadcastOnlineUsers() {
  const users = Array.from(usernameToSocket.keys());
  io.emit("update-online-users", { users });
}

// Garbage collection for temp files: delete files if both participants are offline
function cleanUpOrphanedFiles(username: string) {
  for (const [fileId, file] of tempFiles.entries()) {
    if (file.sender === username || file.receiver === username || file.receiver.startsWith("group:")) {
      if (file.receiver.startsWith("group:")) {
        const roomId = file.receiver.replace("group:", "");
        // If there are no members online in this group room, delete group files
        if (getGroupMembers(roomId).length === 0) {
          tempFiles.delete(fileId);
          console.log(`[Memory GC] Deleted group room file ${fileId} (${file.originalname})`);
        }
      } else {
        const otherUser = file.sender === username ? file.receiver : file.sender;
        // If the other user is offline, delete the file since both are now offline/disconnected
        if (!usernameToSocket.has(otherUser)) {
          tempFiles.delete(fileId);
          console.log(`[Memory GC] Deleted orphaned file ${fileId} (${file.originalname})`);
        }
      }
    }
  }
}

// POST: Upload endpoint (saves binary in RAM)
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const fileId = uuidv4();
  const sender = (req.body.sender as string) || "";
  const receiver = (req.body.receiver as string) || ""; // username or group:roomId

  if (!sender || !receiver) {
    res.status(400).json({ error: "Sender and receiver are required" });
    return;
  }

  const newFile: TempFile = {
    fileId,
    buffer: req.file.buffer,
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
    sender,
    receiver,
    timestamp: Date.now(),
  };

  tempFiles.set(fileId, newFile);
  console.log(`[File Saved to RAM] ID: ${fileId}, Size: ${newFile.size} bytes, Sender: ${sender}, Receiver: ${receiver}`);

  res.status(200).json({ fileId });
});

// GET: Download endpoint (streams binary from RAM)
app.get("/download/:fileId", (req, res) => {
  const fileId = req.params.fileId;
  const file = tempFiles.get(fileId);

  if (!file) {
    res.status(404).send("File not found or has been deleted");
    return;
  }

  // Set file headers and stream the binary buffer
  res.setHeader("Content-Length", file.size);
  res.setHeader("Content-Type", file.mimetype || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${file.originalname}"`);
  res.send(file.buffer);
});

// Socket.IO event handler
io.on("connection", (socket: Socket) => {
  console.log(`[Socket Connected] Socket ID: ${socket.id}`);

  // 1. Username Registration / Collision Check
  socket.on("register-username", ({ requested }: { requested: string | null }) => {
    let finalUsername = "";

    if (requested && requested.trim()) {
      const cleanRequested = requested.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
      
      // If the username is already owned by someone else online
      if (usernameToSocket.has(cleanRequested) && usernameToSocket.get(cleanRequested) !== socket.id) {
        socket.emit("username-status", { status: "taken", username: cleanRequested });
        return;
      }
      finalUsername = cleanRequested;
    } else {
      // Generate a random username
      finalUsername = generateRandomUsername();
    }

    // Unregister old username if socket is renaming
    const currentSession = onlineUsers.get(socket.id);
    if (currentSession && currentSession.username !== finalUsername) {
      usernameToSocket.delete(currentSession.username);
      cleanUpOrphanedFiles(currentSession.username);
    }

    // Save mapping
    onlineUsers.set(socket.id, {
      username: finalUsername,
      socketId: socket.id,
      activeChatWith: null,
      activeGroupRoom: currentSession?.activeGroupRoom || null
    });
    usernameToSocket.set(finalUsername, socket.id);

    console.log(`[Username Registered] Socket ${socket.id} -> ${finalUsername}`);
    socket.emit("username-assigned", { username: finalUsername });
    socket.emit("username-status", { status: "available", username: finalUsername });

    // Broadcast updated online list
    broadcastOnlineUsers();

    // Notify any active chat partners that this user is now online again
    for (const [_, otherUser] of onlineUsers.entries()) {
      if (otherUser.activeChatWith === finalUsername) {
        io.to(otherUser.socketId).emit("peer-status", { username: finalUsername, online: true });
      }
    }
  });

  // 2. Check if a User is Online
  socket.on("check-username", ({ username }: { username: string }, callback: (res: { exists: boolean }) => void) => {
    const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    const exists = usernameToSocket.has(cleanUsername);
    callback({ exists });
  });

  // 3. Handshake: Initiate Chat SECURE (routes ECDH public keys)
  socket.on("initiate-chat-request", ({ to, peerPublicKey }: { to: string; peerPublicKey: string }) => {
    const senderSession = onlineUsers.get(socket.id);
    if (!senderSession) return;

    const recipientSocketId = usernameToSocket.get(to);
    if (recipientSocketId) {
      senderSession.activeChatWith = to;
      io.to(recipientSocketId).emit("initiate-chat-request", {
        from: senderSession.username,
        peerPublicKey
      });
    }
  });

  // 4. Handshake: Accept Chat Secure
  socket.on("accept-chat-response", ({ to, myPublicKey }: { to: string; myPublicKey: string }) => {
    const acceptorSession = onlineUsers.get(socket.id);
    if (!acceptorSession) return;

    const initiatorSocketId = usernameToSocket.get(to);
    if (initiatorSocketId) {
      acceptorSession.activeChatWith = to;
      io.to(initiatorSocketId).emit("accept-chat-response", {
        from: acceptorSession.username,
        peerPublicKey: myPublicKey
      });
    }
  });

  // 5. Route E2EE Private Messages
  socket.on("message", (msg: { id: string; to: string; encryptedText?: string; iv: string; file?: any; timestamp: number; replyTo?: string }) => {
    const senderSession = onlineUsers.get(socket.id);
    if (!senderSession) return;

    const recipientSocketId = usernameToSocket.get(msg.to);
    if (recipientSocketId) {
      // Forward the encrypted payload to the receiver
      io.to(recipientSocketId).emit("message", {
        id: msg.id,
        sender: senderSession.username,
        receiver: msg.to,
        encryptedText: msg.encryptedText,
        iv: msg.iv,
        file: msg.file,
        timestamp: msg.timestamp,
        replyTo: msg.replyTo
      });

      // Emit delivered receipt to sender
      socket.emit("message-status", { messageId: msg.id, status: "delivered" });
    }
  });

  // 6. Route Typing Indicator
  socket.on("typing-status", ({ to, isTyping }: { to: string; isTyping: boolean }) => {
    const senderSession = onlineUsers.get(socket.id);
    if (!senderSession) return;

    const recipientSocketId = usernameToSocket.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit("typing-status", {
        from: senderSession.username,
        isTyping
      });
    }
  });

  // 7. Route Read/Delivered Status updates
  socket.on("message-status", ({ messageId, to, status }: { messageId: string; to: string; status: "delivered" | "read" }) => {
    const recipientSocketId = usernameToSocket.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit("message-status", { messageId, status });
    }
  });

  // 8. Leave active Private Chat Session
  socket.on("leave-chat", () => {
    const userSession = onlineUsers.get(socket.id);
    if (userSession) {
      console.log(`[Leave Chat] ${userSession.username} left chat with ${userSession.activeChatWith}`);
      userSession.activeChatWith = null;
    }
  });

  // 10. GROUP ROOMS EVENTS
  // A. Join Room
  socket.on("join-group", ({ roomId }: { roomId: string }) => {
    const userSession = onlineUsers.get(socket.id);
    if (!userSession) return;

    const cleanRoomId = roomId.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!cleanRoomId) return;

    socket.join(`group:${cleanRoomId}`);
    userSession.activeGroupRoom = cleanRoomId;

    console.log(`[Group Joined] ${userSession.username} -> Room ${cleanRoomId}`);
    
    // Broadcast updated member list to room
    io.to(`group:${cleanRoomId}`).emit("update-group-members", {
      roomId: cleanRoomId,
      members: getGroupMembers(cleanRoomId)
    });

    // Notify room of join
    socket.to(`group:${cleanRoomId}`).emit("group-system-message", {
      id: uuidv4(),
      text: `${userSession.username} joined the chat room.`,
      timestamp: Date.now()
    });
  });

  // B. Group Message Send
  socket.on("group-message", (msg: { id: string; roomId: string; text?: string; file?: any; timestamp: number; replyTo?: string }) => {
    const userSession = onlineUsers.get(socket.id);
    if (!userSession) return;

    const roomName = `group:${msg.roomId}`;
    // Broadcast to everyone else in the room
    socket.to(roomName).emit("group-message", {
      id: msg.id,
      roomId: msg.roomId,
      sender: userSession.username,
      text: msg.text,
      file: msg.file,
      timestamp: msg.timestamp,
      replyTo: msg.replyTo
    });
  });

  // C. Group Typing Status
  socket.on("group-typing-status", ({ roomId, isTyping }: { roomId: string; isTyping: boolean }) => {
    const userSession = onlineUsers.get(socket.id);
    if (!userSession) return;

    socket.to(`group:${roomId}`).emit("group-typing-status", {
      from: userSession.username,
      isTyping
    });
  });

  // D. Leave Group Room
  socket.on("leave-group", ({ roomId }: { roomId: string }) => {
    const userSession = onlineUsers.get(socket.id);
    if (!userSession) return;

    socket.leave(`group:${roomId}`);
    userSession.activeGroupRoom = null;

    console.log(`[Group Left] ${userSession.username} left Room ${roomId}`);

    // Broadcast updated member list to room
    io.to(`group:${roomId}`).emit("update-group-members", {
      roomId,
      members: getGroupMembers(roomId)
    });

    // Notify room of departure
    io.to(`group:${roomId}`).emit("group-system-message", {
      id: uuidv4(),
      text: `${userSession.username} left the chat room.`,
      timestamp: Date.now()
    });

    cleanUpOrphanedFiles(userSession.username);
  });

  // 9. Disconnect cleanup
  socket.on("disconnect", () => {
    const session = onlineUsers.get(socket.id);
    if (session) {
      const disconnectedUsername = session.username;
      
      console.log(`[Socket Disconnected] ${disconnectedUsername}`);
      
      // Clean maps
      onlineUsers.delete(socket.id);
      usernameToSocket.delete(disconnectedUsername);

      // If user was in a group room, notify group and update members
      if (session.activeGroupRoom) {
        const roomId = session.activeGroupRoom;
        io.to(`group:${roomId}`).emit("update-group-members", {
          roomId,
          members: getGroupMembers(roomId)
        });
        io.to(`group:${roomId}`).emit("group-system-message", {
          id: uuidv4(),
          text: `${disconnectedUsername} disconnected from the room.`,
          timestamp: Date.now()
        });
      }

      // Notify anyone chatting with this user privately that they went offline
      for (const [_, otherUser] of onlineUsers.entries()) {
        if (otherUser.activeChatWith === disconnectedUsername) {
          io.to(otherUser.socketId).emit("peer-status", { username: disconnectedUsername, online: false });
        }
      }

      // Broadcast updated online list
      broadcastOnlineUsers();

      // Garbage Collect any files in RAM that both users have now disconnected from
      cleanUpOrphanedFiles(disconnectedUsername);
    }
  });
});

// Start Node server
server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`Netchat Backend listening on http://localhost:${PORT}`);
  console.log(`PORT env: ${process.env.PORT}`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`Socket.IO attached: ${!!io}`);
  console.log(`Socket.IO engine: ${!!(io as any).engine}`);
  console.log(`Express routes:`);
  app._router?.stack?.forEach((r: any) => {
    if (r.route) {
      console.log(`  ${Object.keys(r.route.methods).join(',')} ${r.route.path}`);
    }
  });
  console.log(`===============================================`);
});
