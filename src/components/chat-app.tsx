"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Paperclip,
  Lock,
  Settings as SettingsIcon,
  User,
  Volume2,
  VolumeX,
  File,
  Image as ImageIcon,
  FileText,
  Loader2,
  Check,
  CheckCheck,
  Search,
  ArrowLeft,
  Trash2,
  CornerUpLeft,
  Smile,
  X,
  Download,
  AlertCircle,
  Eye,
  Menu,
  ShieldCheck,
  Edit,
  Users,
  Hash
} from "lucide-react";
import { useSocket, Message } from "@/hooks/useSocket";

// Glassmorphic emoji list for emoji picker
const EMOJIS = [
  "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇",
  "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚",
  "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🥸",
  "🤩", "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "☹️",
  "😣", "😖", "😫", "😩", "🥺", "😢", "😭", "😤", "😠", "😡",
  "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓",
  "🤗", "🤔", "🫣", "🤭", "🤫", "🤥", "😶", "😶‍🌫️", "😐", "😑",
  "😬", "🫠", "🤥", "👋", "👍", "👎", "👊", "✊", "🤛", "🤜",
  "👏", "🙌", "👐", "🤲", "🤝", "🙏", "✍️", "💅", "🤳", "💪",
  "🦾", "🦿", "🦵", "🦶", "👂", "🦻", "👃", "🧠", "🫀", "🫁"
];

const THEMES = [
  { id: "violet", name: "Violet Eclipse", accent: "from-purple-500 to-pink-500", bg: "bg-purple-500" },
  { id: "sapphire", name: "Sapphire Deep", accent: "from-blue-500 to-cyan-500", bg: "bg-blue-500" },
  { id: "emerald", name: "Emerald Forest", accent: "from-emerald-500 to-teal-500", bg: "bg-emerald-500" },
  { id: "sunset", name: "Sunset Rose", accent: "from-red-500 to-orange-500", bg: "bg-red-500" },
  { id: "neon", name: "Neon Cyan", accent: "from-cyan-400 to-purple-600", bg: "bg-cyan-400" }
];

export default function ChatApp() {
  const socketContext = useSocket();
  const {
    connected,
    username,
    usernameStatus,
    activeChatUser,
    activeChatOnline,
    activeGroupRoom,
    groupMembers,
    onlineUsersList,
    messages,
    isPeerTyping,
    notificationSound,
    setNotificationSound,
    changeUsername,
    startChatWith,
    joinGroupRoom,
    leaveGroupRoom,
    sendMessage,
    sendFile,
    downloadAndDecryptFile,
    sendTypingStatus,
    deleteMessageLocally,
    closeActiveChat
  } = socketContext;

  // View routing: 'splash' | 'username-setup' | 'chat'
  const [currentView, setCurrentView] = useState<"splash" | "username-setup" | "chat">("splash");
  const [showSettings, setShowSettings] = useState(false);
  const [activeTheme, setActiveTheme] = useState("violet");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTab, setSearchTab] = useState<"direct" | "group">("direct");
  const [groupRoomInput, setGroupRoomInput] = useState("");

  // Search input state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  // Message input state
  const [messageInput, setMessageInput] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isTypingLocal, setIsTypingLocal] = useState(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // File upload state
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // Download state maps (fileId -> progress)
  const [downloadProgress, setDownloadProgress] = useState<{ [key: string]: number }>({});
  
  // Custom username input state
  const [usernameInput, setUsernameInput] = useState("");

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Splash screen timeout
  useEffect(() => {
    if (connected && username && currentView === "splash") {
      const timer = setTimeout(() => {
        setUsernameInput(username);
        setCurrentView("username-setup");
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [connected, username, currentView]);

  // Handle document theme attribute
  useEffect(() => {
    const storedTheme = localStorage.getItem("netchat_theme") || "violet";
    setActiveTheme(storedTheme);
    document.documentElement.setAttribute("data-theme", storedTheme);
  }, []);

  const handleThemeChange = (themeId: string) => {
    setActiveTheme(themeId);
    localStorage.setItem("netchat_theme", themeId);
    document.documentElement.setAttribute("data-theme", themeId);
  };

  // Scroll to bottom when messages list changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isPeerTyping]);

  // Handle typing indicator emission
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessageInput(e.target.value);
    
    if (!isTypingLocal) {
      setIsTypingLocal(true);
      sendTypingStatus(true);
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    
    typingTimeoutRef.current = setTimeout(() => {
      setIsTypingLocal(false);
      sendTypingStatus(false);
    }, 2000);
  };

  // Claim custom username
  const handleClaimUsername = (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameInput.trim()) return;
    setIsSubmitting(true);
    changeUsername(usernameInput.trim());
  };

  // Listen to username validation outcomes
  useEffect(() => {
    if (usernameStatus === "available" && currentView === "username-setup" && isSubmitting) {
      setCurrentView("chat");
      setIsSubmitting(false);
    }
  }, [usernameStatus, currentView, isSubmitting]);

  // Initiate Chat
  const handleStartChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError(null);

    const result = await startChatWith(searchQuery.trim());
    setSearching(false);
    if (!result.success) {
      setSearchError(result.error || "User is Offline");
    } else {
      setSearchQuery("");
    }
  };

  // Send message
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim()) return;
    
    sendMessage(messageInput.trim(), replyTo?.id);
    setMessageInput("");
    setReplyTo(null);
    setShowEmojiPicker(false);
    
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    setIsTypingLocal(false);
    sendTypingStatus(false);
  };

  // File selection & drag-and-drop
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processAndSendFile(file);
  };

  const processAndSendFile = async (file: File) => {
    setUploadProgress(0);
    const success = await sendFile(file, (progress) => {
      setUploadProgress(progress);
    }, replyTo?.id);
    
    setUploadProgress(null);
    setReplyTo(null);
    if (!success) {
      alert("Failed to encrypt or upload file. Please try again.");
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(true);
  };

  const handleDragLeave = () => {
    setIsDraggingFile(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processAndSendFile(file);
    }
  };

  // Decrypt and open a file
  const handleDownloadFile = async (msg: Message) => {
    if (!msg.file || msg.file.localUrl) return;

    const fileId = msg.file.fileId;
    setDownloadProgress((prev) => ({ ...prev, [fileId]: 0 }));

    const localUrl = await downloadAndDecryptFile(
      fileId,
      msg.file.iv,
      msg.file.decryptedName || "file",
      msg.file.decryptedType || "application/octet-stream",
      (percent) => {
        setDownloadProgress((prev) => ({ ...prev, [fileId]: percent }));
      }
    );

    setDownloadProgress((prev) => {
      const copy = { ...prev };
      delete copy[fileId];
      return copy;
    });

    if (localUrl) {
      // Trigger download for non-previewable files
      const isPreviewable =
        msg.file.decryptedType?.startsWith("image/") ||
        msg.file.decryptedType === "application/pdf";
        
      if (!isPreviewable) {
        const link = document.createElement("a");
        link.href = localUrl;
        link.download = msg.file.decryptedName || "file";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } else {
      alert("Failed to decrypt the file payload.");
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  return (
    <div className="relative flex-1 flex flex-col justify-center items-center w-full min-h-screen overflow-hidden px-4 md:px-6 py-4">
      {/* Background Animated Orbs */}
      <div className="ambient-orb-1" />
      <div className="ambient-orb-2" />

      {/* Screen Views */}
      <AnimatePresence mode="wait">
        {currentView === "splash" && (
          <motion.div
            key="splash"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5 }}
            className="w-full max-w-md p-8 rounded-3xl glass-panel text-center flex flex-col items-center justify-center shadow-2xl relative z-10"
          >
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-purple-600 to-pink-500 flex items-center justify-center shadow-lg accent-glow animate-pulse mb-6">
              <ShieldCheck className="w-12 h-12 text-white" />
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight mb-2">
              <span className="accent-text-gradient">netchat</span>
            </h1>
            <p className="text-gray-400 text-sm mb-8 font-light">
              Secure. In-Memory. Temporary Global Messenger.
            </p>
            <div className="flex items-center gap-3 text-sm text-gray-500 glass-card px-4 py-2 rounded-full">
              <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
              <span>{connected ? "Securing connection..." : "Connecting to global network..."}</span>
            </div>
          </motion.div>
        )}

        {currentView === "username-setup" && (
          <motion.div
            key="username-setup"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="w-full max-w-md p-8 rounded-3xl glass-panel shadow-2xl relative z-10 text-center"
          >
            <div className="w-16 h-16 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 accent-glow mx-auto mb-6">
              <User className="w-8 h-8" />
            </div>
            
            <h2 className="text-2xl font-bold mb-1 text-white">Choose Your Alias</h2>
            <p className="text-sm text-gray-400 mb-8 font-light max-w-xs mx-auto">
              Netchat uses temporary aliases. We generated a random one for you. Click inside the box to customize it.
            </p>

            <form onSubmit={handleClaimUsername} className="space-y-8">
              <div className="space-y-2">
                <div className="relative group rounded-2xl bg-white/5 border border-white/10 p-6 flex flex-col items-center justify-center cursor-text transition-all hover:bg-white/10 hover:border-purple-500/30">
                  <span className="text-[10px] uppercase font-bold tracking-widest text-purple-400/70 mb-2">TEMPORARY ALIAS</span>
                  
                  <input
                    type="text"
                    value={usernameInput}
                    onChange={(e) => setUsernameInput(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))}
                    maxLength={15}
                    placeholder="Enter Alias"
                    className="w-full bg-transparent border-none text-center text-3xl font-extrabold tracking-wider text-white focus:outline-none focus:ring-0 placeholder:text-gray-700"
                    style={{ caretColor: "rgb(168, 85, 247)" }}
                    disabled={usernameStatus === "validating"}
                  />
                  
                  <span className="text-xs text-gray-500 mt-3 flex items-center gap-1.5 group-hover:text-gray-400 transition-colors">
                    <Edit className="w-3.5 h-3.5" /> Click to Customize
                  </span>

                  {usernameStatus === "validating" && (
                    <Loader2 className="absolute right-4 bottom-4 w-5 h-5 animate-spin text-purple-500" />
                  )}
                </div>
                
                {usernameStatus === "taken" && (
                  <p className="text-sm text-red-400 flex items-center justify-center gap-1.5 mt-2 font-medium">
                    <AlertCircle className="w-4 h-4" /> Username already in use.
                  </p>
                )}
                {usernameStatus === "available" && isSubmitting && (
                  <p className="text-sm text-emerald-400 flex items-center justify-center gap-1.5 mt-2 font-medium">
                    <Check className="w-4 h-4" /> Securing identity...
                  </p>
                )}
              </div>

              <div className="flex gap-4 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    const nouns = ["Ghost", "Shadow", "Alpha", "Beta", "RTX", "Vortex", "Cipher", "Phantom", "Rogue", "Specter"];
                    const numbers = Math.floor(10 + Math.random() * 89);
                    const randomName = nouns[Math.floor(Math.random() * nouns.length)] + numbers;
                    setUsernameInput(randomName);
                  }}
                  className="px-5 py-3.5 rounded-2xl glass-card text-gray-300 font-semibold hover:text-white hover:border-purple-500/20 active:scale-[0.98] transition"
                  disabled={usernameStatus === "validating"}
                >
                  Randomize
                </button>
                <button
                  type="submit"
                  disabled={!usernameInput.trim() || usernameStatus === "validating"}
                  className="flex-1 py-3.5 rounded-2xl font-bold accent-bg-gradient text-white shadow-lg hover:opacity-90 active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:pointer-events-none"
                >
                  Join Chat Space
                </button>
              </div>
            </form>
          </motion.div>
        ) /**/ }

        {currentView === "chat" && (
          <motion.div
            key="chat"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-5xl h-[88vh] rounded-3xl glass-panel shadow-2xl flex overflow-hidden relative z-10 border border-white/10"
          >
            {/* Main Chat Panel */}
            <div className="flex-1 flex flex-col h-full overflow-hidden relative">
              {/* Drag File Overlay */}
              {isDraggingFile && (
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className="absolute inset-0 bg-black/70 backdrop-blur-md z-50 flex flex-col justify-center items-center border-4 border-dashed border-purple-500 m-3 rounded-2xl"
                >
                  <Paperclip className="w-16 h-16 text-purple-500 animate-bounce mb-4" />
                  <p className="text-xl font-bold text-white mb-2">Drop File to Send Securely</p>
                  <p className="text-sm text-gray-400">File will be encrypted client-side before uploading</p>
                </div>
              )}

              {/* Chat View Header */}
              <div className="px-6 py-4 flex items-center justify-between border-b border-white/5 bg-black/20">
                <div className="flex items-center gap-3">
                  {(activeChatUser || activeGroupRoom) && (
                    <button
                      onClick={closeActiveChat}
                      className="p-2 rounded-xl glass-card text-gray-400 hover:text-white mr-1"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                  )}
                  <div>
                    {activeChatUser ? (
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white text-lg">{activeChatUser}</span>
                          <span
                            className={`w-2.5 h-2.5 rounded-full ${
                              activeChatOnline ? "bg-emerald-500" : "bg-gray-500"
                            }`}
                          />
                        </div>
                        <div className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                          <Lock className="w-3 h-3" />
                          <span>End-to-End Encrypted</span>
                        </div>
                      </div>
                    ) : activeGroupRoom ? (
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white text-lg flex items-center gap-1">
                            <Hash className="w-4 h-4 text-purple-400 shrink-0" />
                            {activeGroupRoom}
                          </span>
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        </div>
                        <div className="flex items-center gap-1 text-[11px] text-gray-400 font-medium">
                          <Users className="w-3.5 h-3.5 text-purple-400" />
                          <span>Group Room • {groupMembers.length} active</span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col">
                        <span className="font-extrabold text-white tracking-wide text-lg flex items-center gap-1.5">
                          <span className="accent-text-gradient">netchat</span>
                          <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/20">
                            Session Active
                          </span>
                        </span>
                        <div className="flex items-center gap-1 text-xs text-gray-400">
                          <User className="w-3.5 h-3.5" />
                          <span>Your Username: <strong className="text-purple-400 font-semibold">{username}</strong></span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setNotificationSound(!notificationSound)}
                    className="p-2 rounded-xl glass-card text-gray-400 hover:text-white"
                  >
                    {notificationSound ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
                  </button>
                  <button
                    onClick={() => setShowSettings(!showSettings)}
                    className={`p-2 rounded-xl glass-card text-gray-400 hover:text-white transition-all ${
                      showSettings ? "border-purple-500/50 bg-white/5 text-purple-400" : ""
                    }`}
                  >
                    <SettingsIcon className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Chat View Body */}
              <div
                className="flex-1 overflow-y-auto px-6 py-6 space-y-4"
                onDragOver={handleDragOver}
              >
                {!activeChatUser && !activeGroupRoom ? (
                  // Welcome Screen when no chat or group is open
                  <div className="h-full flex flex-col justify-center items-center max-w-sm mx-auto text-center space-y-6 py-10 w-full">
                    <div className="flex flex-col items-center gap-2.5">
                      {/* Pulsing Online Status Tag */}
                      <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold animate-pulse shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span>Online as {username}</span>
                      </div>
                    </div>

                    {/* Tabs Segment */}
                    <div className="flex w-full p-1 rounded-2xl bg-white/5 border border-white/5">
                      <button
                        onClick={() => {
                          setSearchTab("direct");
                          setSearchError(null);
                        }}
                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition duration-200 ${
                          searchTab === "direct"
                            ? "bg-purple-500/20 text-purple-300 border border-purple-500/20 shadow-md"
                            : "text-gray-400 hover:text-white"
                        }`}
                      >
                        <User className="w-4 h-4" />
                        Direct Chat
                      </button>
                      <button
                        onClick={() => {
                          setSearchTab("group");
                          setSearchError(null);
                        }}
                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition duration-200 ${
                          searchTab === "group"
                            ? "bg-purple-500/20 text-purple-300 border border-purple-500/20 shadow-md"
                            : "text-gray-400 hover:text-white"
                        }`}
                      >
                        <Users className="w-4 h-4" />
                        Group Room
                      </button>
                    </div>

                    <div className="space-y-1">
                      <h3 className="text-xl font-bold text-white">
                        {searchTab === "direct" ? "Start Private Chat" : "Enter Group Chat"}
                      </h3>
                      <p className="text-xs text-gray-400 font-light leading-relaxed">
                        {searchTab === "direct"
                          ? "Type a temporary username to open a secure E2EE private chat session."
                          : "Join an in-memory group room by typing a common room code/ID."}
                      </p>
                    </div>

                    {searchTab === "direct" ? (
                      <div className="w-full space-y-5">
                        <form onSubmit={handleStartChat} className="w-full space-y-3">
                          <div className="relative">
                            <input
                              type="text"
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))}
                              placeholder="Enter recipient's username"
                              className="w-full px-4 py-3.5 pl-11 rounded-2xl glass-input text-white font-medium text-sm"
                              disabled={searching}
                            />
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                          </div>
                          
                          {searchError && (
                            <p className="text-sm text-red-400 font-medium flex items-center justify-center gap-1.5">
                              <AlertCircle className="w-4 h-4" /> {searchError}
                            </p>
                          )}

                          <button
                            type="submit"
                            disabled={!searchQuery.trim() || searching}
                            className="w-full py-3.5 rounded-2xl font-bold accent-bg-gradient text-white flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] transition"
                          >
                            {searching ? (
                              <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Checking Status...
                              </>
                            ) : (
                              "Open Session"
                            )}
                          </button>
                        </form>

                        {/* Active Online Users Display */}
                        <div className="space-y-3 text-left w-full mt-2">
                          <span className="text-[10px] uppercase font-bold tracking-widest text-purple-400/80">Active Online Users</span>
                          {onlineUsersList.length === 0 ? (
                            <p className="text-[11px] text-gray-600 italic">No other users online. Open another window to test.</p>
                          ) : (
                            <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto pr-1">
                              {onlineUsersList.map((user) => (
                                <button
                                  key={user}
                                  onClick={() => {
                                    setSearchQuery(user);
                                    setSearchError(null);
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/5 hover:border-purple-500/30 hover:bg-white/10 text-xs font-semibold text-purple-300 transition duration-150 active:scale-95"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                  {user}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <form onSubmit={(e) => {
                        e.preventDefault();
                        if (groupRoomInput.trim()) {
                          joinGroupRoom(groupRoomInput.trim());
                          setGroupRoomInput("");
                        }
                      }} className="w-full space-y-3">
                        <div className="relative">
                          <input
                            type="text"
                            value={groupRoomInput}
                            onChange={(e) => setGroupRoomInput(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))}
                            placeholder="Enter Group Code (e.g. CryptoHub)"
                            className="w-full px-4 py-3.5 pl-11 rounded-2xl glass-input text-white font-medium text-sm"
                          />
                          <Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        </div>
                        
                        <button
                          type="submit"
                          disabled={!groupRoomInput.trim()}
                          className="w-full py-3.5 rounded-2xl font-bold accent-bg-gradient text-white flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] transition"
                        >
                          Join Group Space
                        </button>
                      </form>
                    )}
                  </div>
                ) : (
                  // Active Messages List
                  <div className="flex flex-col space-y-4 min-h-full justify-end">
                    {messages.length === 0 ? (
                      <div className="flex-1 flex flex-col justify-center items-center text-center py-20 text-gray-500 font-light space-y-3">
                        {activeGroupRoom ? (
                          <>
                            <Users className="w-10 h-10 text-purple-400/30 animate-pulse" />
                            <p className="text-sm">Welcome to Group Room #{activeGroupRoom}</p>
                            <p className="text-xs text-gray-600">Messages are sent securely in-memory and will vanish when everyone leaves.</p>
                          </>
                        ) : (
                          <>
                            <Lock className="w-10 h-10 text-purple-400/30" />
                            <p className="text-sm">This channel is end-to-end encrypted.</p>
                            <p className="text-xs text-gray-600">Messages exist only in your browser and will vanish upon close.</p>
                          </>
                        )}
                      </div>
                    ) : (
                      messages.map((msg) => {
                        if (msg.isSystem || msg.sender === "system") {
                          return (
                            <div key={msg.id} className="w-full flex justify-center py-1.5 animate-fadeIn">
                              <span className="text-[10px] bg-white/5 border border-white/5 text-gray-400 rounded-full px-3.5 py-1 font-semibold italic uppercase tracking-wider">
                                {msg.text}
                              </span>
                            </div>
                          );
                        }

                        const isSelf = msg.self || msg.sender === username;
                        // Find referenced message for replies
                        const repliedMessage = msg.replyTo
                          ? messages.find((m) => m.id === msg.replyTo)
                          : null;

                        return (
                          <div
                            key={msg.id}
                            className={`flex flex-col ${isSelf ? "items-end" : "items-start"} group`}
                          >
                            {/* Group Sender Alias Tag */}
                            {!isSelf && activeGroupRoom && (
                              <span className="text-[10px] text-purple-300 font-bold mb-1 pl-1">
                                {msg.sender}
                              </span>
                            )}
                            
                            {/* Message Bubble Container */}
                            <div className="relative max-w-[80%] flex flex-col">
                              {/* Reply Context Header */}
                              {repliedMessage && (
                                <div
                                  className={`text-xs text-gray-400 px-3 py-1 mb-1 rounded-t-xl bg-white/5 border-l-2 border-purple-500/50 flex items-center gap-1 max-w-full truncate ${
                                    isSelf ? "self-end" : "self-start"
                                  }`}
                                >
                                  <CornerUpLeft className="w-3 h-3 text-purple-400 shrink-0" />
                                  <span className="font-semibold text-purple-300 mr-1">
                                    {repliedMessage.sender === username ? "You" : repliedMessage.sender}
                                  </span>
                                  <span className="truncate">
                                    {repliedMessage.text || "[File Share]"}
                                  </span>
                                </div>
                              )}

                              {/* Bubble */}
                              <div
                                className={`px-4 py-3 rounded-2xl shadow-md ${
                                  isSelf
                                    ? "accent-bg-gradient text-white rounded-tr-none"
                                    : "glass-card text-gray-100 rounded-tl-none border border-white/5"
                                }`}
                              >
                                {/* Text Payload */}
                                {msg.text && (
                                  <p className="text-[15px] font-normal leading-relaxed break-words whitespace-pre-wrap">
                                    {msg.text}
                                  </p>
                                )}

                                {/* File Payload */}
                                {msg.file && (
                                  <div className="space-y-3 mt-1 min-w-[200px] md:min-w-[250px]">
                                    {/* Preview images inline */}
                                    {msg.file.localUrl && msg.file.decryptedType?.startsWith("image/") ? (
                                      <div className="rounded-xl overflow-hidden max-h-60 border border-white/10 bg-black/40 flex items-center justify-center">
                                        <img
                                          src={msg.file.localUrl}
                                          alt={msg.file.decryptedName}
                                          className="object-contain max-h-60 max-w-full"
                                        />
                                      </div>
                                    ) : msg.file.localUrl && msg.file.decryptedType === "application/pdf" ? (
                                      <div className="rounded-xl overflow-hidden h-40 border border-white/10 bg-black/30 flex flex-col justify-center items-center text-center p-4">
                                        <FileText className="w-12 h-12 text-red-400 mb-2" />
                                        <span className="text-xs text-gray-300 font-medium truncate w-full">
                                          {msg.file.decryptedName}
                                        </span>
                                        <a
                                          href={msg.file.localUrl}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-xs text-purple-400 hover:underline flex items-center gap-1 mt-2"
                                        >
                                          <Eye className="w-3.5 h-3.5" /> View PDF
                                        </a>
                                      </div>
                                    ) : (
                                      /* General File Box before/after download */
                                      <div className="flex items-center gap-3 p-2.5 rounded-xl bg-black/20 border border-white/5">
                                        <div className="p-2.5 rounded-xl bg-white/5 text-purple-400">
                                          {msg.file.decryptedType?.startsWith("image/") ? (
                                            <ImageIcon className="w-6 h-6" />
                                          ) : msg.file.decryptedType === "application/pdf" ? (
                                            <FileText className="w-6 h-6" />
                                          ) : (
                                            <File className="w-6 h-6" />
                                          )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-xs font-semibold text-white truncate">
                                            {msg.file.decryptedName || "Encrypted File"}
                                          </p>
                                          <p className="text-[10px] text-gray-400 font-medium mt-0.5">
                                            {formatSize(msg.file.size)}
                                          </p>
                                        </div>
                                      </div>
                                    )}

                                    {/* Action Buttons for downloading */}
                                    {!msg.file.localUrl ? (
                                      <button
                                        onClick={() => handleDownloadFile(msg)}
                                        disabled={downloadProgress[msg.file.fileId] !== undefined}
                                        className="w-full py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-bold transition flex items-center justify-center gap-2"
                                      >
                                        {downloadProgress[msg.file.fileId] !== undefined ? (
                                          <>
                                            <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                                            <span>Decrypting {downloadProgress[msg.file.fileId]}%</span>
                                          </>
                                        ) : (
                                          <>
                                            <Download className="w-4 h-4 text-purple-400" />
                                            <span>Decrypt & Download</span>
                                          </>
                                        )}
                                      </button>
                                    ) : (
                                      <a
                                        href={msg.file.localUrl}
                                        download={msg.file.decryptedName}
                                        className="w-full py-2 px-3 rounded-xl bg-purple-500/20 border border-purple-500/30 hover:bg-purple-500/30 text-white text-xs font-bold transition flex items-center justify-center gap-2"
                                      >
                                        <Download className="w-4 h-4" />
                                        <span>Download File</span>
                                      </a>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* Message Actions & Meta */}
                              <div className="flex items-center gap-2 mt-1.5 text-[10px] text-gray-400 px-1">
                                <span>{formatTime(msg.timestamp)}</span>
                                {isSelf && (
                                  <span>
                                    {msg.status === "sending" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                    {msg.status === "delivered" && <Check className="w-3.5 h-3.5 text-gray-500" />}
                                    {msg.status === "read" && <CheckCheck className="w-3.5 h-3.5 text-purple-400" />}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Options popup on hover */}
                            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1.5 mt-1 transition duration-150">
                              <button
                                onClick={() => setReplyTo(msg)}
                                className="p-1 rounded bg-black/40 text-gray-400 hover:text-white border border-white/5"
                                title="Reply"
                              >
                                <CornerUpLeft className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => deleteMessageLocally(msg.id)}
                                className="p-1 rounded bg-black/40 text-red-400/70 hover:text-red-400 border border-white/5"
                                title="Delete for me"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}

                    {/* Peer Typing Indicator bubble */}
                    {isPeerTyping && (
                      <div className="flex flex-col items-start">
                        <div className="glass-card px-4 py-2.5 rounded-2xl rounded-tl-none border border-white/5 flex items-center gap-1">
                          <span className="dot-typing w-2 h-2 rounded-full bg-purple-400" />
                          <span className="dot-typing w-2 h-2 rounded-full bg-purple-400" />
                          <span className="dot-typing w-2 h-2 rounded-full bg-purple-400" />
                        </div>
                        <span className="text-[9px] text-gray-500 mt-1 pl-1">
                          {isPeerTyping} is typing...
                        </span>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* Chat View Input Tray */}
              {(activeChatUser || activeGroupRoom) && (
                <div className="p-4 md:p-6 border-t border-white/5 bg-black/10">
                  {/* File Upload/Encryption State */}
                  {uploadProgress !== null && (
                    <div className="mb-4 glass-card px-4 py-3 rounded-2xl border border-white/5 flex items-center gap-3">
                      <Loader2 className="w-5 h-5 animate-spin text-purple-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between text-xs text-white font-bold mb-1">
                          <span>Securing & Encrypting File Payload...</span>
                          <span>{uploadProgress}%</span>
                        </div>
                        <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="accent-bg-gradient h-full transition-all duration-300"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Reply Banner */}
                  {replyTo && (
                    <div className="mb-3 px-4 py-2 rounded-2xl bg-white/5 border-l-2 border-purple-500 flex justify-between items-center text-xs animate-slideDown">
                      <div className="truncate">
                        <span className="text-purple-400 font-bold">Replying to {replyTo.sender === username ? "yourself" : replyTo.sender}: </span>
                        <span className="text-gray-300 font-light italic truncate ml-1">
                          {replyTo.text || "[File Share]"}
                        </span>
                      </div>
                      <button
                        onClick={() => setReplyTo(null)}
                        className="text-gray-400 hover:text-white p-1"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Message Input Box */}
                  <form onSubmit={handleSendMessage} className="flex gap-3 items-center relative">
                    {/* Attach File Button */}
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="p-3.5 rounded-2xl glass-card text-gray-400 hover:text-white hover:border-purple-500/30 transition shrink-0"
                    >
                      <Paperclip className="w-5 h-5" />
                    </button>

                    {/* Chat Text Input field */}
                    <div className="flex-1 relative flex items-center">
                      <input
                        type="text"
                        value={messageInput}
                        onChange={handleInputChange}
                        placeholder="Write a message..."
                        className="w-full px-4 py-3.5 pr-12 rounded-2xl glass-input text-white text-sm"
                        disabled={uploadProgress !== null}
                      />
                      
                      {/* Emoji Picker toggle button */}
                      <button
                        type="button"
                        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                        className={`absolute right-4 p-1 rounded-lg text-gray-400 hover:text-white transition ${
                          showEmojiPicker ? "text-purple-400" : ""
                        }`}
                      >
                        <Smile className="w-5.5 h-5.5" />
                      </button>
                    </div>

                    {/* Send Button */}
                    <button
                      type="submit"
                      disabled={!messageInput.trim() || uploadProgress !== null}
                      className="p-3.5 rounded-2xl accent-bg-gradient text-white shadow-lg hover:opacity-95 transition shrink-0 disabled:opacity-50 disabled:pointer-events-none"
                    >
                      <Send className="w-5 h-5" />
                    </button>

                    {/* Glass Emoji Picker Grid */}
                    {showEmojiPicker && (
                      <div className="absolute bottom-16 right-0 w-72 h-48 rounded-2xl glass-panel-heavy p-3 overflow-y-auto grid grid-cols-6 gap-2 border border-white/10 z-40 animate-slideUp">
                        {EMOJIS.map((emoji, index) => (
                          <button
                            key={index}
                            type="button"
                            onClick={() => {
                              setMessageInput((prev) => prev + emoji);
                              setShowEmojiPicker(false);
                            }}
                            className="text-2xl hover:scale-125 transition active:scale-95 duration-75 text-center flex items-center justify-center"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </form>
                </div>
              )}
            </div>

            {/* Sidebar Settings Panel */}
            <AnimatePresence>
              {showSettings && (
                <motion.div
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: "320px", opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ type: "spring", bounce: 0.1, duration: 0.3 }}
                  className="h-full border-l border-white/5 bg-black/25 flex flex-col overflow-hidden shrink-0"
                >
                  <div className="p-6 border-b border-white/5 flex items-center justify-between">
                    <h3 className="font-bold text-white text-lg">
                      {activeGroupRoom ? "Group Details" : "Settings"}
                    </h3>
                    <button
                      onClick={() => setShowSettings(false)}
                      className="p-1.5 rounded-xl glass-card text-gray-400 hover:text-white"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="p-6 space-y-8 flex-1 overflow-y-auto">
                    {/* Active Group Members Segment */}
                    {activeGroupRoom && (
                      <div className="space-y-3">
                        <label className="text-xs uppercase tracking-wider text-gray-400 font-bold flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-purple-400" />
                          <span>Active Members ({groupMembers.length})</span>
                        </label>
                        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                          {groupMembers.map((member) => (
                            <div
                              key={member}
                              className="flex items-center gap-2.5 p-2 rounded-xl bg-white/5 border border-white/5 text-sm"
                            >
                              <div className="w-6 h-6 rounded-full bg-purple-500/10 flex items-center justify-center text-[10px] text-purple-300 font-bold border border-purple-500/20">
                                {member.substring(0, 2).toUpperCase()}
                              </div>
                              <span className="text-gray-200 font-semibold truncate flex-1">
                                {member} {member === username && <span className="text-[10px] text-gray-500 font-normal italic">(You)</span>}
                              </span>
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Change Username Segment */}
                    <div className="space-y-3">
                      <label className="text-xs uppercase tracking-wider text-gray-400 font-bold">
                        Change Username
                      </label>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const inputVal = e.currentTarget.usernameVal.value.trim();
                          if (inputVal && inputVal !== username) {
                            changeUsername(inputVal);
                          }
                        }}
                        className="space-y-2"
                      >
                        <input
                          name="usernameVal"
                          type="text"
                          defaultValue={username}
                          className="w-full px-3 py-2.5 rounded-xl glass-input text-sm text-white"
                        />
                        <button
                          type="submit"
                          className="w-full py-2.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 text-xs font-bold border border-purple-500/20 transition"
                        >
                          Save Changes
                        </button>
                      </form>
                    </div>

                    {/* Accent Color Theme Preset Segment */}
                    <div className="space-y-3">
                      <label className="text-xs uppercase tracking-wider text-gray-400 font-bold">
                        Accent Theme
                      </label>
                      <div className="space-y-2">
                        {THEMES.map((t) => (
                          <button
                            key={t.id}
                            onClick={() => handleThemeChange(t.id)}
                            className={`w-full flex items-center gap-3 p-2.5 rounded-xl border transition ${
                              activeTheme === t.id
                                ? "bg-white/5 border-purple-500/50 text-white"
                                : "border-transparent text-gray-400 hover:bg-white/5 hover:text-white"
                            }`}
                          >
                            <span className={`w-3.5 h-3.5 rounded-full bg-gradient-to-tr ${t.accent}`} />
                            <span className="text-sm font-semibold">{t.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Sound Switcher Segment */}
                    <div className="space-y-3">
                      <label className="text-xs uppercase tracking-wider text-gray-400 font-bold">
                        App Notifications
                      </label>
                      <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                        <span className="text-sm font-medium text-gray-300">Sound Effects</span>
                        <button
                          onClick={() => setNotificationSound(!notificationSound)}
                          className={`w-11 h-6 rounded-full transition-colors relative ${
                            notificationSound ? "bg-purple-500" : "bg-white/10"
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 bg-white w-5 h-5 rounded-full shadow-md transition-transform ${
                              notificationSound ? "translate-x-5" : ""
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="p-6 border-t border-white/5 bg-black/10 text-center">
                    <p className="text-[10px] text-gray-500 font-light">
                      Netchat v1.0.0. Client Session keys are ephemeral.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
