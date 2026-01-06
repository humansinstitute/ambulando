import { initAuth } from "./auth.js";
import { initAvatarMenu } from "./avatar.js";
import { initMeasures } from "./measures.js";
import { initPullRefresh } from "./pullRefresh.js";
import { initResults } from "./results.js";
import { initTabs, showTabsIfLoggedIn } from "./tabs.js";
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

// Initialize tracker modules after auth has a chance to set up session
window.addEventListener("load", () => {
  initTabs();
  showTabsIfLoggedIn();
  void initMeasures();
  void initTracker();
  void initResults();
});
