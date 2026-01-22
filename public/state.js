// Client state management
// Maintains backward compatibility while migrating to Dexie + Alpine

import { initDB } from "./db.js";
import { initStores, initSessionStores, destroyStores, loadAlpine } from "./stores.js";

const refreshers = new Set();

// Legacy state object (for backward compatibility during migration)
export const state = {
  session: window.__NOSTR_SESSION__,
  summaries: { day: null, week: null },
};

// Initialize Dexie database early
let dbInitialized = false;
async function ensureDBInitialized() {
  if (!dbInitialized) {
    await initDB();
    dbInitialized = true;
  }
}

// Initialize on module load
ensureDBInitialized().catch(console.error);

export const setSession = async (nextSession) => {
  state.session = nextSession;

  // Initialize Alpine stores when session is set
  if (nextSession) {
    try {
      await ensureDBInitialized();
      await initStores(nextSession);
      await initSessionStores();
    } catch (err) {
      console.error("[state] Failed to initialize stores:", err);
    }
  } else {
    // Clear stores on logout
    destroyStores();
  }

  refreshUI();
};

export const setSummaries = (summaries) => {
  state.summaries = summaries;
  refreshUI();
};

export const onRefresh = (callback) => {
  refreshers.add(callback);
};

export const offRefresh = (callback) => {
  refreshers.delete(callback);
};

export const refreshUI = () => {
  refreshers.forEach((cb) => cb());
};

// Initialize stores if session already exists on page load
if (state.session) {
  ensureDBInitialized()
    .then(() => initStores(state.session))
    .then(() => initSessionStores())
    .catch(console.error);
}
