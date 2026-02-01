# Key Teleport v2 - As Built

## Overview

Key Teleport enables secure transfer of Nostr identities between Welcome (key manager) and Ambulando (receiver). This document describes the v2 implementation as built in Ambulando.

**Two Flows:**
1. **App Registration** - User connects Ambulando to Welcome (one-time setup)
2. **Key Teleport** - User teleports their key from Welcome to Ambulando (login)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              APP REGISTRATION                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Ambulando                                       Welcome                    │
│  ─────────                                       ───────                    │
│                                                                             │
│  1. User clicks "Key Teleport" button                                       │
│     └── Login screen: data-keyteleport-setup                               │
│                                                                             │
│  2. Modal opens, fetches registration blob                                  │
│     └── GET /api/keyteleport/register                                      │
│                                                                             │
│  3. Server generates signed event:                                          │
│     └── kind: 30078                                                        │
│     └── content: { url, name, description }                                │
│     └── tags: [["type", "keyteleport-app-registration"]]                   │
│     └── signed by: Ambulando's KEYTELEPORT_PRIVKEY                         │
│                                                                             │
│  4. User copies blob to clipboard                                           │
│                                                                             │
│  5. User pastes blob into Welcome ──────────────────────►                   │
│                                                                             │
│                                         6. Welcome verifies signature       │
│                                         7. Welcome stores app registration  │
│                                            - app_pubkey (Ambulando)        │
│                                            - url, name, description        │
│                                                                             │
│  ✓ Ambulando is now registered!                                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              KEY TELEPORT                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Welcome                                         Ambulando                  │
│  ───────                                         ─────────                  │
│                                                                             │
│  1. User clicks "Teleport to Ambulando"                                     │
│                                                                             │
│  2. Generate throwaway keypair                                              │
│     └── throwawaySecretKey, throwawayPubkey                                │
│                                                                             │
│  3. Encrypt user's nsec (inner layer)                                       │
│     └── NIP-44(nsec, userKey + throwawayPubkey)                            │
│                                                                             │
│  4. Create payload:                                                         │
│     └── { encryptedNsec, npub, v: 1 }                                      │
│                                                                             │
│  5. Encrypt payload to Ambulando (outer layer)                              │
│     └── NIP-44(payload, welcomeKey + ambulandoPubkey)                      │
│                                                                             │
│  6. Sign event with Welcome's key                                           │
│     └── kind: 21059                                                        │
│     └── tags: [] (empty - no recipient tag)                                │
│                                                                             │
│  7. Base64 encode → blob                                                    │
│                                                                             │
│  8. Copy throwaway nsec to clipboard (unlock code)                          │
│                                                                             │
│  9. Open: https://ambulando.io/#keyteleport={blob}                         │
│                                                 │                           │
│                                                 ▼                           │
│                                  10. Client reads fragment                  │
│                                      └── window.location.hash              │
│                                      └── Server never sees blob            │
│                                                                             │
│                                  11. Clear fragment immediately             │
│                                      └── history.replaceState              │
│                                                                             │
│                                  12. POST /api/keyteleport {blob}           │
│                                      └── Verify signature                  │
│                                      └── Decrypt outer layer               │
│                                      └── Return {encryptedNsec, npub}      │
│                                                                             │
│                                  13. Show unlock code modal                 │
│                                      └── User pastes from clipboard        │
│                                                                             │
│                                  14. Decrypt inner layer                    │
│                                      └── NIP-44 with throwaway key         │
│                                      └── Get user's nsec                   │
│                                                                             │
│                                  15. Store in localStorage                  │
│                                      └── EPHEMERAL_SECRET_KEY              │
│                                                                             │
│                                  16. Sign login event as "ephemeral"        │
│                                                                             │
│                                  ✓ User authenticated!                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## File Structure

| File | Purpose |
|------|---------|
| `src/config.ts` | `getKeyTeleportIdentity()` - loads KEYTELEPORT_PRIVKEY |
| `src/routes/keyteleport.ts` | Server endpoints for both flows |
| `src/server.ts` | Route wiring |
| `src/render/home.ts` | UI modals (unlock + setup) |
| `public/keyteleport.js` | Client-side logic for both flows |
| `public/auth.js` | Integration with auth flow |
| `public/app.css` | Modal and button styling |

## Environment Variables

```bash
# Ambulando's keypair for key teleport
# Used for: signing registration blobs, decrypting teleport payloads
KEYTELEPORT_PRIVKEY=nsec1...  # or 64-char hex
```

## API Endpoints

### GET /api/keyteleport/register

Generates a registration blob for connecting Ambulando to a key manager.

**Response:**
```json
{
  "blob": "<base64-encoded signed Nostr event>"
}
```

**Event Structure:**
```typescript
{
  kind: 30078,
  pubkey: "<ambulando_pubkey_hex>",
  created_at: <unix_timestamp>,
  tags: [["type", "keyteleport-app-registration"]],
  content: JSON.stringify({
    url: "https://ambulando.io",
    name: "Ambulando",
    description: "Track your daily habits, metrics, and progress"
  }),
  sig: "<signature>"
}
```

### POST /api/keyteleport

Decrypts a teleport blob and returns the encrypted nsec for client-side decryption.

**Request:**
```json
{
  "blob": "<base64-encoded signed Nostr event>"
}
```

**Response:**
```json
{
  "encryptedNsec": "<NIP-44 encrypted nsec>",
  "npub": "npub1..."
}
```

**Error Codes:**
| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Invalid blob, decryption failed, or unsupported version |
| 503 | KEYTELEPORT_PRIVKEY not configured |

## Client-Side Implementation

### keyteleport.js

**Exports:**
- `checkKeyTeleport()` - Detects `#keyteleport=` fragment and processes teleport
- `initKeyTeleportSetup()` - Wires up the setup button handler

**Fragment URL Handling:**
```javascript
// Read from fragment, not query params
const hash = window.location.hash;
if (!hash.includes("keyteleport=")) return null;

const params = new URLSearchParams(hash.slice(1));
const blob = params.get("keyteleport");

// Clear immediately - server never sees this
window.history.replaceState({}, "", window.location.pathname);
```

**Inner Layer Decryption:**
```javascript
// User's npub decoded to hex pubkey
const userPubkey = nip19.decode(npub).data;

// Throwaway secret + user pubkey → conversation key
const conversationKey = nip44.v2.utils.getConversationKey(
  throwawaySecretKey,  // Uint8Array from unlock code
  userPubkey           // hex string
);

// Decrypt to get nsec
const nsec = nip44.v2.decrypt(encryptedNsec, conversationKey);
```

### auth.js Integration

```javascript
// In initAuth()
initKeyTeleportSetup();  // Wire setup button

// Check for teleport on page load
void checkKeyTeleportLogin().then((teleportHandled) => {
  if (teleportHandled) return;
  // Continue with other login methods...
});

// In checkKeyTeleportLogin()
if (state.session) {
  // Skip if already logged in, clear fragment
  return true;
}
if (localStorage.getItem(EPHEMERAL_SECRET_KEY)) {
  // Skip if existing key, let auto-login handle
  return false;
}

const result = await checkKeyTeleport();
if (!result) return false;

// Store as ephemeral - indistinguishable from manual nsec entry
localStorage.setItem(EPHEMERAL_SECRET_KEY, bytesToHex(result.secretKey));
// Sign login event as "ephemeral" (not "keyteleport")
await completeLogin("ephemeral", signedEvent);
```

## UI Components

### Login Screen Button

```html
<button class="auth-option auth-keyteleport"
        type="button"
        data-keyteleport-setup>
  Key Teleport
</button>
```

### Setup Modal

```html
<div id="keyteleport-setup-overlay" class="keyteleport-overlay" hidden>
  <div class="keyteleport-modal">
    <h2>Setup Key Teleport</h2>
    <p>Copy this registration code and paste it into your key manager...</p>
    <textarea id="keyteleport-setup-blob" readonly rows="4"></textarea>
    <div class="keyteleport-actions">
      <button id="keyteleport-setup-cancel">Cancel</button>
      <button id="keyteleport-setup-copy">Copy Code</button>
    </div>
  </div>
</div>
```

### Unlock Code Modal

```html
<div id="keyteleport-overlay" class="keyteleport-overlay" hidden>
  <div class="keyteleport-modal">
    <h2>Complete Login</h2>
    <p>Paste the unlock code from your clipboard...</p>
    <input type="password" id="keyteleport-unlock-input" placeholder="nsec1..." />
    <p id="keyteleport-error" hidden></p>
    <div class="keyteleport-actions">
      <button id="keyteleport-cancel">Cancel</button>
      <button id="keyteleport-submit">Unlock</button>
    </div>
  </div>
</div>
```

## Security Model

### Double Encryption

```
Teleport Blob Structure:
└── Signed Nostr event (Welcome's key)
    ├── pubkey: Welcome's pubkey (for signature verification)
    ├── tags: []  (empty - no recipient pubkey for quantum resistance)
    ├── content: NIP-44 encrypted (Welcome → Ambulando):
    │   └── payload:
    │       ├── encryptedNsec (NIP-44: user → throwaway)
    │       ├── npub
    │       └── v: 1
    └── sig: signature
```

### Why No Recipient Tag?

The blob intentionally omits `["p", ambulandoPubkey]`:

1. **Quantum resistance** - Exposed public keys could theoretically be reversed
2. **Validation via decryption** - NIP-44 auth failure = wrong recipient
3. **Privacy** - Intercepted blobs don't reveal target app

### Fragment URLs

Using `#keyteleport=` instead of `?keyteleport=`:

- Fragment is **never sent to server** (not in HTTP request)
- Server logs only show `https://ambulando.io/`
- Only client-side JavaScript can read `window.location.hash`

### Key Storage

After successful teleport:
- Key stored in `localStorage` as `EPHEMERAL_SECRET_KEY`
- Same storage as manual nsec entry
- Cleared on logout via `clearAutoLogin()`

## Interaction with Welcome

### Registration Flow

1. **Ambulando** generates signed event with app info
2. **User** copies blob manually (clipboard)
3. **Welcome** verifies signature using Ambulando's pubkey
4. **Welcome** stores: `{ user_npub, app_pubkey, url, name, description }`

### Teleport Flow

1. **Welcome** encrypts nsec with throwaway key (inner layer)
2. **Welcome** encrypts payload to Ambulando's pubkey (outer layer)
3. **Welcome** signs event, creates fragment URL
4. **Welcome** copies throwaway nsec to clipboard
5. **User** clicks URL → Ambulando opens
6. **Ambulando** decrypts outer layer (server-side, keeps key secret)
7. **User** pastes unlock code (throwaway nsec)
8. **Ambulando** decrypts inner layer (client-side)

### Trust Model

- **Ambulando trusts Welcome's signature** for teleport blobs
- **Welcome trusts Ambulando's signature** for registration blobs
- **No shared secrets** - only asymmetric crypto (NIP-44)
- **User confirms** via unlock code (proves possession of throwaway key)

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Already logged in | Skip teleport, clear fragment |
| Existing key in localStorage | Skip teleport, auto-login with existing key |
| KEYTELEPORT_PRIVKEY not set | Return 503, button shows error |
| Decryption fails (wrong app) | Return 400 "Decryption failed - wrong recipient?" |
| Invalid unlock code | Show error in modal, let user retry |
| User cancels unlock | Return to login screen |
| Logout | Clears EPHEMERAL_SECRET_KEY, fresh teleport works |

## Dependencies

**Server (Bun):**
- `nostr-tools` - finalizeEvent, verifyEvent, nip44

**Client (ESM CDN):**
- `nostr-tools` from esm.sh - nip19, nip44
