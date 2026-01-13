// Tab navigation for Daily Tracker

import { elements as el, show, hide } from "./dom.js";
import { state } from "./state.js";

let currentTab = "track";
let currentDate = null; // Track the current date for daily tab

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

// Parse URL to extract tab and optional date
function parseUrl(pathname) {
  // Check for /daily/YYYY-MM-DD pattern
  const dailyDateMatch = pathname.match(/^\/daily\/(\d{4}-\d{2}-\d{2})$/);
  if (dailyDateMatch) {
    return { tab: "track", date: dailyDateMatch[1] };
  }

  // Standard tab routes
  const tab = urlToTab[pathname];
  if (tab) {
    return { tab, date: null };
  }

  return { tab: "track", date: null };
}

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
    const { tab, date } = parseUrl(window.location.pathname);
    currentDate = date;
    switchTab(tab, false, date); // false = don't update URL (already changed)
  });

  // Determine initial tab and date from server-provided values or URL
  const serverInitialTab = window.__INITIAL_TAB__;
  const serverInitialDate = window.__INITIAL_DATE__;
  const initialTab = serverInitialTab ? initialTabMap[serverInitialTab] || "track" : "track";
  currentDate = serverInitialDate || null;

  switchTab(initialTab, false, currentDate); // Don't push state on initial load
}

export function switchTab(tab, updateUrl = true, date = null) {
  if (!panels[tab]) return;

  currentTab = tab;

  // Update URL if requested (and different from current)
  if (updateUrl && tabToUrl[tab]) {
    let newPath = tabToUrl[tab];
    // For daily tab, include date in URL if set
    if (tab === "track" && currentDate) {
      newPath = `/daily/${currentDate}`;
    }
    if (window.location.pathname !== newPath) {
      history.pushState({ tab, date: currentDate }, "", newPath);
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
  window.dispatchEvent(new CustomEvent("tab-switched", { detail: { tab, date } }));
}

export function getCurrentTab() {
  return currentTab;
}

// Update the URL when navigating dates in the daily tracker
export function updateDailyDate(dateStr) {
  currentDate = dateStr;

  if (currentTab !== "track") return;

  // Update URL without triggering a page load
  const newPath = dateStr ? `/daily/${dateStr}` : "/daily";
  if (window.location.pathname !== newPath) {
    history.replaceState({ tab: "track", date: dateStr }, "", newPath);
  }
}

// Get the current date from URL/state
export function getCurrentDate() {
  return currentDate;
}

export function showTabsIfLoggedIn() {
  if (state.session) {
    show(el.tabNav);
    // Show the current tab's panel (already set by initTabs)
    const panel = panels[currentTab]?.();
    if (panel) show(panel);
  } else {
    hide(el.tabNav);
    hide(el.trackPanel);
    hide(el.timersPanel);
    hide(el.measuresPanel);
    hide(el.resultsPanel);
  }
}
