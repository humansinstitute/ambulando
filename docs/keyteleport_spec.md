# Key Teleport Specification

## Overview

Key Teleport enables secure transfer of a Nostr identity (nsec) from an external key manager (Welcome) to Ambulando. Once received, the key is stored identically to a manually-entered nsec, using the standard ephemeral login flow.

**Protocol Version:** v2 (fragment URLs + self-contained blob)

## Design Principles

1. **Fragment URLs** - Blob in `#fragment` so server never sees it in logs
2. **No server fetch** - Everything needed is in the URL blob
3. **Double encryption** - Target app key + throwaway key
4. **User confirmation** - Unlock code ensures user intent
5. **No recipient tag** - App's pubkey is NOT in the blob (quantum resistance)

## Flow Diagram

```
┌─────────────────────────────┐                    ┌─────────────────────┐
│   Welcome (Key Manager)     │                    │     Ambulando       │
└──────────┬──────────────────┘                    └──────────┬──────────┘
           │                                                  │
    1. User initiates teleport                               │
    2. Generate throwaway keypair                            │
    3. Encrypt nsec: NIP-44(nsec, userKey + throwawayPubkey) │
    4. Create payload { encryptedNsec, npub, v: 1 }          │
    5. Encrypt payload to Ambulando's key (NIP-44)           │
    6. Create signed Nostr event (kind 21059)                │
       - Content: NIP-44 encrypted payload                   │
       - Signed by: Welcome's server key                     │
       - NO "p" tag (recipient validated by decryption)      │
    7. Base64 encode signed event → "blob"                   │
    8. Copy throwaway nsec to clipboard (unlock code)        │
    9. Generate URL: #keyteleport={blob}                     │
           │                                                  │
           │─────────── User clicks URL ──────────────────►  │
           │                                                  │
           │                       10. Client reads fragment (JS only)
           │                           - Server never sees blob
           │                       11. POST /api/keyteleport {blob}
           │                           - Verify signature
           │                           - Decrypt payload (NIP-44)
           │                           - Return {encryptedNsec, npub}
           │                       12. Prompt user for unlock code
           │                           (throwaway nsec from clipboard)
           │                       13. Client decrypts nsec (NIP-44)
           │                       14. Store in localStorage (EPHEMERAL_SECRET_KEY)
           │                       15. Sign login event as "ephemeral"
           │                       16. Complete standard login flow
           │                                                  │
           └──────────────────────────────────────────────►   │
```

## Environment Variables

```bash
# Ambulando's private key for decrypting payloads from Welcome
KEYTELEPORT_PRIVKEY=nsec1...
```

Supports nsec (NIP-19) or 64-character hex format.

**Note:** `KEYTELEPORT_WELCOME_PUBKEY` is no longer required - decryption success validates the recipient.

## Server Implementation

### Endpoint: `POST /api/keyteleport`

**File:** `src/routes/keyteleport.ts`

**Request:**
```json
{
  "blob": "<base64-encoded signed Nostr event>"
}
```

**Processing Steps:**
1. Decode base64 blob → JSON Nostr event
2. Verify event signature using `verifyEvent()`
3. Decrypt NIP-44 event content using `KEYTELEPORT_PRIVKEY`
   - Decryption success = blob was intended for us
   - Decryption failure = blob was for a different app
4. Parse payload: `{ encryptedNsec, npub, v }`
5. Validate protocol version (must be 1)
6. Return `{ encryptedNsec, npub }` to client

**Response Codes:**
| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Invalid blob, payload, or decryption failed (wrong recipient) |
| 503 | Key Teleport not configured (missing env vars) |

### Payload Structure (Decrypted)

```typescript
interface KeyTeleportPayload {
  encryptedNsec: string;  // NIP-44 encrypted (user's key + throwaway pubkey)
  npub: string;           // User's public key
  v: number;              // Protocol version (1)
}
```

## Client Implementation

### Detection & Processing

**File:** `public/keyteleport.js`

The `checkKeyTeleport()` function:
1. Checks for `#keyteleport=` URL fragment
2. Clears fragment immediately (replay prevention)
3. URL-decodes and POSTs blob to `/api/keyteleport`
4. Shows unlock code prompt modal
5. Decrypts nsec using throwaway key + NIP-44
6. Returns `{ secretKey, npub }` or `null` on failure/cancel

### Auth Integration

**File:** `public/auth.js`

The `checkKeyTeleportLogin()` function:
1. **Skip if already logged in** - clears URL fragment, returns
2. **Skip if existing key found** - lets auto-login handle it
3. Calls `checkKeyTeleport()` for fresh teleport
4. Stores secret in `localStorage` under `EPHEMERAL_SECRET_KEY`
5. Signs login event as **"ephemeral"** (not "keyteleport")
6. Completes standard ephemeral login flow

**Key Principle:** After key teleport, the session is indistinguishable from a manual nsec login. No special "keyteleport" method handling needed.

### UI Components

**Unlock Code Modal** (`src/render/home.ts`):
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

## URL Format

### Fragment URL (Recommended)

```
https://ambulando.io/#keyteleport=<URL-encoded-BASE64-BLOB>
```

- Fragment is **not sent to server**
- Server logs show only `https://ambulando.io/`
- JavaScript reads via `window.location.hash`

## Security Considerations

1. **Fragment URLs** - Server never sees the blob (not in logs, not in requests)
2. **URL cleared immediately** - Prevents replay via browser history
3. **Signature verification** - Only accepts validly signed events
4. **Decryption validates recipient** - No "p" tag needed; auth failure = wrong app
5. **NIP-44 encryption** - Payload encrypted in transit, only Ambulando can decrypt
6. **Throwaway keypair** - User's nsec encrypted with ephemeral key, requires unlock code
7. **Standard storage** - Secret stored same as ephemeral login, cleared on logout

### Why No Recipient Tag?

Standard Nostr events include a `["p", recipientPubkey]` tag. Key Teleport deliberately omits this:

1. **Quantum resistance** - Exposed public keys could theoretically be reversed using Shor's algorithm
2. **Validation via decryption** - NIP-44 uses authenticated encryption (ChaCha20-Poly1305). Decryption success proves the blob was intended for your app
3. **Privacy** - Intercepted blobs don't reveal the target application

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Already logged in | Skip teleport, clear URL fragment |
| Existing key in localStorage | Skip teleport, auto-login with existing key |
| Invalid/malformed blob | Return 400 error |
| Decryption failed | Return 400 error (blob for different app) |
| Unsupported version | Return 400 error |
| User cancels unlock prompt | Return to login screen |
| Invalid unlock code | Show error, let user retry |
| Logout | Clears `EPHEMERAL_SECRET_KEY`, fresh teleport works |

## Dependencies

**Server-side:**
- `nostr-tools` - verifyEvent, nip44

**Client-side:**
- `nostr-tools` (from esm.sh CDN) - nip19, nip44

## Files Changed

| File | Purpose |
|------|---------|
| `src/config.ts` | `getKeyTeleportIdentity()` |
| `src/routes/keyteleport.ts` | POST `/api/keyteleport` handler |
| `src/server.ts` | Route wiring |
| `public/keyteleport.js` | Client-side URL fragment detection & NIP-44 decryption |
| `public/auth.js` | Integration with auth flow, logout clearing |
| `src/render/home.ts` | Unlock code modal HTML |
| `public/app.css` | Modal styles |
