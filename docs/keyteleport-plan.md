# Key Teleport Implementation Plan

## Overview

Implement key teleport to receive Nostr identity transfers from Welcome (sender) to Ambulando (receiver). This allows users to securely authenticate via a link from Welcome without manually entering their nsec.

**Protocol:** v2 (throwaway keypair + NIP-44 encryption)

---

## Environment Variables (Already Set)

```
KEYTELEPORT_PRIVKEY=nsec1aq2...           # Ambulando's private key for decryption
KEYTELEPORT_WELCOME_PUBKEY=npub1p9m9uf... # Welcome's pubkey for signature verification
```

---

## Implementation Steps

### Step 1: Config Functions (`src/config.ts`)

Add helper functions to decode and validate the env variables:

```typescript
import { nip19 } from "nostr-tools";

// Decode KEYTELEPORT_PRIVKEY → { npub, pubkey, secretKey }
export function getKeyTeleportIdentity() {
  const privkey = Bun.env.KEYTELEPORT_PRIVKEY;
  if (!privkey) return null;

  // Handle both nsec and hex formats
  if (privkey.startsWith("nsec")) {
    const decoded = nip19.decode(privkey);
    // Return { secretKey (Uint8Array), pubkey (hex), npub }
  } else {
    // Assume 64-char hex
  }
}

// Decode KEYTELEPORT_WELCOME_PUBKEY → hex pubkey
export function getKeyTeleportWelcomePubkey(): string | null {
  const pubkey = Bun.env.KEYTELEPORT_WELCOME_PUBKEY;
  if (!pubkey) return null;

  if (pubkey.startsWith("npub")) {
    const decoded = nip19.decode(pubkey);
    return decoded.data as string;
  }
  return pubkey; // Assume hex
}
```

---

### Step 2: Backend Route (`src/routes/keyteleport.ts`)

Create new route handler for `POST /api/keyteleport`:

**Input:** `{ blob: string }` (base64-encoded signed Nostr event)

**Processing:**
1. Decode base64 blob → JSON Nostr event
2. Verify event signature using `verifyEvent()`
3. Verify event pubkey matches `KEYTELEPORT_WELCOME_PUBKEY`
4. Decrypt NIP-44 event content using `KEYTELEPORT_PRIVKEY`
5. Parse payload: `{ apiRoute, hash_id, timestamp, npub? }`
6. Validate timestamp hasn't expired (5 min window)
7. Fetch encrypted key from Welcome: `GET {apiRoute}?id={hash_id}`
8. Return `{ encryptedNsec, npub }` to client

**Response codes:**
- `200` - Success
- `400` - Invalid blob/payload
- `403` - Signature from untrusted source
- `404` - Key not found at Welcome
- `410` - Link expired
- `502` - Welcome API unreachable
- `503` - Key Teleport not configured

```typescript
// src/routes/keyteleport.ts
import { verifyEvent } from "nostr-tools";
import { nip44 } from "nostr-tools";
import { getKeyTeleportIdentity, getKeyTeleportWelcomePubkey } from "../config";
import { jsonResponse } from "../http";

interface KeyTeleportPayload {
  apiRoute: string;
  hash_id: string;
  timestamp: number;
  npub?: string;
}

export async function handleKeyTeleport(req: Request) {
  // 1. Check if key teleport is configured
  const identity = getKeyTeleportIdentity();
  const welcomePubkey = getKeyTeleportWelcomePubkey();
  if (!identity || !welcomePubkey) {
    return jsonResponse({ error: "Key Teleport not configured" }, 503);
  }

  // 2. Parse request body
  const body = await req.json().catch(() => null);
  if (!body?.blob) {
    return jsonResponse({ error: "Missing blob" }, 400);
  }

  // 3. Decode base64 blob → Nostr event
  let event;
  try {
    const jsonStr = atob(body.blob);
    event = JSON.parse(jsonStr);
  } catch {
    return jsonResponse({ error: "Invalid blob encoding" }, 400);
  }

  // 4. Verify event signature
  if (!verifyEvent(event)) {
    return jsonResponse({ error: "Invalid event signature" }, 400);
  }

  // 5. Verify event is from trusted Welcome pubkey
  if (event.pubkey !== welcomePubkey) {
    return jsonResponse({ error: "Untrusted signer" }, 403);
  }

  // 6. Decrypt NIP-44 payload
  let payload: KeyTeleportPayload;
  try {
    const conversationKey = nip44.v2.utils.getConversationKey(
      identity.secretKeyHex,
      event.pubkey
    );
    const decrypted = nip44.v2.decrypt(event.content, conversationKey);
    payload = JSON.parse(decrypted);
  } catch {
    return jsonResponse({ error: "Failed to decrypt payload" }, 400);
  }

  // 7. Validate timestamp (5 min expiry)
  const now = Math.floor(Date.now() / 1000);
  if (payload.timestamp < now) {
    return jsonResponse({ error: "Link expired" }, 410);
  }

  // 8. Fetch encrypted key from Welcome
  let keyData;
  try {
    const keyUrl = `${payload.apiRoute}?id=${payload.hash_id}`;
    const response = await fetch(keyUrl);

    if (response.status === 404) {
      return jsonResponse({ error: "Key not found or already used" }, 404);
    }
    if (!response.ok) {
      return jsonResponse({ error: "Key manager error" }, 502);
    }

    keyData = await response.json();
  } catch {
    return jsonResponse({ error: "Key manager unreachable" }, 502);
  }

  // 9. Return encrypted nsec + npub to client
  return jsonResponse({
    encryptedNsec: keyData.encryptedNsec,
    npub: keyData.npub || payload.npub
  });
}
```

---

### Step 3: Wire Route (`src/server.ts`)

Add the route to the server dispatcher:

```typescript
import { handleKeyTeleport } from "./routes/keyteleport";

// In the request handler, after other POST routes:
if (req.method === "POST" && pathname === "/api/keyteleport") {
  return handleKeyTeleport(req);
}
```

---

### Step 4: Client-Side Detection (`public/keyteleport.js`)

Create new module to handle key teleport URL detection and processing:

```javascript
// public/keyteleport.js
import { nip19, nip44 } from "https://esm.sh/nostr-tools@2.7.2";
import { bytesToHex } from "https://esm.sh/@noble/hashes@1.3.2/utils";

export async function checkKeyTeleport() {
  const params = new URLSearchParams(window.location.search);
  const blob = params.get("keyteleport");

  if (!blob) return null;

  // Clear URL params immediately (replay prevention)
  const cleanUrl = window.location.pathname;
  window.history.replaceState({}, "", cleanUrl);

  try {
    // 1. Send blob to server for verification & key fetch
    const response = await fetch("/api/keyteleport", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blob })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Key teleport failed");
    }

    const { encryptedNsec, npub } = await response.json();

    // 2. Prompt user for unlock code (throwaway nsec)
    const unlockCode = await promptForUnlockCode();
    if (!unlockCode) {
      throw new Error("Unlock code required");
    }

    // 3. Decode throwaway nsec
    const throwawayDecoded = nip19.decode(unlockCode.trim());
    if (throwawayDecoded.type !== "nsec") {
      throw new Error("Invalid unlock code format");
    }
    const throwawaySecretKey = throwawayDecoded.data;

    // 4. Decode user's npub to get pubkey
    const npubDecoded = nip19.decode(npub);
    const userPubkey = npubDecoded.data;

    // 5. Create NIP-44 conversation key
    const conversationKey = nip44.v2.utils.getConversationKey(
      bytesToHex(throwawaySecretKey),
      userPubkey
    );

    // 6. Decrypt the nsec
    const decryptedNsec = nip44.v2.decrypt(encryptedNsec, conversationKey);

    // 7. Decode to get secret key bytes
    const nsecDecoded = nip19.decode(decryptedNsec);
    if (nsecDecoded.type !== "nsec") {
      throw new Error("Decryption failed - invalid nsec");
    }

    return {
      secretKey: nsecDecoded.data,
      npub: npub
    };

  } catch (error) {
    console.error("Key teleport error:", error);
    showKeyTeleportError(error.message);
    return null;
  }
}

async function promptForUnlockCode() {
  return new Promise((resolve) => {
    // Show modal overlay
    const overlay = document.getElementById("keyteleport-overlay");
    const input = document.getElementById("keyteleport-unlock-input");
    const submitBtn = document.getElementById("keyteleport-submit");
    const cancelBtn = document.getElementById("keyteleport-cancel");

    overlay.classList.remove("hidden");
    input.focus();

    const cleanup = () => {
      overlay.classList.add("hidden");
      input.value = "";
    };

    submitBtn.onclick = () => {
      const value = input.value;
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

function showKeyTeleportError(message) {
  // Show error in UI - could use existing notification system
  alert(`Key Teleport Error: ${message}`);
}
```

---

### Step 5: UI Overlay (`src/render/home.ts`)

Add the unlock code prompt overlay to the HTML:

```html
<!-- Key Teleport Unlock Overlay -->
<div id="keyteleport-overlay" class="hidden fixed inset-0 bg-black/50 flex items-center justify-center z-50">
  <div class="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
    <h2 class="text-xl font-semibold mb-4">Complete Login</h2>
    <p class="text-gray-600 dark:text-gray-300 mb-4">
      Paste the unlock code from your clipboard to complete the login.
    </p>
    <input
      type="password"
      id="keyteleport-unlock-input"
      class="w-full p-3 border rounded-lg mb-4 font-mono text-sm"
      placeholder="nsec1..."
      autocomplete="off"
    />
    <div class="flex gap-3 justify-end">
      <button
        id="keyteleport-cancel"
        class="px-4 py-2 text-gray-600 hover:text-gray-800"
      >
        Cancel
      </button>
      <button
        id="keyteleport-submit"
        class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
      >
        Unlock
      </button>
    </div>
  </div>
</div>
```

---

### Step 6: Integration with Auth Flow (`public/auth.js`)

Modify the auth initialization to check for key teleport:

```javascript
// In initAuth() or early in boot sequence:
import { checkKeyTeleport } from "./keyteleport.js";

async function initAuth() {
  // Check for key teleport URL param first
  const teleportResult = await checkKeyTeleport();

  if (teleportResult) {
    // Store secret key in sessionStorage (ephemeral)
    sessionStorage.setItem("EPHEMERAL_SECRET_KEY",
      bytesToHex(teleportResult.secretKey)
    );

    // Complete login with the received key
    await loginWithSecretKey(teleportResult.secretKey, "keyteleport");
    return;
  }

  // Continue with normal auth flow...
}
```

---

### Step 7: Add "keyteleport" Login Method

Update types and validation to support the new method:

```typescript
// src/types.ts
export type LoginMethod = "ephemeral" | "extension" | "bunker" | "secret" | "keyteleport";

// src/validation.ts
export function validateLoginMethod(method: string): LoginMethod {
  const valid = ["ephemeral", "extension", "bunker", "secret", "keyteleport"];
  if (!valid.includes(method)) {
    throw new Error(`Invalid login method: ${method}`);
  }
  return method as LoginMethod;
}
```

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src/config.ts` | Modify | Add `getKeyTeleportIdentity()`, `getKeyTeleportWelcomePubkey()` |
| `src/routes/keyteleport.ts` | Create | POST /api/keyteleport handler |
| `src/server.ts` | Modify | Wire keyteleport route |
| `src/types.ts` | Modify | Add "keyteleport" to LoginMethod |
| `src/validation.ts` | Modify | Update validateLoginMethod() |
| `public/keyteleport.js` | Create | Client-side teleport logic |
| `public/auth.js` | Modify | Integrate checkKeyTeleport() |
| `src/render/home.ts` | Modify | Add unlock overlay HTML |
| `public/app.css` | Modify | Overlay styles (if needed) |

---

## Testing Plan

1. **Unit test config functions** - Verify nsec/npub decoding
2. **Manual test with Welcome** - Generate teleport URL, click through
3. **Error cases:**
   - Invalid blob (malformed base64)
   - Wrong signer (not Welcome's key)
   - Expired timestamp
   - Invalid unlock code
   - Key already used (404 from Welcome)
4. **Verify session created** - Check cookie and in-memory session

---

## Security Considerations

1. **URL cleared immediately** - Prevents replay via browser history
2. **Signature verification** - Only accept events from Welcome's pubkey
3. **Timestamp validation** - Reject expired links
4. **One-time use** - Welcome deletes key after retrieval
5. **NIP-44 encryption** - Content encrypted in transit
6. **Session storage** - Secret key in sessionStorage (not localStorage)

---

## Dependencies

Already available in codebase:
- `nostr-tools` (2.7.2) - verifyEvent, nip19, nip44
- Client loads from esm.sh CDN

No new dependencies required.
