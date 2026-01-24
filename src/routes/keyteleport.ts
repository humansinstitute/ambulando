import { finalizeEvent, nip44, verifyEvent } from "nostr-tools";

import { getKeyTeleportIdentity } from "../config";
import { jsonResponse, safeJson } from "../http";
import { logDebug, logError } from "../logger";

const KEYTELEPORT_REGISTRATION_KIND = 30078;
const APP_URL = "https://ambulando.io";
const APP_NAME = "Ambulando";

/**
 * New v2 payload structure - everything needed is in the blob
 * No fetch from sender required
 */
interface KeyTeleportPayload {
  encryptedNsec: string; // NIP-44 encrypted (inner layer: user key + throwaway pubkey)
  npub: string; // User's public key
  v: number; // Protocol version (1)
}

// Convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

export async function handleKeyTeleport(req: Request): Promise<Response> {
  logDebug("keyteleport", "Key teleport request received");

  // 1. Check if key teleport is configured
  const identity = getKeyTeleportIdentity();

  if (!identity) {
    logError("[keyteleport] Key Teleport not configured");
    return jsonResponse({ error: "Key Teleport not configured" }, 503);
  }

  logDebug("keyteleport", "Config loaded", {
    ourPubkey: identity.pubkey.slice(0, 12) + "...",
  });

  // 2. Parse request body
  const body = await safeJson(req);
  if (!body?.blob) {
    logDebug("keyteleport", "Missing blob in request");
    return jsonResponse({ error: "Missing blob" }, 400);
  }

  // 3. Decode base64 blob -> Nostr event
  let event;
  try {
    const jsonStr = atob(body.blob);
    event = JSON.parse(jsonStr);
    logDebug("keyteleport", "Decoded event", {
      kind: event.kind,
      pubkey: event.pubkey?.slice(0, 12) + "...",
    });
  } catch (err) {
    logError("[keyteleport] Invalid blob encoding", err);
    return jsonResponse({ error: "Invalid blob encoding" }, 400);
  }

  // 4. Verify event signature (proves authenticity)
  if (!verifyEvent(event)) {
    logDebug("keyteleport", "Invalid event signature");
    return jsonResponse({ error: "Invalid event signature" }, 400);
  }

  logDebug("keyteleport", "Signature verified", {
    senderPubkey: event.pubkey?.slice(0, 12) + "...",
  });

  // 5. Decrypt NIP-44 payload using our app key
  // Note: No "p" tag check - decryption success = blob was intended for us
  let payload: KeyTeleportPayload;
  try {
    // NIP-44 getConversationKey expects: secretKey as Uint8Array, pubkey as hex string
    const ourSecretBytes = hexToBytes(identity.secretKeyHex);

    const conversationKey = nip44.v2.utils.getConversationKey(
      ourSecretBytes,
      event.pubkey // Sender's pubkey (hex string)
    );
    const decrypted = nip44.v2.decrypt(event.content, conversationKey);
    payload = JSON.parse(decrypted);

    logDebug("keyteleport", "Decrypted payload", {
      npub: payload.npub?.slice(0, 12) + "...",
      hasEncryptedNsec: !!payload.encryptedNsec,
      version: payload.v,
    });
  } catch (err) {
    // NIP-44 auth failure means wrong key - this blob isn't for us
    logError("[keyteleport] Decryption failed - blob may be for a different app", err);
    return jsonResponse({ error: "Decryption failed - wrong recipient?" }, 400);
  }

  // 6. Validate protocol version
  if (payload.v !== 1) {
    logDebug("keyteleport", "Unsupported protocol version", { version: payload.v });
    return jsonResponse({ error: `Unsupported protocol version: ${payload.v}` }, 400);
  }

  // 7. Validate payload has required fields
  if (!payload.encryptedNsec || !payload.npub) {
    logDebug("keyteleport", "Invalid payload - missing required fields", {
      hasEncryptedNsec: !!payload.encryptedNsec,
      hasNpub: !!payload.npub,
    });
    return jsonResponse({ error: "Invalid payload" }, 400);
  }

  logDebug("keyteleport", "Key teleport successful", {
    npub: payload.npub.slice(0, 12) + "...",
  });

  // 8. Return encrypted nsec + npub to client for inner layer decryption
  return jsonResponse({
    encryptedNsec: payload.encryptedNsec,
    npub: payload.npub,
  });
}

/**
 * Generate a registration blob for connecting Ambulando to a key manager.
 * The blob is a signed Nostr event containing app info (not encrypted).
 */
export function handleKeyTeleportRegister(): Response {
  logDebug("keyteleport", "Registration blob request");

  const identity = getKeyTeleportIdentity();
  if (!identity) {
    logError("[keyteleport] Key Teleport not configured");
    return jsonResponse({ error: "Key Teleport not configured" }, 503);
  }

  try {
    // Create registration content (public info, not encrypted)
    const content = JSON.stringify({
      url: APP_URL,
      name: APP_NAME,
      description: "Track your daily habits, metrics, and progress",
    });

    // Create and sign the event
    const secretKeyBytes = hexToBytes(identity.secretKeyHex);
    const event = finalizeEvent(
      {
        kind: KEYTELEPORT_REGISTRATION_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["type", "keyteleport-app-registration"]],
        content,
      },
      secretKeyBytes
    );

    // Base64 encode
    const blob = btoa(JSON.stringify(event));

    logDebug("keyteleport", "Registration blob generated", {
      pubkey: event.pubkey.slice(0, 12) + "...",
    });

    return jsonResponse({ blob });
  } catch (err) {
    logError("[keyteleport] Failed to generate registration blob", err);
    return jsonResponse({ error: "Failed to generate registration" }, 500);
  }
}
