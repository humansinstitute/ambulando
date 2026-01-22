import { join } from "path";

import { nip19 } from "nostr-tools";
import { getPublicKey } from "nostr-tools/pure";

export const PORT = Number(Bun.env.PORT ?? 3000);
export const MODE = Bun.env.MODE ?? "prod";
export const IS_DEV = MODE === "dev";
export const SESSION_COOKIE = "nostr_session";
export const LOGIN_EVENT_KIND = 27235;
export const LOGIN_MAX_AGE_SECONDS = 60;
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const COOKIE_SECURE = Bun.env.NODE_ENV === "production";
export const APP_NAME = "Ambulando";
export const APP_TAG = "ambulando";
export const PUBLIC_DIR = join(import.meta.dir, "../public");

export const DEFAULT_RELAYS = [
  "wss://relay.primal.net",
  "wss://nos.lol",
  "wss://relay.damus.io",
  "wss://relay.devvul.com",
  "wss://purplepag.es",
];
export const NOSTR_RELAYS: string[] = Bun.env.NOSTR_RELAYS
  ? Bun.env.NOSTR_RELAYS.split(",").map((s) => s.trim()).filter(Boolean)
  : DEFAULT_RELAYS;

// Credits configuration (1 credit = 1 hour)
export const MAX_CREDITS = Number(Bun.env.MAX_CREDITS ?? 504); // Max hours per purchase (default 21 days)
export const INITIAL_CREDITS = Number(Bun.env.INITIAL_CREDITS ?? 72); // Initial hours (default 3 days)
export const MGINX_URL = Bun.env.MGINX_URL ?? "http://localhost:8787";
export const MGINX_API_KEY = Bun.env.APIKEY_MGINX ?? "";
export const MGINX_CREDITS_PRODUCT_ID = Bun.env.CREDITS_ID ?? "";

export const STATIC_FILES = new Map<string, string>([
  ["/favicon.ico", "favicon.png"],
  ["/favicon.png", "favicon.png"],
  ["/apple-touch-icon.png", "apple-touch-icon.png"],
  ["/icon-192.png", "icon-192.png"],
  ["/icon-512.png", "icon-512.png"],
  ["/manifest.webmanifest", "manifest.webmanifest"],
  ["/app.js", "app.js"],
  ["/app.css", "app.css"],
  ["/keyteleport.js", "keyteleport.js"],
]);

// Key Teleport configuration
export const KEYTELEPORT_EXPIRY_SECONDS = 300; // 5 minutes

type KeyTeleportIdentity = {
  secretKey: Uint8Array;
  secretKeyHex: string;
  pubkey: string;
  npub: string;
};

export function getKeyTeleportIdentity(): KeyTeleportIdentity | null {
  const privkey = Bun.env.KEYTELEPORT_PRIVKEY;
  if (!privkey) return null;

  try {
    if (privkey.startsWith("nsec")) {
      const decoded = nip19.decode(privkey);
      if (decoded.type !== "nsec") return null;
      const secretKey = decoded.data as Uint8Array;
      const secretKeyHex = Buffer.from(secretKey).toString("hex");
      const pubkey = getPublicKey(secretKey);
      const npub = nip19.npubEncode(pubkey);
      return { secretKey, secretKeyHex, pubkey, npub };
    } else if (privkey.length === 64) {
      // Assume 64-char hex
      const secretKey = Buffer.from(privkey, "hex");
      const pubkey = getPublicKey(secretKey);
      const npub = nip19.npubEncode(pubkey);
      return { secretKey, secretKeyHex: privkey, pubkey, npub };
    }
    return null;
  } catch {
    return null;
  }
}

export function getKeyTeleportWelcomePubkey(): string | null {
  const pubkey = Bun.env.KEYTELEPORT_WELCOME_PUBKEY;
  if (!pubkey) return null;

  try {
    if (pubkey.startsWith("npub")) {
      const decoded = nip19.decode(pubkey);
      if (decoded.type !== "npub") return null;
      return decoded.data as string;
    }
    // Assume hex if 64 chars
    if (pubkey.length === 64) return pubkey;
    return null;
  } catch {
    return null;
  }
}
