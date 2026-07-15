"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import {
  generateECDHKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSharedKey,
  encryptMessage,
  decryptMessage,
  encryptFileBuffer,
  decryptFileBuffer,
  base64ToBuffer,
  bufferToBase64
} from "@/lib/crypto";

export interface Message {
  id: string;
  sender: string;
  receiver: string; // username, "group:roomId", or "system"
  text?: string;
  file?: {
    fileId: string;
    encryptedName?: string;
    encryptedType?: string;
    size: number;
    iv?: string; // missing for unencrypted group files
    decryptedName?: string;
    decryptedType?: string;
    localUrl?: string;
  };
  timestamp: number;
  status: "sending" | "delivered" | "read";
  replyTo?: string;
  self?: boolean;
  isSystem?: boolean;
}

const SOCKET_SERVER_URL = process.env.NEXT_PUBLIC_SOCKET_SERVER_URL || "http://localhost:3001";

export function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [username, setUsername] = useState<string>("");
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "validating" | "taken" | "available">("idle");
  
  // Direct Chat states
  const [activeChatUser, setActiveChatUser] = useState<string | null>(null);
  const [activeChatOnline, setActiveChatOnline] = useState(false);
  
  // Group Room states
  const [activeGroupRoom, setActiveGroupRoom] = useState<string | null>(null);
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  
  // Online Users List
  const [onlineUsersList, setOnlineUsersList] = useState<string[]>([]);

  // Combined messages list
  const [messages, setMessages] = useState<Message[]>([]);
  const [isPeerTyping, setIsPeerTyping] = useState<string | null>(null);
  const [notificationSound, setNotificationSound] = useState(true);

  // References for keeping cryptographic keys in-memory (never written to disk)
  const localKeyPairRef = useRef<CryptoKeyPair | null>(null);
  const sharedKeyRef = useRef<CryptoKey | null>(null);

  // Stable references for state variables used inside socket listeners to prevent connection recreation
  const activeChatUserRef = useRef<string | null>(null);
  const usernameRef = useRef<string>("");
  const notificationSoundRef = useRef<boolean>(true);

  // Keep refs in sync with state changes
  useEffect(() => {
    activeChatUserRef.current = activeChatUser;
  }, [activeChatUser]);

  useEffect(() => {
    usernameRef.current = username;
  }, [username]);

  useEffect(() => {
    notificationSoundRef.current = notificationSound;
  }, [notificationSound]);

  // Synthesized audio chime using Web Audio API
  const playNotificationSound = () => {
    if (!notificationSoundRef.current || typeof window === "undefined") return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const playTone = (freq: number, start: number, duration: number) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.12, start + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(start);
        osc.stop(start + duration);
      };
      const now = audioCtx.currentTime;
      playTone(587.33, now, 0.3); // D5
      playTone(880.00, now + 0.08, 0.35); // A5
    } catch (err) {
      console.warn("Web Audio chime blocked:", err);
    }
  };

  // Connect to Socket.IO Server
  useEffect(() => {
    const newSocket = io(SOCKET_SERVER_URL, {
      autoConnect: true,
      transports: ["polling", "websocket"],
    });

    setSocket(newSocket);

    newSocket.on("connect", () => {
      setConnected(true);
      setConnectError(null);
      // If we already had a username, register it. Otherwise, request a random one.
      const storedName = sessionStorage.getItem("netchat_username");
      newSocket.emit("register-username", { requested: storedName || null });
    });

    newSocket.on("disconnect", () => {
      setConnected(false);
    });

    newSocket.on("connect_error", (err) => {
      setConnectError(err.message || "Failed to connect to signaling server.");
    });

    // Receive assigned username (could be a generated random one or the accepted custom one)
    newSocket.on("username-assigned", ({ username: assignedName }: { username: string }) => {
      setUsername(assignedName);
      sessionStorage.setItem("netchat_username", assignedName);
      setUsernameStatus("idle");
    });

    // Username change status response
    newSocket.on("username-status", ({ status, username: checkedName }: { status: "available" | "taken"; username: string }) => {
      if (status === "available") {
        setUsername(checkedName);
        sessionStorage.setItem("netchat_username", checkedName);
        setUsernameStatus("available");
      } else {
        setUsernameStatus("taken");
      }
    });

    // Receive online users list
    newSocket.on("update-online-users", ({ users }: { users: string[] }) => {
      setOnlineUsersList(users.filter((u) => u !== usernameRef.current && u !== ""));
    });

    // Handshake 1: Receive initiate request from peer (who looked us up and wants to chat)
    newSocket.on("initiate-chat-request", async ({ from, peerPublicKey }: { from: string; peerPublicKey: string }) => {
      try {
        // 1. Generate our own local ECDH keypair if not already generated
        if (!localKeyPairRef.current) {
          localKeyPairRef.current = await generateECDHKeyPair();
        }
        
        // 2. Import peer's public key
        const importedPeerKey = await importPublicKey(peerPublicKey);
        
        // 3. Derive the shared AES-GCM symmetric key
        const derivedKey = await deriveSharedKey(localKeyPairRef.current.privateKey, importedPeerKey);
        sharedKeyRef.current = derivedKey;
        
        // 4. Export our public key to send back to the initiator
        const myPublicKeyBase64 = await exportPublicKey(localKeyPairRef.current.publicKey);
        
        // 5. Accept chat and send our public key back
        newSocket.emit("accept-chat-response", { to: from, myPublicKey: myPublicKeyBase64 });
        
        // 6. Set active chat state, clear group state
        setActiveGroupRoom(null);
        setActiveChatUser(from);
        setActiveChatOnline(true);
        setMessages([]);
      } catch (err) {
        console.error("E2EE Handshake failed", err);
      }
    });

    // Handshake 2: Initiator receives the peer's public key back
    newSocket.on("accept-chat-response", async ({ from, peerPublicKey }: { from: string; peerPublicKey: string }) => {
      try {
        if (!localKeyPairRef.current) return;
        
        // 1. Import peer's public key
        const importedPeerKey = await importPublicKey(peerPublicKey);
        
        // 2. Derive shared key
        const derivedKey = await deriveSharedKey(localKeyPairRef.current.privateKey, importedPeerKey);
        sharedKeyRef.current = derivedKey;
        
        // 3. Complete setup, clear group state
        setActiveGroupRoom(null);
        setActiveChatUser(from);
        setActiveChatOnline(true);
        setMessages([]);
      } catch (err) {
        console.error("E2EE Completing handshake failed", err);
      }
    });

    // Receive E2EE private message
    newSocket.on("message", async (msg: { id: string; sender: string; receiver: string; encryptedText?: string; iv: string; file?: any; timestamp: number; replyTo?: string }) => {
      try {
        if (!sharedKeyRef.current) return;

        let decryptedText: string | undefined;
        let fileData: any = undefined;

        if (msg.encryptedText) {
          decryptedText = await decryptMessage(sharedKeyRef.current, msg.encryptedText, msg.iv);
        }

        if (msg.file) {
          const decryptedName = await decryptMessage(sharedKeyRef.current, msg.file.encryptedName, msg.file.iv);
          const decryptedType = await decryptMessage(sharedKeyRef.current, msg.file.encryptedType, msg.file.iv);
          fileData = {
            ...msg.file,
            decryptedName,
            decryptedType,
          };
        }

        const newMsg: Message = {
          id: msg.id,
          sender: msg.sender,
          receiver: msg.receiver,
          text: decryptedText,
          file: fileData,
          timestamp: msg.timestamp,
          status: "delivered",
          replyTo: msg.replyTo,
        };

        setMessages((prev) => [...prev, newMsg]);
        playNotificationSound();

        // Emit read status
        newSocket.emit("message-status", { messageId: msg.id, to: msg.sender, status: "read" });
      } catch (err) {
        console.error("Failed to decrypt incoming message", err);
      }
    });

    // Receive group message
    newSocket.on("group-message", (msg: { id: string; roomId: string; sender: string; text?: string; file?: any; timestamp: number; replyTo?: string }) => {
      const newMsg: Message = {
        id: msg.id,
        sender: msg.sender,
        receiver: "group:" + msg.roomId,
        text: msg.text,
        file: msg.file,
        timestamp: msg.timestamp,
        status: "delivered",
        replyTo: msg.replyTo,
      };
      setMessages((prev) => [...prev, newMsg]);
      playNotificationSound();
    });

    // Receive group system notification
    newSocket.on("group-system-message", (msg: { id: string; text: string; timestamp: number }) => {
      const newMsg: Message = {
        id: msg.id,
        sender: "system",
        receiver: "group",
        text: msg.text,
        timestamp: msg.timestamp,
        status: "delivered",
        isSystem: true,
      };
      setMessages((prev) => [...prev, newMsg]);
    });

    // Listen to typing status from peer (private chat)
    newSocket.on("typing-status", ({ from, isTyping }: { from: string; isTyping: boolean }) => {
      if (from === activeChatUserRef.current) {
        setIsPeerTyping(isTyping ? from : null);
      }
    });

    // Listen to typing status from room (group chat)
    newSocket.on("group-typing-status", ({ from, isTyping }: { from: string; isTyping: boolean }) => {
      setIsPeerTyping(isTyping ? from : null);
    });

    // Listen to group member list updates
    newSocket.on("update-group-members", ({ roomId, members }: { roomId: string; members: string[] }) => {
      setGroupMembers(members);
    });

    // Listen to message delivery/read statuses (private chat)
    newSocket.on("message-status", ({ messageId, status }: { messageId: string; status: "delivered" | "read" }) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, status } : m))
      );
    });

    // Listen to peer connection updates (private chat)
    newSocket.on("peer-status", ({ username: peerName, online }: { username: string; online: boolean }) => {
      if (peerName === activeChatUserRef.current) {
        setActiveChatOnline(online);
        if (!online) {
          setIsPeerTyping(null);
        }
      }
    });

    return () => {
      newSocket.close();
    };
  }, []);

  // Request custom username change
  const changeUsername = (newUsername: string) => {
    if (!socket || !newUsername.trim()) return;
    setUsernameStatus("validating");
    socket.emit("register-username", { requested: newUsername.trim() });
  };

  // Search and initiate chat with another username
  const startChatWith = async (targetUsername: string): Promise<{ success: boolean; error?: string }> => {
    return new Promise((resolve) => {
      if (!socket) return resolve({ success: false, error: "Not connected to server" });
      if (targetUsername === username) return resolve({ success: false, error: "Cannot chat with yourself" });

      socket.emit("check-username", { username: targetUsername }, async ({ exists }: { exists: boolean }) => {
        if (!exists) {
          resolve({ success: false, error: "User is Offline" });
        } else {
          try {
            // Generate ECDH key pair
            localKeyPairRef.current = await generateECDHKeyPair();
            const myPublicKeyBase64 = await exportPublicKey(localKeyPairRef.current.publicKey);
            
            // Send connection request with our public key
            socket.emit("initiate-chat-request", { to: targetUsername, peerPublicKey: myPublicKeyBase64 });
            
            // Set partial states, wait for response
            setActiveGroupRoom(null);
            setActiveChatUser(targetUsername);
            setActiveChatOnline(true);
            setMessages([]);
            resolve({ success: true });
          } catch (err) {
            resolve({ success: false, error: "Failed to initialize secure connection" });
          }
        }
      });
    });
  };

  // Join a Group Room
  const joinGroupRoom = (roomId: string) => {
    if (!socket || !roomId.trim()) return;
    const cleanRoomId = roomId.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!cleanRoomId) return;

    setActiveChatUser(null);
    setActiveGroupRoom(cleanRoomId);
    setMessages([]);
    socket.emit("join-group", { roomId: cleanRoomId });
  };

  // Leave active Group Room
  const leaveGroupRoom = () => {
    if (!socket || !activeGroupRoom) return;
    socket.emit("leave-group", { roomId: activeGroupRoom });
    setActiveGroupRoom(null);
    setGroupMembers([]);
    setMessages([]);
  };

  // Send message (E2EE for private, TLS/WSS for group)
  const sendMessage = async (text: string, replyToId?: string) => {
    if (!socket) return;
    const messageId = Math.random().toString(36).substring(2, 11);
    const timestamp = Date.now();

    if (activeGroupRoom) {
      // Group messaging (routed securely via secure WebSockets)
      socket.emit("group-message", {
        id: messageId,
        roomId: activeGroupRoom,
        text,
        timestamp,
        replyTo: replyToId
      });

      const newMsg: Message = {
        id: messageId,
        sender: username,
        receiver: "group:" + activeGroupRoom,
        text,
        timestamp,
        status: "delivered",
        replyTo: replyToId,
        self: true,
      };

      setMessages((prev) => [...prev, newMsg]);
    } else if (activeChatUser && sharedKeyRef.current) {
      // Private E2EE messaging
      try {
        const { ciphertext, iv } = await encryptMessage(sharedKeyRef.current, text);

        socket.emit("message", {
          id: messageId,
          to: activeChatUser,
          encryptedText: ciphertext,
          iv: iv,
          timestamp,
          replyTo: replyToId
        });

        const newMsg: Message = {
          id: messageId,
          sender: username,
          receiver: activeChatUser,
          text: text,
          timestamp,
          status: "sending",
          replyTo: replyToId,
          self: true,
        };

        setMessages((prev) => [...prev, newMsg]);
      } catch (err) {
        console.error("Encryption failed, message not sent", err);
      }
    }
  };

  // Send typing indicator
  const sendTypingStatus = (isTyping: boolean) => {
    if (!socket) return;
    if (activeGroupRoom) {
      socket.emit("group-typing-status", { roomId: activeGroupRoom, isTyping });
    } else if (activeChatUser) {
      socket.emit("typing-status", { to: activeChatUser, isTyping });
    }
  };

  // File Upload handler (E2EE for private, TLS/WSS for group)
  const sendFile = async (
    file: File,
    onProgress: (progress: number) => void,
    replyToId?: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!socket) return { success: false, error: "Not connected to server" };
    const messageId = Math.random().toString(36).substring(2, 11);
    const timestamp = Date.now();

    if (activeGroupRoom) {
      // Group File Share (sent unencrypted via TLS/WSS, buffer holds only in RAM)
      try {
        onProgress(10);
        const formData = new FormData();
        formData.append("file", file);
        formData.append("sender", username);
        formData.append("receiver", "group:" + activeGroupRoom);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${SOCKET_SERVER_URL}/upload`);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const uploadPercent = Math.round((e.loaded / e.total) * 80) + 10;
            onProgress(uploadPercent);
          }
        };

        const uploadResult = await new Promise<{ success: boolean; fileId?: string; error?: string }>((resolve) => {
          xhr.onload = () => {
            if (xhr.status === 200) {
              try {
                const res = JSON.parse(xhr.responseText);
                resolve({ success: true, fileId: res.fileId });
              } catch (err) {
                resolve({ success: false, error: "Failed to parse upload response" });
              }
            } else {
              resolve({ success: false, error: `Upload failed with status ${xhr.status} from ${SOCKET_SERVER_URL}/upload` });
            }
          };
          xhr.onerror = () => resolve({ success: false, error: `Network error during upload to ${SOCKET_SERVER_URL}/upload` });
          xhr.send(formData);
        });

        if (!uploadResult.success || !uploadResult.fileId) {
          return { success: false, error: uploadResult.error || "Upload failed" };
        }

        onProgress(95);

        // Send group room reference
        socket.emit("group-message", {
          id: messageId,
          roomId: activeGroupRoom,
          file: {
            fileId: uploadResult.fileId,
            decryptedName: file.name,
            decryptedType: file.type,
            size: file.size,
          },
          timestamp,
          replyTo: replyToId
        });

        const newMsg: Message = {
          id: messageId,
          sender: username,
          receiver: "group:" + activeGroupRoom,
          file: {
            fileId: uploadResult.fileId,
            decryptedName: file.name,
            decryptedType: file.type,
            size: file.size,
            localUrl: URL.createObjectURL(file),
          },
          timestamp,
          status: "sending",
          replyTo: replyToId,
          self: true,
        };

        setMessages((prev) => [...prev, newMsg]);
        onProgress(100);
        return { success: true };
      } catch (err) {
        console.error("Group file upload failed", err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    } else if (activeChatUser && sharedKeyRef.current) {
      // Private chat E2EE file upload
      try {
        const fileBuffer = await file.arrayBuffer();

        onProgress(10);
        const { encryptedData, iv: fileIv } = await encryptFileBuffer(sharedKeyRef.current, fileBuffer);
        onProgress(30);

        const nameEnc = await encryptMessage(sharedKeyRef.current, file.name);
        const typeEnc = await encryptMessage(sharedKeyRef.current, file.type);
        onProgress(40);

        const encryptedBlob = new Blob([base64ToBuffer(encryptedData)], { type: "application/octet-stream" });
        
        const formData = new FormData();
        formData.append("file", encryptedBlob, "encrypted_blob");
        formData.append("sender", username);
        formData.append("receiver", activeChatUser);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${SOCKET_SERVER_URL}/upload`);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const uploadPercent = Math.round((e.loaded / e.total) * 50) + 40;
            onProgress(uploadPercent);
          }
        };

        const uploadResult = await new Promise<{ success: boolean; fileId?: string; error?: string }>((resolve) => {
          xhr.onload = () => {
            if (xhr.status === 200) {
              try {
                const res = JSON.parse(xhr.responseText);
                resolve({ success: true, fileId: res.fileId });
              } catch (err) {
                resolve({ success: false, error: "Failed to parse upload response" });
              }
            } else {
              resolve({ success: false, error: `Upload failed with status ${xhr.status} from ${SOCKET_SERVER_URL}/upload` });
            }
          };
          xhr.onerror = () => resolve({ success: false, error: `Network error during upload to ${SOCKET_SERVER_URL}/upload` });
          xhr.send(formData);
        });

        if (!uploadResult.success || !uploadResult.fileId) {
          return { success: false, error: uploadResult.error || "Upload failed" };
        }

        onProgress(95);

        socket.emit("message", {
          id: messageId,
          to: activeChatUser,
          iv: nameEnc.iv,
          file: {
            fileId: uploadResult.fileId,
            encryptedName: nameEnc.ciphertext,
            encryptedType: typeEnc.ciphertext,
            size: file.size,
            iv: fileIv,
          },
          timestamp,
          replyTo: replyToId
        });

        const newMsg: Message = {
          id: messageId,
          sender: username,
          receiver: activeChatUser,
          file: {
            fileId: uploadResult.fileId,
            encryptedName: nameEnc.ciphertext,
            encryptedType: typeEnc.ciphertext,
            size: file.size,
            iv: fileIv,
            decryptedName: file.name,
            decryptedType: file.type,
            localUrl: URL.createObjectURL(file),
          },
          timestamp,
          status: "sending",
          replyTo: replyToId,
          self: true,
        };

        setMessages((prev) => [...prev, newMsg]);
        onProgress(100);
        return { success: true };
      } catch (err) {
        console.error("E2EE file upload/encryption failed", err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    return { success: false, error: "Encryption key not derived or chat user offline" };
  };

  // Download and decrypt a file (or download directly for group files)
  const downloadAndDecryptFile = async (
    fileId: string,
    fileIv?: string,
    decryptedName?: string,
    decryptedType?: string,
    onProgress?: (progress: number) => void
  ): Promise<string | null> => {
    try {
      if (onProgress) onProgress(10);
      
      const response = await fetch(`${SOCKET_SERVER_URL}/download/${fileId}`);
      if (!response.ok) throw new Error("Failed to download file");
      
      if (onProgress) onProgress(40);
      const arrayBuffer = await response.arrayBuffer();
      if (onProgress) onProgress(70);

      let localUrl = "";

      if (activeGroupRoom || !fileIv) {
        // Group file: no decryption needed
        const blob = new Blob([arrayBuffer], { type: decryptedType || "application/octet-stream" });
        localUrl = URL.createObjectURL(blob);
      } else if (sharedKeyRef.current) {
        // Private E2EE file: decryption needed
        const encryptedBase64 = bufferToBase64(arrayBuffer);
        const decryptedBuffer = await decryptFileBuffer(sharedKeyRef.current, encryptedBase64, fileIv);
        const blob = new Blob([decryptedBuffer], { type: decryptedType || "application/octet-stream" });
        localUrl = URL.createObjectURL(blob);
      }

      if (onProgress) onProgress(100);

      // Update the local message cache to reference the downloaded URL
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.file && msg.file.fileId === fileId) {
            return {
              ...msg,
              file: {
                ...msg.file,
                localUrl,
              },
            };
          }
          return msg;
        })
      );

      return localUrl;
    } catch (err) {
      console.error("Failed to download or decrypt file", err);
      return null;
    }
  };

  // Delete message locally ("Delete for Me")
  const deleteMessageLocally = (messageId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
  };

  // Close active chat and clear local chat state (leave chat)
  const closeActiveChat = () => {
    setIsPeerTyping(null);
    if (activeGroupRoom) {
      leaveGroupRoom();
    } else {
      setActiveChatUser(null);
      setActiveChatOnline(false);
      setMessages([]);
      sharedKeyRef.current = null;
      if (socket) {
        socket.emit("leave-chat");
      }
    }
  };

  const retryConnection = () => {
    if (socket) {
      setConnectError(null);
      socket.connect();
    }
  };

  return {
    connected,
    connectError,
    serverUrl: SOCKET_SERVER_URL,
    retryConnection,
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
    closeActiveChat,
  };
}
