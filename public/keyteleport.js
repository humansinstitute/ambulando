import { debugLog } from "./debug-log.js";
import { loadNostrLibs } from "./nostr.js";
import { hide, show } from "./dom.js";

/**
 * Check for key teleport URL fragment and process if present.
 * Uses fragment URL (#keyteleport=...) so server never sees the blob.
 * Returns { secretKey: Uint8Array, npub: string } on success, null otherwise.
 */
export async function checkKeyTeleport() {
  // Read from fragment (hash), not query params
  const hash = window.location.hash;
  if (!hash.includes("keyteleport=")) return null;

  // Parse fragment as URL params
  const params = new URLSearchParams(hash.slice(1));
  const blob = params.get("keyteleport");

  if (!blob) return null;

  debugLog("keyteleport", "Key teleport fragment detected");

  // Clear URL fragment immediately (replay prevention)
  window.history.replaceState({}, "", window.location.pathname);
  debugLog("keyteleport", "URL fragment cleared");

  try {
    // URL-decode the blob (it was encoded for safe URL transport)
    const decodedBlob = decodeURIComponent(blob);

    // 1. Send blob to server for verification & decryption
    debugLog("keyteleport", "Sending blob to server for decryption...");
    const response = await fetch("/api/keyteleport", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blob: decodedBlob }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const message = error.error || `Key teleport failed (${response.status})`;
      debugLog("keyteleport", "Server error", { status: response.status, error: message });
      throw new Error(message);
    }

    const { encryptedNsec, npub } = await response.json();
    debugLog("keyteleport", "Server response received", {
      hasEncryptedNsec: !!encryptedNsec,
      npub: npub?.slice(0, 12) + "...",
    });

    // 2. Prompt user for unlock code (throwaway nsec)
    const unlockCode = await promptForUnlockCode();
    if (!unlockCode) {
      debugLog("keyteleport", "User cancelled unlock prompt");
      throw new Error("Unlock code required");
    }

    debugLog("keyteleport", "Unlock code received, decrypting...");

    // 3. Load nostr libs
    const { nip19, nip44 } = await loadNostrLibs();

    // 4. Decode throwaway nsec
    const throwawayDecoded = nip19.decode(unlockCode.trim());
    if (throwawayDecoded.type !== "nsec") {
      throw new Error("Invalid unlock code format - expected nsec");
    }
    const throwawaySecretKey = throwawayDecoded.data;
    debugLog("keyteleport", "Throwaway key decoded");

    // 5. Decode user's npub to get pubkey
    const npubDecoded = nip19.decode(npub);
    if (npubDecoded.type !== "npub") {
      throw new Error("Invalid npub from server");
    }
    const userPubkey = npubDecoded.data;
    debugLog("keyteleport", "User pubkey decoded", { pubkey: userPubkey.slice(0, 12) + "..." });

    // 6. Create NIP-44 conversation key (throwaway secret + user pubkey)
    // Note: getConversationKey expects secretKey as Uint8Array, pubkey as hex string
    const conversationKey = nip44.v2.utils.getConversationKey(throwawaySecretKey, userPubkey);
    debugLog("keyteleport", "Conversation key created");

    // 7. Decrypt the nsec
    const decryptedNsec = nip44.v2.decrypt(encryptedNsec, conversationKey);
    debugLog("keyteleport", "Nsec decrypted");

    // 8. Decode to get secret key bytes
    const nsecDecoded = nip19.decode(decryptedNsec);
    if (nsecDecoded.type !== "nsec") {
      throw new Error("Decryption failed - invalid nsec result");
    }

    debugLog("keyteleport", "Key teleport successful!");

    return {
      secretKey: nsecDecoded.data,
      npub: npub,
    };
  } catch (error) {
    debugLog("keyteleport", "Key teleport error", { error: error.message });
    showKeyTeleportError(error.message);
    return null;
  }
}

/**
 * Show the unlock code prompt overlay and wait for user input.
 */
async function promptForUnlockCode() {
  return new Promise((resolve) => {
    const overlay = document.getElementById("keyteleport-overlay");
    const input = document.getElementById("keyteleport-unlock-input");
    const submitBtn = document.getElementById("keyteleport-submit");
    const cancelBtn = document.getElementById("keyteleport-cancel");
    const errorEl = document.getElementById("keyteleport-error");

    if (!overlay || !input || !submitBtn || !cancelBtn) {
      debugLog("keyteleport", "Missing overlay elements");
      resolve(null);
      return;
    }

    // Reset state
    input.value = "";
    if (errorEl) hide(errorEl);

    show(overlay);
    input.focus();

    // Try to auto-paste from clipboard
    tryAutoPaste(input);

    const cleanup = () => {
      hide(overlay);
      input.value = "";
      submitBtn.onclick = null;
      cancelBtn.onclick = null;
      input.onkeydown = null;
    };

    submitBtn.onclick = () => {
      const value = input.value.trim();
      if (!value) {
        if (errorEl) {
          errorEl.textContent = "Please paste the unlock code";
          show(errorEl);
        }
        return;
      }
      if (!value.startsWith("nsec1")) {
        if (errorEl) {
          errorEl.textContent = "Invalid unlock code format";
          show(errorEl);
        }
        return;
      }
      cleanup();
      resolve(value);
    };

    cancelBtn.onclick = () => {
      cleanup();
      resolve(null);
    };

    input.onkeydown = (e) => {
      if (e.key === "Enter") submitBtn.click();
      if (e.key === "Escape") cancelBtn.click();
    };
  });
}

/**
 * Try to auto-paste from clipboard (requires user gesture and permissions).
 */
async function tryAutoPaste(input) {
  try {
    if (navigator.clipboard?.readText) {
      const text = await navigator.clipboard.readText();
      if (text && text.startsWith("nsec1")) {
        input.value = text;
        debugLog("keyteleport", "Auto-pasted from clipboard");
      }
    }
  } catch {
    // Clipboard access denied or unavailable - user will paste manually
  }
}

/**
 * Show an error message to the user.
 */
function showKeyTeleportError(message) {
  // Use alert for now - could be improved with a toast/notification system
  alert(`Key Teleport Error: ${message}`);
}

/**
 * Initialize the Key Teleport setup button handler.
 * Call this on page load.
 */
export function initKeyTeleportSetup() {
  const setupBtn = document.querySelector("[data-keyteleport-setup]");
  if (!setupBtn) return;

  setupBtn.addEventListener("click", showKeyTeleportSetup);
}

/**
 * Show the Key Teleport setup modal with registration blob.
 */
async function showKeyTeleportSetup() {
  const overlay = document.getElementById("keyteleport-setup-overlay");
  const blobOutput = document.getElementById("keyteleport-setup-blob");
  const copyBtn = document.getElementById("keyteleport-setup-copy");
  const cancelBtn = document.getElementById("keyteleport-setup-cancel");
  const errorEl = document.getElementById("keyteleport-setup-error");

  if (!overlay || !blobOutput || !copyBtn || !cancelBtn) {
    debugLog("keyteleport", "Missing setup overlay elements");
    return;
  }

  // Reset state
  blobOutput.value = "Loading...";
  if (errorEl) hide(errorEl);

  show(overlay);

  try {
    // Fetch registration blob from server
    debugLog("keyteleport", "Fetching registration blob...");
    const response = await fetch("/api/keyteleport/register");

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Failed to generate registration");
    }

    const { blob } = await response.json();
    blobOutput.value = blob;
    debugLog("keyteleport", "Registration blob received");
  } catch (error) {
    debugLog("keyteleport", "Setup error", { error: error.message });
    blobOutput.value = "";
    if (errorEl) {
      errorEl.textContent = error.message;
      show(errorEl);
    }
  }

  const cleanup = () => {
    hide(overlay);
    blobOutput.value = "";
    copyBtn.onclick = null;
    cancelBtn.onclick = null;
    copyBtn.textContent = "Copy Code";
  };

  copyBtn.onclick = async () => {
    const value = blobOutput.value;
    if (!value || value === "Loading...") return;

    try {
      await navigator.clipboard.writeText(value);
      copyBtn.textContent = "Copied!";
      debugLog("keyteleport", "Registration blob copied to clipboard");
      setTimeout(() => {
        copyBtn.textContent = "Copy Code";
      }, 2000);
    } catch {
      // Fallback: select the text
      blobOutput.select();
      document.execCommand("copy");
      copyBtn.textContent = "Copied!";
    }
  };

  cancelBtn.onclick = cleanup;
}
