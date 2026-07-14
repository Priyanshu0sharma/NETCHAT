# Netchat (netchat)

A highly premium, modern, temporary, anonymous global messenger built with **Next.js**, **TypeScript**, **Tailwind CSS**, and **Socket.IO**. 

This is **NOT** a random matching application. It is a **temporary username-based messenger**. Users can chat instantly with anyone in the world if they know that person's unique, temporary username.

---

## 🔒 Security & Privacy Core Features

- **No Persistence**: Everything is kept strictly in-memory (RAM). No database, no local storage.
- **Auto Cleanup**: The moment a conversation ends and both users disconnect, all text logs and file buffers are immediately wiped from the server's memory.
- **Client-Side End-to-End Encryption (E2EE)**: 
  - Elliptic-curve Diffie-Hellman (ECDH P-256) ephemeral key exchange triggers on conversation start.
  - Direct message payloads, file names, and file binary contents are encrypted in-browser using AES-GCM 256.
  - The server only acts as a routing node and has zero knowledge of the message content or file details.
- **Secure File Sharing**: Support for Images, PDFs, ZIPs, Docs, etc., with full encryption in transit, upload progress tracking, download callbacks, and in-browser previews for images and PDFs.

---

## 🛠️ Architecture

- **Frontend**: Next.js App Router, Tailwind CSS v4, Framer Motion, and Web Audio API synthesized chimes.
- **Backend**: Node.js + Express + Socket.IO server running completely in-memory.

---

## 💻 Local Setup & Development

### 1. Start the Backend Server
```bash
cd server
npm install
npm run dev
# The server will start on http://localhost:3001
```

### 2. Start the Frontend
```bash
# In the root project directory
npm install
npm run dev
# The frontend will start on http://localhost:3000
```
Open two browser windows (one standard and one incognito) at `http://localhost:3000` to test local secure chat.

---

## 🌐 Public Deployments (Make it Online)

To allow users in India, America, Europe, etc., to connect and chat:

### 1. Backend Server Deployment
Deploy the backend Node.js server on **Railway**, **Render**, **Fly.io**, or any cloud VPS:
- Set up a dynamic port using the environment variable `PORT` (handled automatically).
- Configure the **Environment Variable** `FRONTEND_URL` to point to your live Next.js production address (e.g. `https://netchat-frontend.vercel.app`).
- Set build command: `npm run build`
- Set start command: `npm start`

### 2. Frontend Next.js Deployment
Deploy the frontend Next.js application on **Vercel** or **Netlify**:
- Add the **Environment Variable** `NEXT_PUBLIC_SOCKET_SERVER_URL` pointing to your deployed Node.js backend address (e.g. `https://netchat-backend.up.railway.app`).
- Ensure it compiles and deploys using standard Next.js parameters.
