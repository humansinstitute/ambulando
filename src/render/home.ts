import { APP_NAME, NOSTR_RELAYS } from "../config";

import type { Session } from "../types";

type TabName = "daily" | "timers" | "measures" | "results";

type RenderArgs = {
  session: Session | null;
  initialTab?: TabName;
  initialDate?: string; // YYYY-MM-DD format
};

export function renderHomePage({ session, initialTab = "daily", initialDate }: RenderArgs) {
  return `<!doctype html>
<html lang="en">
${renderHead()}
<body>
  <main class="app-shell">
    ${renderHeader(session)}
    ${renderAuth(session)}
    ${renderTabNav(session)}
    ${renderTrackPanel(session)}
    ${renderTimersPanel(session)}
    ${renderMeasuresPanel(session)}
    ${renderResultsPanel(session)}
    ${renderQrModal()}
    ${renderNostrConnectModal()}
    ${renderPinModal()}
    ${renderProfileModal()}
    ${renderMeasureModal()}
    ${renderTimerEditModal()}
    ${renderCreditsModal()}
    ${renderNoCreditsOverlay()}
    ${renderKeyTeleportOverlay()}
    ${renderKeyTeleportSetupModal()}
  </main>
  ${renderSessionSeed(session, initialTab, initialDate)}
  <script type="module" src="/app.js"></script>
</body>
</html>`;
}

function renderHead() {
  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
  <title>${APP_NAME}</title>
  <meta name="theme-color" content="#111111" />
  <meta name="application-name" content="${APP_NAME}" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="stylesheet" href="/app.css" />
  <script
    src="https://unpkg.com/nanalytics-tracker@0.1.2/dist/index.global.js"
    data-site-uuid="13e1bc25-a99b-4291-b627-0efaa6bce5e5"
    data-cvm-pubkey="d8a066f85d621d634e24ee0bf741e27b6436af28782195de8aa90972e310e937"
  ></script>
</head>`;
}

function renderHeader(session: Session | null) {
  return `<header class="page-header">
    <h1>${APP_NAME}</h1>
    <div class="session-controls" data-session-controls ${session ? "" : "hidden"}>
      <button class="avatar-chip" type="button" data-avatar ${session ? "" : "hidden"} title="Account menu">
        <span class="avatar-fallback" data-avatar-fallback>${session ? formatAvatarFallback(session.npub) : "•••"}</span>
        <img data-avatar-img alt="Profile photo" loading="lazy" ${session ? "" : "hidden"} />
      </button>
      <div class="avatar-menu" data-avatar-menu hidden>
        <button type="button" data-view-profile ${session ? "" : "hidden"}>View Profile</button>
        <div class="avatar-menu-credits" data-avatar-credits ${session ? "" : "hidden"}>
          <span class="credits-label">Credits:</span>
          <span class="credits-value" data-credits-display>...</span>
          <span class="credits-unit">hours</span>
        </div>
        <button type="button" class="buy-credits-btn" data-buy-credits ${session ? "" : "hidden"}>Buy Credits</button>
        <div class="avatar-menu-divider"></div>
        <button type="button" data-export-secret ${session?.method === "ephemeral" ? "" : "hidden"}>Export Secret</button>
        <button type="button" data-show-login-qr ${session?.method === "ephemeral" ? "" : "hidden"}>Show Login QR</button>
        <button type="button" data-copy-id ${session ? "" : "hidden"}>Copy ID</button>
        <button type="button" data-logout>Log out</button>
      </div>
    </div>
  </header>`;
}

function renderAuth(session: Session | null) {
  return `<section class="auth-panel" data-login-panel ${session ? "hidden" : ""}>
    <h2>Welcome to Ambulando</h2>
    <p class="auth-description">Track your daily habits, metrics, and progress. Private and encrypted.</p>
    <div class="auth-actions">
      <button class="auth-option" type="button" data-login-method="ephemeral">Ambulando... Anon</button>
      <button class="auth-option" type="button" data-login-method="extension">Browser Extension</button>
      <button class="auth-option auth-keyteleport" type="button" data-keyteleport-setup>Key Teleport</button>
    </div>
    <details class="auth-advanced">
      <summary>More sign-in options</summary>
      <p class="auth-description" style="margin-top: 0.75rem; margin-bottom: 0.75rem; font-size: 0.9rem;">Connect with a remote signer or import a key.</p>
      <button class="auth-option auth-nostr-connect" type="button" data-nostr-connect-btn>Nostr Connect (Mobile Signer)</button>
      <form data-bunker-form>
        <input name="bunker" placeholder="nostrconnect://… or name@example.com" autocomplete="off" />
        <button class="bunker-submit" type="submit">Connect bunker</button>
      </form>
      <form data-secret-form>
        <input type="password" name="secret" placeholder="nsec1…" autocomplete="off" />
        <button class="bunker-submit" type="submit">Sign in with secret</button>
      </form>
    </details>
    <p class="auth-error" data-login-error hidden></p>
  </section>`;
}

function renderTabNav(session: Session | null) {
  return `<nav class="tab-nav" data-tab-nav ${session ? "" : "hidden"}>
    <button class="tab-btn active" data-tab="track">Daily</button>
    <button class="tab-btn" data-tab="timers">Timers</button>
    <button class="tab-btn" data-tab="measures">Measures</button>
    <button class="tab-btn" data-tab="results">Results</button>
  </nav>`;
}

function renderTrackPanel(session: Session | null) {
  return `<section class="track-panel" data-track-panel ${session ? "" : "hidden"}>
    <div class="track-date-header">
      <button class="track-nav-btn" data-prev-day aria-label="Previous day">&lt;</button>
      <span class="track-date" data-track-date>Today</span>
      <button class="track-nav-btn" data-next-day aria-label="Next day">&gt;</button>
    </div>
    <div class="track-list" data-track-list>
      <p class="track-empty" data-track-empty>No measures set up yet. Go to Measures to add some.</p>
    </div>
  </section>`;
}

function renderTimersPanel(session: Session | null) {
  return `<section class="timers-panel" data-timers-panel ${session ? "" : "hidden"} hidden>
    <div class="timers-active" data-timers-active>
      <p class="timers-empty" data-timers-empty>No time-based measures set up yet.</p>
    </div>
    <div class="timers-history" data-timers-history>
      <h3>Recent Sessions</h3>
      <div class="timers-history-list" data-timers-history-list></div>
    </div>
  </section>`;
}

function renderMeasuresPanel(_session: Session | null) {
  return `<section class="measures-panel" data-measures-panel hidden>
    <h2>My Measures</h2>
    <p class="measures-description">Define what you want to track daily.</p>
    <div class="measures-list" data-measures-list></div>
    <button class="add-measure-btn" data-add-measure>+ Add Measure</button>
  </section>`;
}

function renderResultsPanel(_session: Session | null) {
  return `<section class="results-panel" data-results-panel hidden>
    <div class="results-header">
      <h2>Results</h2>
      <div class="results-view-toggle" data-results-view-toggle>
        <button class="results-view-btn" data-results-view="history">History</button>
        <button class="results-view-btn active" data-results-view="charts">Charts</button>
      </div>
    </div>
    <div class="results-history-view" data-results-history-view hidden>
      <div class="results-list" data-results-list>
        <p class="results-loading" data-results-loading>Loading...</p>
      </div>
      <div class="results-load-more" data-results-load-more hidden>
        <button type="button" data-load-more-results>Load more</button>
      </div>
    </div>
    <div class="results-charts-view" data-results-charts-view>
      <div class="charts-list" data-charts-list>
        <p class="charts-loading">Loading charts...</p>
      </div>
    </div>
  </section>`;
}

function renderMeasureModal() {
  return `<div class="measure-modal-overlay" data-measure-modal hidden>
    <div class="measure-modal">
      <button class="measure-modal-close" type="button" data-measure-close aria-label="Close">&times;</button>
      <h2 data-measure-modal-title>Add Measure</h2>
      <form class="measure-form" data-measure-form>
        <input type="hidden" name="id" data-measure-id />
        <label>
          Name
          <input type="text" name="name" data-measure-name placeholder="e.g. Weight, Exercise, Mood" required />
        </label>
        <label>
          Type
          <select name="type" data-measure-type>
            <option value="number">Number (e.g. 75.5 kg)</option>
            <option value="text">Text (notes)</option>
            <option value="goodbad">Good/Bad (+/-)</option>
            <option value="options">Multiple choice (2-5 options)</option>
            <option value="rating">Rating (1-10)</option>
            <option value="time">Time tracker (start/stop)</option>
          </select>
        </label>
        <div class="options-config" data-options-config hidden>
          <label>Options (comma separated, 2-5)
            <input type="text" name="options" data-measure-options placeholder="e.g. Positive, Negative, Flat" />
          </label>
        </div>
        <label class="checkbox-label">
          <input type="checkbox" name="encrypted" data-measure-encrypted checked />
          Encrypt data
        </label>
        <p class="measure-form-error" data-measure-error hidden></p>
        <div class="measure-form-actions">
          <button type="button" data-measure-cancel>Cancel</button>
          <button type="submit" data-measure-submit>Save</button>
        </div>
      </form>
    </div>
  </div>`;
}

function renderTimerEditModal() {
  return `<div class="timer-edit-modal-overlay" data-timer-edit-modal hidden>
    <div class="timer-edit-modal">
      <button class="timer-edit-modal-close" type="button" data-timer-edit-close aria-label="Close">&times;</button>
      <h2>Edit Timer Session</h2>
      <div class="timer-edit-form">
        <label>
          Start Time
          <input type="datetime-local" data-timer-edit-start />
        </label>
        <label>
          End Time
          <input type="datetime-local" data-timer-edit-end />
        </label>
        <div class="timer-edit-actions">
          <button type="button" data-timer-edit-cancel>Cancel</button>
          <button type="button" data-timer-edit-save>Save</button>
        </div>
      </div>
    </div>
  </div>`;
}

function renderQrModal() {
  return `<div class="qr-modal-overlay" data-qr-modal hidden>
    <div class="qr-modal">
      <button class="qr-modal-close" type="button" data-qr-close aria-label="Close">&times;</button>
      <h2>Login QR Code</h2>
      <p>Scan this code with your mobile device to log in</p>
      <div class="qr-canvas-container" data-qr-container></div>
    </div>
  </div>`;
}

function renderNostrConnectModal() {
  return `<div class="nostr-connect-overlay" data-nostr-connect-modal hidden>
    <div class="nostr-connect-modal">
      <button class="nostr-connect-close" type="button" data-nostr-connect-close aria-label="Close">&times;</button>
      <h2>Connect with Mobile Signer</h2>
      <p>Scan this QR code with Amber, Nostrsigner, or another NIP-46 signer app</p>
      <div class="nostr-connect-qr" data-nostr-connect-qr></div>
      <div class="nostr-connect-uri-wrapper">
        <input type="text" class="nostr-connect-uri" data-nostr-connect-uri readonly />
        <button type="button" class="nostr-connect-copy" data-nostr-connect-copy>Copy</button>
      </div>
      <p class="nostr-connect-status" data-nostr-connect-status>Waiting for connection...</p>
      <p class="nostr-connect-timer" data-nostr-connect-timer></p>
      <button type="button" class="nostr-connect-cancel" data-nostr-connect-cancel>Cancel</button>
    </div>
  </div>`;
}

function renderPinModal() {
  return `<div class="pin-modal-overlay" data-pin-modal hidden>
    <div class="pin-modal">
      <button class="pin-modal-close" type="button" data-pin-close aria-label="Close">&times;</button>
      <h2 data-pin-title>Enter PIN</h2>
      <p data-pin-description>Create a PIN to secure your secret key</p>
      <div class="pin-display" data-pin-display>
        <span class="pin-dot" data-pin-dot></span>
        <span class="pin-dot" data-pin-dot></span>
        <span class="pin-dot" data-pin-dot></span>
        <span class="pin-dot" data-pin-dot></span>
        <span class="pin-dot" data-pin-dot></span>
        <span class="pin-dot" data-pin-dot></span>
      </div>
      <p class="pin-error" data-pin-error hidden></p>
      <div class="pin-keypad" data-pin-keypad>
        <button type="button" data-pin-key="1">1</button>
        <button type="button" data-pin-key="2">2</button>
        <button type="button" data-pin-key="3">3</button>
        <button type="button" data-pin-key="4">4</button>
        <button type="button" data-pin-key="5">5</button>
        <button type="button" data-pin-key="6">6</button>
        <button type="button" data-pin-key="7">7</button>
        <button type="button" data-pin-key="8">8</button>
        <button type="button" data-pin-key="9">9</button>
        <button type="button" data-pin-key="clear" class="pin-key-action">Clear</button>
        <button type="button" data-pin-key="0">0</button>
        <button type="button" data-pin-key="back" class="pin-key-action">&larr;</button>
      </div>
    </div>
  </div>`;
}

function renderProfileModal() {
  return `<div class="profile-modal-overlay" data-profile-modal hidden>
    <div class="profile-modal">
      <button class="profile-modal-close" type="button" data-profile-close aria-label="Close">&times;</button>

      <div class="profile-view" data-profile-view>
        <div class="profile-header">
          <div class="profile-avatar" data-profile-avatar></div>
          <div class="profile-info">
            <h2 class="profile-name" data-profile-name>Loading...</h2>
            <p class="profile-nip05" data-profile-nip05></p>
          </div>
        </div>
        <p class="profile-about" data-profile-about></p>
        <p class="profile-npub" data-profile-npub></p>
        <button type="button" class="profile-edit-btn" data-profile-edit-btn>Edit Profile</button>
      </div>

      <form class="profile-edit-form" data-profile-edit-form hidden>
        <h2>Edit Profile</h2>
        <label>
          Display Name
          <input type="text" name="displayName" data-profile-edit-name placeholder="Your name" />
        </label>
        <label>
          About
          <textarea name="about" data-profile-edit-about rows="3" placeholder="Tell us about yourself"></textarea>
        </label>
        <label>
          Profile Picture URL
          <input type="url" name="picture" data-profile-edit-picture placeholder="https://..." />
        </label>
        <p class="profile-edit-status" data-profile-edit-status hidden></p>
        <div class="profile-edit-actions">
          <button type="button" data-profile-edit-cancel>Cancel</button>
          <button type="submit">Save Profile</button>
        </div>
      </form>
    </div>
  </div>`;
}

function renderSessionSeed(session: Session | null, initialTab: TabName, initialDate?: string) {
  return `<script>
    window.__NOSTR_SESSION__ = ${JSON.stringify(session ?? null)};
    window.__NOSTR_RELAYS__ = ${JSON.stringify(NOSTR_RELAYS)};
    window.__APP_NAME__ = ${JSON.stringify(APP_NAME)};
    window.__APP_FAVICON__ = "/favicon.png";
    window.__INITIAL_TAB__ = ${JSON.stringify(initialTab)};
    window.__INITIAL_DATE__ = ${JSON.stringify(initialDate ?? null)};
  </script>`;
}

function formatAvatarFallback(npub: string) {
  if (!npub) return "•••";
  return npub.replace(/^npub1/, "").slice(0, 2).toUpperCase();
}

function renderCreditsModal() {
  return `<div class="credits-modal-overlay" data-credits-modal hidden>
    <div class="credits-modal">
      <button class="credits-modal-close" type="button" data-credits-close aria-label="Close">&times;</button>
      <h2>Buy Credits</h2>

      <div class="credits-info" data-credits-info>
        <p class="credits-balance">Current balance: <strong data-credits-current>0 hours</strong></p>
        <p class="credits-price">Price: <strong data-credits-price>...</strong> sats/hour</p>
      </div>

      <div class="credits-purchase-form" data-credits-purchase-form>
        <label class="credits-quantity-label">
          Hours to purchase:
          <div class="credits-quick-select">
            <button type="button" class="credits-quick-btn" data-credits-quick="24">1 day</button>
            <button type="button" class="credits-quick-btn" data-credits-quick="168">7 days</button>
            <button type="button" class="credits-quick-btn" data-credits-quick="504">21 days</button>
          </div>
          <div class="credits-quantity-controls">
            <input type="range" data-credits-quantity-slider min="1" max="504" value="24" />
            <span class="credits-quantity-value" data-credits-quantity-value>24</span>
          </div>
        </label>
        <p class="credits-total">Total: <strong data-credits-total>...</strong> sats</p>
        <button type="button" class="credits-generate-btn" data-credits-generate>Generate Invoice</button>
      </div>

      <div class="credits-invoice" data-credits-invoice hidden>
        <div class="credits-qr" data-credits-qr></div>
        <div class="credits-bolt11-wrapper">
          <input type="text" class="credits-bolt11" data-credits-bolt11 readonly />
          <button type="button" class="credits-copy-btn" data-credits-copy>Copy</button>
        </div>
        <p class="credits-status" data-credits-status>Waiting for payment...</p>
        <button type="button" class="credits-check-btn" data-credits-check>Check Payment</button>
        <button type="button" class="credits-new-btn" data-credits-new>New Invoice</button>
      </div>

      <div class="credits-pending" data-credits-pending>
        <h3>Pending Orders</h3>
        <div class="credits-pending-list" data-credits-pending-list></div>
      </div>

      <div class="credits-history" data-credits-history hidden>
        <h3>Transaction History</h3>
        <div class="credits-history-list" data-credits-history-list></div>
        <button type="button" class="credits-history-toggle" data-credits-history-toggle>Show History</button>
      </div>
    </div>
  </div>`;
}

function renderNoCreditsOverlay() {
  return `<div class="no-credits-overlay" data-no-credits-overlay hidden>
    <div class="no-credits-content">
      <h2>No Credits Remaining</h2>
      <p>Purchase credits to continue tracking your habits.</p>
      <p class="no-credits-note">Your existing data is safely stored locally.</p>
      <button type="button" class="no-credits-buy-btn" data-no-credits-buy>Buy Credits</button>
    </div>
  </div>`;
}

function renderKeyTeleportOverlay() {
  return `<div id="keyteleport-overlay" class="keyteleport-overlay" hidden>
    <div class="keyteleport-modal">
      <h2>Complete Login</h2>
      <p class="keyteleport-description">Paste the unlock code from your clipboard to complete the login.</p>
      <input
        type="password"
        id="keyteleport-unlock-input"
        class="keyteleport-input"
        placeholder="nsec1..."
        autocomplete="off"
        spellcheck="false"
      />
      <p id="keyteleport-error" class="keyteleport-error" hidden></p>
      <div class="keyteleport-actions">
        <button type="button" id="keyteleport-cancel" class="keyteleport-cancel">Cancel</button>
        <button type="button" id="keyteleport-submit" class="keyteleport-submit">Unlock</button>
      </div>
    </div>
  </div>`;
}

function renderKeyTeleportSetupModal() {
  return `<div id="keyteleport-setup-overlay" class="keyteleport-overlay" hidden>
    <div class="keyteleport-modal keyteleport-setup-modal">
      <h2>Setup Key Teleport</h2>
      <p class="keyteleport-description">Copy this registration code and paste it into your key manager (e.g., Welcome) to connect Ambulando.</p>
      <textarea
        id="keyteleport-setup-blob"
        class="keyteleport-blob-output"
        readonly
        rows="4"
        placeholder="Loading..."
      ></textarea>
      <p id="keyteleport-setup-error" class="keyteleport-error" hidden></p>
      <div class="keyteleport-actions">
        <button type="button" id="keyteleport-setup-cancel" class="keyteleport-cancel">Cancel</button>
        <button type="button" id="keyteleport-setup-copy" class="keyteleport-submit">Copy Code</button>
      </div>
    </div>
  </div>`;
}
