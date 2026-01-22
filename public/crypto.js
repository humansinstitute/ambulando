// Encryption utilities using Web Crypto API
// Uses PBKDF2 for key derivation and AES-GCM for encryption
// Now stores encrypted secrets in IndexedDB via Dexie

import { getSecret, setSecret, deleteSecret, hasSecret, initDB } from "./db.js";

const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const ITERATIONS = 100000;

// Secret IDs for IndexedDB storage
const SECRET_IDS = {
  ENCRYPTED_SECRET: "nostr_encrypted_secret",
  ENCRYPTED_BUNKER: "nostr_encrypted_bunker",
};

// Legacy localStorage keys (for migration)
const LEGACY_KEYS = {
  ENCRYPTED_SECRET_KEY: "nostr_encrypted_secret",
  ENCRYPTED_BUNKER_KEY: "nostr_encrypted_bunker",
};

// Track if we've migrated from localStorage
let migrationDone = false;

// Migrate secrets from localStorage to IndexedDB
async function migrateFromLocalStorage() {
  if (migrationDone) return;

  try {
    await initDB();

    // Migrate encrypted secret
    const legacySecret = localStorage.getItem(LEGACY_KEYS.ENCRYPTED_SECRET_KEY);
    if (legacySecret) {
      const existing = await hasSecret(SECRET_IDS.ENCRYPTED_SECRET);
      if (!existing) {
        await setSecret(SECRET_IDS.ENCRYPTED_SECRET, legacySecret);
        console.log("[crypto] Migrated encrypted secret to IndexedDB");
      }
      // Keep localStorage copy for backward compatibility during transition
    }

    // Migrate encrypted bunker
    const legacyBunker = localStorage.getItem(LEGACY_KEYS.ENCRYPTED_BUNKER_KEY);
    if (legacyBunker) {
      const existing = await hasSecret(SECRET_IDS.ENCRYPTED_BUNKER);
      if (!existing) {
        await setSecret(SECRET_IDS.ENCRYPTED_BUNKER, legacyBunker);
        console.log("[crypto] Migrated encrypted bunker to IndexedDB");
      }
    }

    migrationDone = true;
  } catch (err) {
    console.error("[crypto] Migration failed:", err);
  }
}

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
  // Check if Web Crypto is available (requires secure context or localhost)
  if (!crypto.subtle) {
    throw new Error("Web Crypto API not available. HTTPS required for encryption.");
  }

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
export async function hasEncryptedSecret() {
  await migrateFromLocalStorage();

  try {
    return await hasSecret(SECRET_IDS.ENCRYPTED_SECRET);
  } catch (_err) {
    // Fallback to localStorage
    return !!localStorage.getItem(LEGACY_KEYS.ENCRYPTED_SECRET_KEY);
  }
}

// Store encrypted secret
export async function storeEncryptedSecret(encryptedData) {
  await migrateFromLocalStorage();

  try {
    await setSecret(SECRET_IDS.ENCRYPTED_SECRET, encryptedData);
  } catch (_err) {
    // Fallback to localStorage
    localStorage.setItem(LEGACY_KEYS.ENCRYPTED_SECRET_KEY, encryptedData);
  }
}

// Get encrypted secret
export async function getEncryptedSecret() {
  await migrateFromLocalStorage();

  try {
    const secret = await getSecret(SECRET_IDS.ENCRYPTED_SECRET);
    if (secret?.data) return secret.data;
  } catch (_err) {
    // Fallback to localStorage
  }
  return localStorage.getItem(LEGACY_KEYS.ENCRYPTED_SECRET_KEY);
}

// Clear encrypted secret
export async function clearEncryptedSecret() {
  try {
    await deleteSecret(SECRET_IDS.ENCRYPTED_SECRET);
  } catch (_err) {
    // Ignore errors
  }
  localStorage.removeItem(LEGACY_KEYS.ENCRYPTED_SECRET_KEY);
}

// Check if there's an encrypted bunker stored
export async function hasEncryptedBunker() {
  await migrateFromLocalStorage();

  try {
    return await hasSecret(SECRET_IDS.ENCRYPTED_BUNKER);
  } catch (_err) {
    // Fallback to localStorage
    return !!localStorage.getItem(LEGACY_KEYS.ENCRYPTED_BUNKER_KEY);
  }
}

// Store encrypted bunker
export async function storeEncryptedBunker(encryptedData) {
  await migrateFromLocalStorage();

  try {
    await setSecret(SECRET_IDS.ENCRYPTED_BUNKER, encryptedData);
  } catch (_err) {
    // Fallback to localStorage
    localStorage.setItem(LEGACY_KEYS.ENCRYPTED_BUNKER_KEY, encryptedData);
  }
}

// Get encrypted bunker
export async function getEncryptedBunker() {
  await migrateFromLocalStorage();

  try {
    const secret = await getSecret(SECRET_IDS.ENCRYPTED_BUNKER);
    if (secret?.data) return secret.data;
  } catch (_err) {
    // Fallback to localStorage
  }
  return localStorage.getItem(LEGACY_KEYS.ENCRYPTED_BUNKER_KEY);
}

// Clear encrypted bunker
export async function clearEncryptedBunker() {
  try {
    await deleteSecret(SECRET_IDS.ENCRYPTED_BUNKER);
  } catch (_err) {
    // Ignore errors
  }
  localStorage.removeItem(LEGACY_KEYS.ENCRYPTED_BUNKER_KEY);
}
