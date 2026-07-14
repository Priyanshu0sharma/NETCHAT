// Client-side End-to-End Encryption (E2EE) helper using Web Crypto API.
// This is executed entirely in the user's browser.

// Convert an ArrayBuffer to a Base64 string
export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return typeof window !== "undefined" ? window.btoa(binary) : Buffer.from(binary, "binary").toString("base64");
}

// Convert a Base64 string to an ArrayBuffer
export function base64ToBuffer(base64: string): ArrayBuffer {
  const binaryString = typeof window !== "undefined" ? window.atob(base64) : Buffer.from(base64, "base64").toString("binary");
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Generate an ephemeral ECDH keypair (using NIST curve P-256)
export async function generateECDHKeyPair(): Promise<CryptoKeyPair> {
  if (typeof window === "undefined" || !window.crypto || !window.crypto.subtle) {
    throw new Error("Web Crypto API is not supported in this environment");
  }
  return await window.crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true, // extractable (necessary to export public key)
    ["deriveKey"]
  );
}

// Export the public key as a Base64 string
export async function exportPublicKey(publicKey: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey("raw", publicKey);
  return bufferToBase64(exported);
}

// Import a peer's raw public key from a Base64 string
export async function importPublicKey(keyStr: string): Promise<CryptoKey> {
  const keyBuffer = base64ToBuffer(keyStr);
  return await window.crypto.subtle.importKey(
    "raw",
    keyBuffer,
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    []
  );
}

// Derive a shared AES-GCM symmetric key using local private key and peer's public key
export async function deriveSharedKey(
  localPrivateKey: CryptoKey,
  peerPublicKey: CryptoKey
): Promise<CryptoKey> {
  return await window.crypto.subtle.deriveKey(
    {
      name: "ECDH",
      public: peerPublicKey,
    },
    localPrivateKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    false, // not extractable
    ["encrypt", "decrypt"]
  );
}

// Encrypt plaintext message with a shared AES-GCM key
export async function encryptMessage(
  sharedKey: CryptoKey,
  plaintext: string
): Promise<{ ciphertext: string; iv: string }> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
  const encoded = new TextEncoder().encode(plaintext);
  
  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    sharedKey,
    encoded
  );

  return {
    ciphertext: bufferToBase64(ciphertextBuffer),
    iv: bufferToBase64(iv.buffer),
  };
}

// Decrypt ciphertext using shared AES-GCM key and IV
export async function decryptMessage(
  sharedKey: CryptoKey,
  ciphertext: string,
  ivStr: string
): Promise<string> {
  const ciphertextBuffer = base64ToBuffer(ciphertext);
  const ivBuffer = base64ToBuffer(ivStr);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ivBuffer,
    },
    sharedKey,
    ciphertextBuffer
  );

  return new TextDecoder().decode(decryptedBuffer);
}

// Helper to encrypt a file's base64 or raw string representation
export async function encryptFileBuffer(
  sharedKey: CryptoKey,
  fileData: ArrayBuffer
): Promise<{ encryptedData: string; iv: string }> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    sharedKey,
    fileData
  );
  
  return {
    encryptedData: bufferToBase64(ciphertextBuffer),
    iv: bufferToBase64(iv.buffer),
  };
}

// Helper to decrypt file contents back to ArrayBuffer
export async function decryptFileBuffer(
  sharedKey: CryptoKey,
  encryptedDataBase64: string,
  ivStr: string
): Promise<ArrayBuffer> {
  const ciphertextBuffer = base64ToBuffer(encryptedDataBase64);
  const ivBuffer = base64ToBuffer(ivStr);

  return await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ivBuffer,
    },
    sharedKey,
    ciphertextBuffer
  );
}
