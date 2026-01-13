// Results panel for Daily Tracker

import { elements as el, show, hide } from "./dom.js";
import { decryptEntry } from "./entryCrypto.js";
import { state } from "./state.js";
import { getCurrentTab } from "./tabs.js";

let measures = [];
let historyData = [];
let chartData = []; // Data for charts (30 days)
let isLoading = false;
let hasMore = true;
let currentView = "charts"; // "history" or "charts"
const PAGE_SIZE = 50;
const CHART_DAYS = 30;

export async function initResults() {
  if (!state.session) return;

  // Wire up load more button
  el.loadMoreResultsBtn?.addEventListener("click", loadMoreResults);

  // Wire up view toggle
  el.resultsViewToggle?.addEventListener("click", handleViewToggle);

  // Listen for tab switches
  window.addEventListener("tab-switched", (e) => {
    if (e.detail.tab === "results") {
      if (currentView === "charts") {
        void loadChartData();
      } else {
        void loadResults();
      }
    }
  });

  // Listen for measures changes
  window.addEventListener("measures-changed", () => {
    void loadMeasures();
  });

  await loadMeasures();

  // If already on results tab, load data now (event already fired before listener was set up)
  if (getCurrentTab() === "results") {
    if (currentView === "charts") {
      void loadChartData();
    } else {
      void loadResults();
    }
  }
}

function handleViewToggle(e) {
  const btn = e.target.closest("[data-results-view]");
  if (!btn) return;

  const view = btn.dataset.resultsView;
  if (view === currentView) return;

  currentView = view;

  // Update button states
  el.resultsViewToggle?.querySelectorAll(".results-view-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.resultsView === view);
  });

  // Toggle views
  if (view === "history") {
    show(el.resultsHistoryView);
    hide(el.resultsChartsView);
    void loadResults();
  } else {
    hide(el.resultsHistoryView);
    show(el.resultsChartsView);
    void loadChartData();
  }
}

async function loadMeasures() {
  if (!state.session) return;

  try {
    const response = await fetch("/api/measures");
    if (!response.ok) throw new Error("Failed to fetch measures");

    const data = await response.json();
    const rawMeasures = data.measures || [];

    // Decrypt measure names and configs
    measures = await decryptMeasures(rawMeasures);
  } catch (err) {
    console.error("Failed to load measures:", err);
    measures = [];
  }
}

// Decrypt measure names and config fields
async function decryptMeasures(rawMeasures) {
  const decrypted = [];

  for (const m of rawMeasures) {
    try {
      // Try to decrypt name
      let name = m.name;
      try {
        name = await decryptEntry(m.name);
      } catch (_err) {
        // If decryption fails, it's likely plaintext (pre-encryption data)
      }

      // Try to decrypt config if present
      let config = m.config;
      if (m.config) {
        try {
          config = await decryptEntry(m.config);
        } catch (_err) {
          // If decryption fails, keep as-is
        }
      }

      decrypted.push({ ...m, name, config });
    } catch (err) {
      console.error(`Failed to process measure ${m.id}:`, err);
      decrypted.push({ ...m, name: "[Unable to decrypt]" });
    }
  }

  return decrypted;
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

// ============================================================
// Charts View
// ============================================================

async function loadChartData() {
  if (!state.session || isLoading) return;

  isLoading = true;

  if (el.chartsList) {
    el.chartsList.innerHTML = '<p class="charts-loading">Loading charts...</p>';
  }

  try {
    // Calculate date range for last 30 days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - CHART_DAYS);

    const startStr = getLocalDateString(startDate);
    const endStr = getLocalDateString(new Date(endDate.getTime() + 86400000)); // +1 day for inclusive

    const response = await fetch(`/tracking?start=${startStr}&end=${endStr}`);
    if (!response.ok) throw new Error("Failed to fetch chart data");

    const data = await response.json();
    const records = data.data || [];

    chartData = [];

    // Decrypt and process
    for (const record of records) {
      const measure = measures.find((m) => m.id === record.measure_id);
      if (!measure) continue;

      let value = record.value;
      if (measure.encrypted && value) {
        try {
          value = await decryptEntry(value);
        } catch (err) {
          console.error("Failed to decrypt:", err);
          continue;
        }
      }

      try {
        value = JSON.parse(value);
      } catch (_err) {
        // Keep as string
      }

      chartData.push({
        ...record,
        decryptedValue: value,
        measureId: measure.id,
        measureName: measure.name,
        measureType: measure.type,
      });
    }

    renderCharts();
  } catch (err) {
    console.error("Failed to load chart data:", err);
    if (el.chartsList) {
      el.chartsList.innerHTML = '<p class="charts-empty">Failed to load charts.</p>';
    }
  } finally {
    isLoading = false;
  }
}

function renderCharts() {
  if (!el.chartsList) return;

  if (measures.length === 0) {
    el.chartsList.innerHTML = '<p class="charts-empty">No measures defined. Add some in the Measures tab.</p>';
    return;
  }

  // Group chart data by measure
  const dataByMeasure = new Map();
  for (const record of chartData) {
    if (!dataByMeasure.has(record.measureId)) {
      dataByMeasure.set(record.measureId, []);
    }
    dataByMeasure.get(record.measureId).push(record);
  }

  // Render a chart card for each measure
  const html = measures
    .map((measure) => {
      const data = dataByMeasure.get(measure.id) || [];
      return renderChartCard(measure, data);
    })
    .join("");

  el.chartsList.innerHTML = html || '<p class="charts-empty">No measures to chart.</p>';
}

function renderChartCard(measure, data) {
  const chartContent = renderChartByType(measure, data);

  return `
    <div class="chart-card">
      <div class="chart-card-header">
        <span class="chart-card-name">${escapeHtml(measure.name)}</span>
        <span class="chart-card-type">${getChartTypeLabel(measure.type)}</span>
      </div>
      <div class="chart-card-content">
        ${chartContent}
      </div>
    </div>
  `;
}

function getChartTypeLabel(type) {
  const labels = {
    number: "Line Chart",
    goodbad: "30-Day Streak",
    rating: "Rating Trend",
    time: "Duration Bars",
    options: "Frequency",
    text: "Activity Log",
  };
  return labels[type] || type;
}

function renderChartByType(measure, data) {
  if (data.length === 0) {
    return '<p class="chart-empty">No data in last 30 days</p>';
  }

  switch (measure.type) {
    case "number":
      return renderLineChart(data);
    case "goodbad":
      return renderStreakChart(data);
    case "rating":
      return renderRatingChart(data);
    case "time":
      return renderDurationChart(data);
    case "options":
      return renderOptionsChart(data, measure);
    case "text":
      return renderTextActivityChart(data);
    default:
      return '<p class="chart-empty">Chart not available for this type</p>';
  }
}

// Line chart for numbers
function renderLineChart(data) {
  // Sort by date
  const sorted = [...data].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const values = sorted.map((d) => parseFloat(d.decryptedValue) || 0);

  if (values.length === 0) return '<p class="chart-empty">No numeric data</p>';

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const width = 280;
  const height = 100;
  const padding = 10;

  // Generate SVG path
  const points = values.map((v, i) => {
    const x = padding + (i / (values.length - 1 || 1)) * (width - 2 * padding);
    const y = height - padding - ((v - min) / range) * (height - 2 * padding);
    return `${x},${y}`;
  });

  const pathD = points.length > 1 ? `M ${points.join(" L ")}` : "";

  // Stats
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const latest = values[values.length - 1];

  return `
    <svg class="line-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <path d="${pathD}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${points.map((p, i) => `<circle cx="${p.split(",")[0]}" cy="${p.split(",")[1]}" r="3" fill="var(--accent)"/>`).join("")}
    </svg>
    <div class="chart-stats">
      <span>Latest: <strong>${latest.toFixed(1)}</strong></span>
      <span>Avg: <strong>${avg.toFixed(1)}</strong></span>
      <span>Range: ${min.toFixed(1)} - ${max.toFixed(1)}</span>
    </div>
  `;
}

// Streak chart for good/bad (30 colored boxes)
function renderStreakChart(data) {
  // Build a map of date -> value
  const byDate = new Map();
  for (const d of data) {
    const date = d.recorded_at.slice(0, 10);
    byDate.set(date, d.decryptedValue);
  }

  // Generate last 30 days
  const days = [];
  for (let i = CHART_DAYS - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = getLocalDateString(date);
    const value = byDate.get(dateStr);

    let status = "empty";
    if (value === "good" || value === 1 || value === "1") status = "good";
    else if (value === "bad" || value === -1 || value === "-1") status = "bad";

    days.push({ date: dateStr, status, dayLabel: date.getDate() });
  }

  // Count stats
  const goodCount = days.filter((d) => d.status === "good").length;
  const badCount = days.filter((d) => d.status === "bad").length;

  const boxes = days
    .map(
      (d) => `<div class="streak-box ${d.status}" title="${d.date}"></div>`
    )
    .join("");

  return `
    <div class="streak-chart">
      ${boxes}
    </div>
    <div class="chart-stats">
      <span class="good-stat">Good: <strong>${goodCount}</strong></span>
      <span class="bad-stat">Bad: <strong>${badCount}</strong></span>
      <span>Empty: ${CHART_DAYS - goodCount - badCount}</span>
    </div>
  `;
}

// Rating trend (1-10)
function renderRatingChart(data) {
  const sorted = [...data].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const values = sorted.map((d) => parseInt(d.decryptedValue, 10) || 0).filter((v) => v >= 1 && v <= 10);

  if (values.length === 0) return '<p class="chart-empty">No rating data</p>';

  const width = 280;
  const height = 80;
  const padding = 10;

  const points = values.map((v, i) => {
    const x = padding + (i / (values.length - 1 || 1)) * (width - 2 * padding);
    const y = height - padding - ((v - 1) / 9) * (height - 2 * padding);
    return `${x},${y}`;
  });

  const pathD = points.length > 1 ? `M ${points.join(" L ")}` : "";
  const avg = values.reduce((a, b) => a + b, 0) / values.length;

  return `
    <svg class="rating-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <path d="${pathD}" fill="none" stroke="var(--accent)" stroke-width="2"/>
      ${points.map((p) => `<circle cx="${p.split(",")[0]}" cy="${p.split(",")[1]}" r="3" fill="var(--accent)"/>`).join("")}
    </svg>
    <div class="chart-stats">
      <span>Latest: <strong>${values[values.length - 1]}/10</strong></span>
      <span>Average: <strong>${avg.toFixed(1)}/10</strong></span>
    </div>
  `;
}

// Duration bar chart for time trackers
function renderDurationChart(data) {
  // Group by date and sum durations
  const byDate = new Map();
  for (const d of data) {
    const date = d.recorded_at.slice(0, 10);
    const duration = typeof d.decryptedValue === "object" ? d.decryptedValue.duration || 0 : 0;
    byDate.set(date, (byDate.get(date) || 0) + duration);
  }

  if (byDate.size === 0) return '<p class="chart-empty">No duration data</p>';

  // Get last 14 days for bars (more readable)
  const bars = [];
  const maxDays = 14;
  for (let i = maxDays - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = getLocalDateString(date);
    const duration = byDate.get(dateStr) || 0;
    bars.push({ date: dateStr, duration, dayLabel: date.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2) });
  }

  const maxDuration = Math.max(...bars.map((b) => b.duration), 1);
  const totalSeconds = bars.reduce((sum, b) => sum + b.duration, 0);

  const barsHtml = bars
    .map((b) => {
      const heightPercent = (b.duration / maxDuration) * 100;
      return `
        <div class="duration-bar-wrapper" title="${b.date}: ${formatDuration(b.duration)}">
          <div class="duration-bar" style="height: ${heightPercent}%"></div>
          <span class="duration-bar-label">${b.dayLabel}</span>
        </div>
      `;
    })
    .join("");

  return `
    <div class="duration-chart">
      ${barsHtml}
    </div>
    <div class="chart-stats">
      <span>Total: <strong>${formatDuration(totalSeconds)}</strong></span>
      <span>Days tracked: ${bars.filter((b) => b.duration > 0).length}</span>
    </div>
  `;
}

// Options frequency chart
function renderOptionsChart(data, measure) {
  let options = [];
  try {
    options = measure.config ? JSON.parse(measure.config) : [];
  } catch (_err) {
    options = [];
  }

  // Count occurrences
  const counts = new Map();
  for (const opt of options) {
    counts.set(opt, 0);
  }
  for (const d of data) {
    const val = d.decryptedValue;
    if (counts.has(val)) {
      counts.set(val, counts.get(val) + 1);
    }
  }

  const maxCount = Math.max(...counts.values(), 1);

  const barsHtml = options
    .map((opt) => {
      const count = counts.get(opt) || 0;
      const widthPercent = (count / maxCount) * 100;
      return `
        <div class="option-bar-row">
          <span class="option-bar-label">${escapeHtml(opt)}</span>
          <div class="option-bar-track">
            <div class="option-bar-fill" style="width: ${widthPercent}%"></div>
          </div>
          <span class="option-bar-count">${count}</span>
        </div>
      `;
    })
    .join("");

  return `
    <div class="options-chart">
      ${barsHtml}
    </div>
  `;
}

// Text activity (just show count/dots)
function renderTextActivityChart(data) {
  // Build a map of date -> has entry
  const byDate = new Map();
  for (const d of data) {
    const date = d.recorded_at.slice(0, 10);
    byDate.set(date, true);
  }

  // Generate last 30 days
  const days = [];
  for (let i = CHART_DAYS - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = getLocalDateString(date);
    days.push({ date: dateStr, hasEntry: byDate.has(dateStr) });
  }

  const entryCount = days.filter((d) => d.hasEntry).length;

  const dots = days
    .map((d) => `<div class="activity-dot ${d.hasEntry ? "filled" : ""}" title="${d.date}"></div>`)
    .join("");

  return `
    <div class="activity-chart">
      ${dots}
    </div>
    <div class="chart-stats">
      <span>Entries: <strong>${entryCount}</strong> / ${CHART_DAYS} days</span>
    </div>
  `;
}
