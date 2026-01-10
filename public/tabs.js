// Tab navigation for Daily Tracker

import { elements as el, show, hide } from "./dom.js";
import { state } from "./state.js";

let currentTab = "track";

const panels = {
  track: () => el.trackPanel,
  timers: () => el.timersPanel,
  measures: () => el.measuresPanel,
  results: () => el.resultsPanel,
};

// Map URL paths to internal tab names
const urlToTab = {
  "/": "track",
  "/daily": "track",
  "/timers": "timers",
  "/measures": "measures",
  "/results": "results",
};

// Map internal tab names to URL paths
const tabToUrl = {
  track: "/daily",
  timers: "/timers",
  measures: "/measures",
  results: "/results",
};

// Map server initial tab names to internal tab names
const initialTabMap = {
  daily: "track",
  timers: "timers",
  measures: "measures",
  results: "results",
};

export function initTabs() {
  if (!el.tabNav) return;

  // Wire up tab buttons
  el.tabNav.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (tab) switchTab(tab, true); // true = update URL
    });
  });

  // Handle browser back/forward navigation
  window.addEventListener("popstate", () => {
    const tab = urlToTab[window.location.pathname] || "track";
    switchTab(tab, false); // false = don't update URL (already changed)
  });

  // Determine initial tab from server-provided value or URL
  const serverInitialTab = window.__INITIAL_TAB__;
  const initialTab = serverInitialTab ? initialTabMap[serverInitialTab] || "track" : "track";

  switchTab(initialTab, false); // Don't push state on initial load
}

export function switchTab(tab, updateUrl = true) {
  if (!panels[tab]) return;

  currentTab = tab;

  // Update URL if requested (and different from current)
  if (updateUrl && tabToUrl[tab]) {
    const newPath = tabToUrl[tab];
    if (window.location.pathname !== newPath) {
      history.pushState({ tab }, "", newPath);
    }
  }

  // Update button states
  el.tabNav?.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });

  // Show/hide panels
  Object.entries(panels).forEach(([name, getPanel]) => {
    const panel = getPanel();
    if (name === tab) {
      show(panel);
    } else {
      hide(panel);
    }
  });

  // Trigger panel-specific load if needed
  window.dispatchEvent(new CustomEvent("tab-switched", { detail: { tab } }));
}

export function getCurrentTab() {
  return currentTab;
}

export function showTabsIfLoggedIn() {
  if (state.session) {
    show(el.tabNav);
    show(el.trackPanel);
  } else {
    hide(el.tabNav);
    hide(el.trackPanel);
    hide(el.timersPanel);
    hide(el.measuresPanel);
    hide(el.resultsPanel);
  }
}
