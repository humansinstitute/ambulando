// Results panel for Daily Tracker

import { elements as el, show, hide, setText } from "./dom.js";
import { decryptEntry } from "./entryCrypto.js";
import { state } from "./state.js";

let measures = [];
let historyData = [];
let isLoading = false;
let hasMore = true;
const PAGE_SIZE = 50;

export async function initResults() {
  if (!state.session) return;

  // Wire up load more button
  el.loadMoreResultsBtn?.addEventListener("click", loadMoreResults);

  // Listen for tab switches
  window.addEventListener("tab-switched", (e) => {
    if (e.detail.tab === "results") {
      void loadResults();
    }
  });

  // Listen for measures changes
  window.addEventListener("measures-changed", () => {
    void loadMeasures();
  });

  await loadMeasures();
}

async function loadMeasures() {
  if (!state.session) return;

  try {
    const response = await fetch("/measures");
    if (!response.ok) throw new Error("Failed to fetch measures");

    const data = await response.json();
    measures = data.measures || [];
  } catch (err) {
    console.error("Failed to load measures:", err);
    measures = [];
  }
}

async function loadResults(reset = true) {
  if (!state.session || isLoading) return;

  if (reset) {
    historyData = [];
    hasMore = true;
    hide(el.resultsLoadMore);
    if (el.resultsList) {
      el.resultsList.innerHTML = '<p class="results-loading">Loading...</p>';
    }
  }

  isLoading = true;

  try {
    const response = await fetch(`/tracking?limit=${PAGE_SIZE}`);
    if (!response.ok) throw new Error("Failed to fetch tracking data");

    const data = await response.json();
    const records = data.data || [];

    // Decrypt values where needed
    for (const record of records) {
      const measure = measures.find((m) => m.id === record.measure_id);
      if (!measure) continue;

      let value = record.value;
      if (measure.encrypted && value) {
        try {
          value = await decryptEntry(value);
        } catch (err) {
          console.error("Failed to decrypt:", err);
          value = "[Unable to decrypt]";
        }
      }

      // Parse JSON value if applicable
      try {
        value = JSON.parse(value);
      } catch (_err) {
        // Keep as string if not JSON
      }

      historyData.push({
        ...record,
        decryptedValue: value,
        measureName: measure.name,
        measureType: measure.type,
      });
    }

    hasMore = records.length >= PAGE_SIZE;
    renderResults();

    if (hasMore) {
      show(el.resultsLoadMore);
    } else {
      hide(el.resultsLoadMore);
    }
  } catch (err) {
    console.error("Failed to load results:", err);
    if (el.resultsList && historyData.length === 0) {
      el.resultsList.innerHTML = '<p class="results-empty">Failed to load history.</p>';
    }
  } finally {
    isLoading = false;
  }
}

async function loadMoreResults() {
  await loadResults(false);
}

function renderResults() {
  if (!el.resultsList) return;

  if (historyData.length === 0) {
    el.resultsList.innerHTML = '<p class="results-empty">No tracking data yet. Start tracking on the Track tab.</p>';
    return;
  }

  // Group by date
  const byDate = new Map();
  for (const record of historyData) {
    const date = record.recorded_at.slice(0, 10); // YYYY-MM-DD
    if (!byDate.has(date)) {
      byDate.set(date, []);
    }
    byDate.get(date).push(record);
  }

  // Sort dates descending
  const sortedDates = Array.from(byDate.keys()).sort((a, b) => b.localeCompare(a));

  // Render each date group
  const html = sortedDates
    .map((date) => {
      const records = byDate.get(date);
      const dateLabel = formatHistoryDate(date);

      const entriesHtml = records
        .map((record) => {
          const valueDisplay = formatValue(record.decryptedValue, record.measureType);
          return `
            <div class="results-entry">
              <span class="results-entry-name">${escapeHtml(record.measureName)}</span>
              <span class="results-entry-value ${valueDisplay.className}">${valueDisplay.text}</span>
            </div>
          `;
        })
        .join("");

      return `
        <div class="results-day">
          <h3 class="results-date">${dateLabel}</h3>
          <div class="results-entries">
            ${entriesHtml}
          </div>
        </div>
      `;
    })
    .join("");

  el.resultsList.innerHTML = html || '<p class="results-empty">No tracking data yet.</p>';
}

function formatValue(value, type) {
  if (value === null || value === undefined || value === "") {
    return { text: "-", className: "" };
  }

  switch (type) {
    case "number":
      return { text: String(value), className: "" };

    case "text":
      const text = String(value).slice(0, 50);
      return { text: text + (String(value).length > 50 ? "..." : ""), className: "" };

    case "goodbad":
      if (value === "good" || value === 1 || value === "1") {
        return { text: "+", className: "good" };
      }
      if (value === "bad" || value === -1 || value === "-1") {
        return { text: "-", className: "bad" };
      }
      return { text: "-", className: "" };

    case "time":
      if (typeof value === "object") {
        if (value.duration) {
          return { text: formatDuration(value.duration), className: "duration" };
        }
        if (value.start && !value.end) {
          return { text: "Running...", className: "duration" };
        }
      }
      return { text: "-", className: "" };

    case "options":
      return { text: escapeHtml(String(value)), className: "option-value" };

    case "rating":
      const rating = parseInt(value, 10);
      if (rating >= 1 && rating <= 10) {
        return { text: `${rating}/10`, className: "rating-value" };
      }
      return { text: "-", className: "" };

    default:
      return { text: String(value), className: "" };
  }
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

function formatHistoryDate(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  const today = new Date();
  const todayStr = getLocalDateString(today);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = getLocalDateString(yesterday);

  if (dateStr === todayStr) {
    return "Today";
  }
  if (dateStr === yesterdayStr) {
    return "Yesterday";
  }

  const options = { weekday: "long", month: "long", day: "numeric" };
  return date.toLocaleDateString("en-US", options);
}

function getLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
