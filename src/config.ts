import { join } from "path";

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

// Credits configuration (hourly)
export const MAX_CREDITS = Number(Bun.env.MAX_CREDITS ?? 21); // Max credits per purchase
export const INITIAL_CREDITS = Number(Bun.env.INITIAL_CREDITS ?? 72); // 72 hours = 3 days
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
]);
