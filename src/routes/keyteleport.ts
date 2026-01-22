import { nip44, verifyEvent } from "nostr-tools";

import {
  getKeyTeleportIdentity,
  getKeyTeleportWelcomePubkey,
} from "../config";
import { jsonResponse, safeJson } from "../http";
import { logDebug, logError } from "../logger";

interface KeyTeleportPayload {
  apiRoute: string;
  hash_id: string;
  timestamp: number;
  npub?: string;
}

interface KeyManagerResponse {
  encryptedNsec?: string;
  encryptsec?: string; // v1 format
  npub: string;
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
  const welcomePubkey = getKeyTeleportWelcomePubkey();

  if (!identity || !welcomePubkey) {
    logError("[keyteleport] Key Teleport not configured");
    return jsonResponse({ error: "Key Teleport not configured" }, 503);
  }

  logDebug("keyteleport", "Config loaded", {
    ourPubkey: identity.pubkey.slice(0, 12) + "...",
    welcomePubkey: welcomePubkey.slice(0, 12) + "...",
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

  // 4. Verify event signature
  if (!verifyEvent(event)) {
    logDebug("keyteleport", "Invalid event signature");
    return jsonResponse({ error: "Invalid event signature" }, 400);
  }

  // 5. Verify event is from trusted Welcome pubkey
  if (event.pubkey !== welcomePubkey) {
    logDebug("keyteleport", "Untrusted signer", {
      expected: welcomePubkey.slice(0, 12) + "...",
      got: event.pubkey?.slice(0, 12) + "...",
    });
    return jsonResponse({ error: "Untrusted signer" }, 403);
  }

  logDebug("keyteleport", "Signature verified from Welcome");

  // 6. Decrypt NIP-44 payload
  let payload: KeyTeleportPayload;
  try {
    // NIP-44 getConversationKey expects: secretKey as Uint8Array, pubkey as hex string
    const ourSecretBytes = hexToBytes(identity.secretKeyHex);

    const conversationKey = nip44.v2.utils.getConversationKey(
      ourSecretBytes,
      event.pubkey // Keep as hex string
    );
    const decrypted = nip44.v2.decrypt(event.content, conversationKey);
    payload = JSON.parse(decrypted);
    logDebug("keyteleport", "Decrypted payload", {
      apiRoute: payload.apiRoute,
      hash_id: payload.hash_id?.slice(0, 8) + "...",
      timestamp: payload.timestamp,
      npub: payload.npub?.slice(0, 12) + "...",
    });
  } catch (err) {
    logError("[keyteleport] Failed to decrypt payload", err);
    return jsonResponse({ error: "Failed to decrypt payload" }, 400);
  }

  // 7. Validate timestamp (check it hasn't expired)
  const now = Math.floor(Date.now() / 1000);
  logDebug("keyteleport", "Timestamp validation", {
    payloadTimestamp: payload.timestamp,
    now,
    diff: payload.timestamp - now,
  });

  if (payload.timestamp < now) {
    logDebug("keyteleport", "Link expired", {
      expiresAt: payload.timestamp,
      now,
      expiredBy: now - payload.timestamp,
    });
    return jsonResponse({ error: "Link expired" }, 410);
  }

  // 8. Fetch encrypted key from Welcome
  let keyData: KeyManagerResponse;
  try {
    const keyUrl = `${payload.apiRoute}?id=${payload.hash_id}`;
    logDebug("keyteleport", "Fetching key from Welcome", { url: keyUrl });

    const response = await fetch(keyUrl);

    if (response.status === 404) {
      logDebug("keyteleport", "Key not found or already used");
      return jsonResponse({ error: "Key not found or already used" }, 404);
    }

    if (!response.ok) {
      logDebug("keyteleport", "Key manager error", {
        status: response.status,
        statusText: response.statusText,
      });
      return jsonResponse({ error: "Key manager error" }, 502);
    }

    keyData = await response.json();
    logDebug("keyteleport", "Key data received", {
      hasEncryptedNsec: !!keyData.encryptedNsec,
      hasEncryptsec: !!keyData.encryptsec,
      npub: keyData.npub?.slice(0, 12) + "...",
    });
  } catch (err) {
    logError("[keyteleport] Key manager unreachable", err);
    return jsonResponse({ error: "Key manager unreachable" }, 502);
  }

  // 9. Return encrypted nsec + npub to client
  // Support both v1 (encryptsec) and v2 (encryptedNsec) formats
  const encryptedNsec = keyData.encryptedNsec || keyData.encryptsec;
  const npub = keyData.npub || payload.npub;

  if (!encryptedNsec || !npub) {
    logDebug("keyteleport", "Invalid key data from Welcome", {
      hasEncryptedNsec: !!encryptedNsec,
      hasNpub: !!npub,
    });
    return jsonResponse({ error: "Invalid key data" }, 502);
  }

  logDebug("keyteleport", "Key teleport successful", {
    npub: npub.slice(0, 12) + "...",
  });

  return jsonResponse({
    encryptedNsec,
    npub,
  });
}
