"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const multer_1 = __importDefault(require("multer"));
const uuid_1 = require("uuid");
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const app = (0, express_1.default)();
app.use((0, cors_1.default)({
    origin: FRONTEND_URL,
    methods: ["GET", "POST"],
    credentials: true
}));
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: FRONTEND_URL,
        methods: ["GET", "POST"],
        credentials: true
    }
});
// Setup Multer for in-memory uploads
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: 100 * 1024 * 1024 // 100 MB file limit
    }
});
const onlineUsers = new Map(); // socketId -> session
const usernameToSocket = new Map(); // username -> socketId
const tempFiles = new Map(); // fileId -> TempFile
// Helper to generate a unique random username
function generateRandomUsername() {
    const adjectives = ["Shadow", "Ghost", "Alpha", "RTX", "Cyber", "Phantom", "Rogue", "Nexus", "Vortex", "Cipher", "Spectrum", "Apex", "Frost", "Echo", "Blaze", "Titan"];
    const nouns = ["X", "One", "Hero", "Knight", "Hunter", "Wolf", "Raven", "Matrix", "Neon", "Quantum", "Byte", "Node", "Link", "Code", "Sync", "Wave"];
    let attempts = 0;
    while (attempts < 100) {
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        const num = Math.floor(10 + Math.random() * 89); // two digit number
        const username = `${adj}${noun}${num}`;
        if (!usernameToSocket.has(username)) {
            return username;
        }
        attempts++;
    }
    return `User_${Math.floor(1000 + Math.random() * 8999)}`;
}
// Get active participants list in a group room
function getGroupMembers(roomId) {
    const members = [];
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
function cleanUpOrphanedFiles(username) {
    for (const [fileId, file] of tempFiles.entries()) {
        if (file.sender === username || file.receiver === username || file.receiver.startsWith("group:")) {
            if (file.receiver.startsWith("group:")) {
                const roomId = file.receiver.replace("group:", "");
                // If there are no members online in this group room, delete group files
                if (getGroupMembers(roomId).length === 0) {
                    tempFiles.delete(fileId);
                    console.log(`[Memory GC] Deleted group room file ${fileId} (${file.originalname})`);
                }
            }
            else {
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
    const fileId = (0, uuid_1.v4)();
    const sender = req.body.sender || "";
    const receiver = req.body.receiver || ""; // username or group:roomId
    if (!sender || !receiver) {
        res.status(400).json({ error: "Sender and receiver are required" });
        return;
    }
    const newFile = {
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
io.on("connection", (socket) => {
    console.log(`[Socket Connected] Socket ID: ${socket.id}`);
    // 1. Username Registration / Collision Check
    socket.on("register-username", ({ requested }) => {
        let finalUsername = "";
        if (requested && requested.trim()) {
            const cleanRequested = requested.trim().replace(/[^a-zA-Z0-9]/g, "");
            // If the username is already owned by someone else online
            if (usernameToSocket.has(cleanRequested) && usernameToSocket.get(cleanRequested) !== socket.id) {
                socket.emit("username-status", { status: "taken", username: cleanRequested });
                return;
            }
            finalUsername = cleanRequested;
        }
        else {
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
    socket.on("check-username", ({ username }, callback) => {
        const exists = usernameToSocket.has(username);
        callback({ exists });
    });
    // 3. Handshake: Initiate Chat SECURE (routes ECDH public keys)
    socket.on("initiate-chat-request", ({ to, peerPublicKey }) => {
        const senderSession = onlineUsers.get(socket.id);
        if (!senderSession)
            return;
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
    socket.on("accept-chat-response", ({ to, myPublicKey }) => {
        const acceptorSession = onlineUsers.get(socket.id);
        if (!acceptorSession)
            return;
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
    socket.on("message", (msg) => {
        const senderSession = onlineUsers.get(socket.id);
        if (!senderSession)
            return;
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
    socket.on("typing-status", ({ to, isTyping }) => {
        const senderSession = onlineUsers.get(socket.id);
        if (!senderSession)
            return;
        const recipientSocketId = usernameToSocket.get(to);
        if (recipientSocketId) {
            io.to(recipientSocketId).emit("typing-status", {
                from: senderSession.username,
                isTyping
            });
        }
    });
    // 7. Route Read/Delivered Status updates
    socket.on("message-status", ({ messageId, to, status }) => {
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
    socket.on("join-group", ({ roomId }) => {
        const userSession = onlineUsers.get(socket.id);
        if (!userSession)
            return;
        const cleanRoomId = roomId.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!cleanRoomId)
            return;
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
            id: (0, uuid_1.v4)(),
            text: `${userSession.username} joined the chat room.`,
            timestamp: Date.now()
        });
    });
    // B. Group Message Send
    socket.on("group-message", (msg) => {
        const userSession = onlineUsers.get(socket.id);
        if (!userSession)
            return;
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
    socket.on("group-typing-status", ({ roomId, isTyping }) => {
        const userSession = onlineUsers.get(socket.id);
        if (!userSession)
            return;
        socket.to(`group:${roomId}`).emit("group-typing-status", {
            from: userSession.username,
            isTyping
        });
    });
    // D. Leave Group Room
    socket.on("leave-group", ({ roomId }) => {
        const userSession = onlineUsers.get(socket.id);
        if (!userSession)
            return;
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
            id: (0, uuid_1.v4)(),
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
                    id: (0, uuid_1.v4)(),
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
    console.log(`===============================================`);
});
