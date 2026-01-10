import { initAuth } from "./auth.js";
import { initAvatarMenu } from "./avatar.js";
import { initMeasures } from "./measures.js";
import { initPullRefresh } from "./pullRefresh.js";
import { initResults } from "./results.js";
import { connectSSE, disconnectSSE } from "./sse.js";
import { onRefresh, state } from "./state.js";
import { initTabs, showTabsIfLoggedIn } from "./tabs.js";
import { initTimers } from "./timers.js";
import { initTracker } from "./tracker.js";
import { initUI } from "./ui.js";

// Register service worker for caching
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((err) => {
    console.warn("Service worker registration failed:", err);
  });
}

initAvatarMenu();
initUI();
initAuth();
initPullRefresh();

// Track if modules have been initialized
let modulesInitialized = false;

const initTrackerModules = () => {
  if (!state.session) return;

  initTabs();
  showTabsIfLoggedIn();
  void initMeasures();
  void initTracker();
  void initTimers();
  void initResults();
  connectSSE(); // Connect to real-time updates
  modulesInitialized = true;
};

// Re-initialize modules when session changes (login/logout)
onRefresh(() => {
  if (state.session && !modulesInitialized) {
    initTrackerModules();
  } else if (!state.session) {
    modulesInitialized = false;
    disconnectSSE(); // Disconnect on logout
  }
});

// Initialize tracker modules on page load if already logged in
window.addEventListener("load", () => {
  initTrackerModules();
});
