// Tab navigation for Daily Tracker

import { elements as el, show, hide } from "./dom.js";
import { state } from "./state.js";

let currentTab = "track";

const panels = {
  track: () => el.trackPanel,
  measures: () => el.measuresPanel,
  results: () => el.resultsPanel,
};

export function initTabs() {
  if (!el.tabNav) return;

  // Wire up tab buttons
  el.tabNav.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (tab) switchTab(tab);
    });
  });

  // Start on track tab
  switchTab("track");
}

export function switchTab(tab) {
  if (!panels[tab]) return;

  currentTab = tab;

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
    hide(el.measuresPanel);
    hide(el.resultsPanel);
  }
}
