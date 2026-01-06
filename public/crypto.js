// Encryption utilities using Web Crypto API
// Uses PBKDF2 for key derivation and AES-GCM for encryption

const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const ITERATIONS = 100000;

// Derive a cryptographic key from a PIN using PBKDF2
async function deriveKey(pin, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Encrypt a string with a PIN, returns base64-encoded result
export async function encryptWithPin(plaintext, pin) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(pin, salt);

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext)
  );

  // Combine salt + iv + ciphertext into one array
  const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);

  // Return as base64
  return btoa(String.fromCharCode(...combined));
}

// Decrypt a base64-encoded ciphertext with a PIN
export async function decryptWithPin(ciphertext, pin) {
  try {
    // Decode base64
    const combined = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));

    // Extract salt, iv, and encrypted data
    const salt = combined.slice(0, SALT_LENGTH);
    const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const encrypted = combined.slice(SALT_LENGTH + IV_LENGTH);

    const key = await deriveKey(pin, salt);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      encrypted
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (_err) {
    throw new Error("Decryption failed. Wrong PIN?");
  }
}

// Check if there's an encrypted secret stored
export function hasEncryptedSecret() {
  const { ENCRYPTED_SECRET_KEY } = getConstants();
  return !!localStorage.getItem(ENCRYPTED_SECRET_KEY);
}

// Store encrypted secret
export function storeEncryptedSecret(encryptedData) {
  const { ENCRYPTED_SECRET_KEY } = getConstants();
  localStorage.setItem(ENCRYPTED_SECRET_KEY, encryptedData);
}

// Get encrypted secret
export function getEncryptedSecret() {
  const { ENCRYPTED_SECRET_KEY } = getConstants();
  return localStorage.getItem(ENCRYPTED_SECRET_KEY);
}

// Clear encrypted secret
export function clearEncryptedSecret() {
  const { ENCRYPTED_SECRET_KEY } = getConstants();
  localStorage.removeItem(ENCRYPTED_SECRET_KEY);
}

// Check if there's an encrypted bunker stored
export function hasEncryptedBunker() {
  const { ENCRYPTED_BUNKER_KEY } = getConstants();
  return !!localStorage.getItem(ENCRYPTED_BUNKER_KEY);
}

// Store encrypted bunker
export function storeEncryptedBunker(encryptedData) {
  const { ENCRYPTED_BUNKER_KEY } = getConstants();
  localStorage.setItem(ENCRYPTED_BUNKER_KEY, encryptedData);
}

// Get encrypted bunker
export function getEncryptedBunker() {
  const { ENCRYPTED_BUNKER_KEY } = getConstants();
  return localStorage.getItem(ENCRYPTED_BUNKER_KEY);
}

// Clear encrypted bunker
export function clearEncryptedBunker() {
  const { ENCRYPTED_BUNKER_KEY } = getConstants();
  localStorage.removeItem(ENCRYPTED_BUNKER_KEY);
}

// Lazy load constants to avoid circular dependency
function getConstants() {
  return {
    ENCRYPTED_SECRET_KEY: "nostr_encrypted_secret",
    ENCRYPTED_BUNKER_KEY: "nostr_encrypted_bunker",
  };
}
