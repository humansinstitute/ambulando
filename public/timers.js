// Timers panel for time-based tracking

import { elements as el, show, hide } from "./dom.js";
import { encryptEntry, decryptEntry } from "./entryCrypto.js";
import { state } from "./state.js";

let timeMeasures = [];
let timerSessions = {}; // Map of measureId -> array of sessions
let runningTimers = {}; // Map of measureId -> { start, intervalId }

export async function initTimers() {
  if (!state.session) return;

  // Listen for tab switches
  window.addEventListener("tab-switched", (e) => {
    if (e.detail.tab === "timers") {
      void loadTimersData();
    }
  });

  // Listen for measures changes
  window.addEventListener("measures-changed", () => {
    void loadTimersData();
  });
}

async function loadTimersData() {
  if (!state.session) return;

  await loadTimeMeasures();
  await loadTimerSessions();
  renderTimersPanel();
}

async function loadTimeMeasures() {
  try {
    const response = await fetch("/measures");
    if (!response.ok) throw new Error("Failed to fetch measures");

    const data = await response.json();
    timeMeasures = (data.measures || []).filter((m) => m.type === "time");
  } catch (err) {
    console.error("Failed to load measures:", err);
    timeMeasures = [];
  }
}

async function loadTimerSessions() {
  if (timeMeasures.length === 0) return;

  timerSessions = {};
  runningTimers = {}; // Clear running timers before reloading

  try {
    // Fetch recent timer sessions for all time measures
    const response = await fetch("/tracking/timers/sessions?limit=20");
    if (!response.ok) throw new Error("Failed to fetch timer sessions");

    const data = await response.json();
    const sessions = data.sessions || [];

    // Decrypt and organize by measure
    for (const session of sessions) {
      const measure = timeMeasures.find((m) => m.id === session.measure_id);
      if (!measure) continue;

      let decryptedValue = session.value;
      if (measure.encrypted && session.value) {
        try {
          const decrypted = await decryptEntry(session.value);
          decryptedValue = JSON.parse(decrypted);
        } catch (err) {
          console.error("Failed to decrypt timer session:", err);
          continue;
        }
      } else if (typeof session.value === "string") {
        try {
          decryptedValue = JSON.parse(session.value);
        } catch {
          decryptedValue = session.value;
        }
      }

      if (!timerSessions[session.measure_id]) {
        timerSessions[session.measure_id] = [];
      }

      timerSessions[session.measure_id].push({
        ...session,
        decryptedValue,
      });

      // Track running timers
      if (decryptedValue?.start && !decryptedValue?.end) {
        runningTimers[session.measure_id] = {
          sessionId: session.id,
          start: decryptedValue.start,
          intervalId: null,
        };
      }
    }
  } catch (err) {
    console.error("Failed to load timer sessions:", err);
  }
}

function renderTimersPanel() {
  if (!el.timersActive) return;

  // Clear existing intervals
  Object.values(runningTimers).forEach((t) => {
    if (t.intervalId) clearInterval(t.intervalId);
  });

  if (timeMeasures.length === 0) {
    el.timersActive.innerHTML = '<p class="timers-empty">No time-based measures set up yet. Go to Measures tab to add one.</p>';
    if (el.timersHistoryList) el.timersHistoryList.innerHTML = "";
    return;
  }

  // Render timer cards
  const cardsHtml = timeMeasures.map((m) => renderTimerCard(m)).join("");
  el.timersActive.innerHTML = cardsHtml;

  // Render recent sessions
  renderTimerHistory();

  // Wire up event handlers
  wireUpTimerHandlers();

  // Start display updates for running timers
  Object.entries(runningTimers).forEach(([measureId, timer]) => {
    startTimerDisplay(parseInt(measureId, 10), timer.start);
  });
}

function renderTimerCard(measure) {
  const running = runningTimers[measure.id];
  const elapsed = running ? getElapsedSeconds(running.start) : 0;

  return `
    <div class="timer-card" data-timer-card="${measure.id}">
      <div class="timer-card-header">
        <span class="timer-card-name">${escapeHtml(measure.name)}</span>
        ${measure.encrypted ? '<span class="timer-card-badge">Encrypted</span>' : ""}
      </div>
      <div class="timer-card-display" data-timer-display="${measure.id}">
        ${formatDuration(elapsed)}
      </div>
      ${running ? `<div class="timer-card-started">Started: ${formatStartTime(running.start)}</div>` : ""}
      <div class="timer-card-actions">
        ${running
          ? `<button class="timer-card-btn stop" data-timer-stop="${measure.id}">Stop</button>`
          : `<button class="timer-card-btn start" data-timer-start="${measure.id}">Start</button>`
        }
      </div>
    </div>
  `;
}

function renderTimerHistory() {
  if (!el.timersHistoryList) return;

  // Collect all completed sessions across measures
  const allSessions = [];
  for (const [measureId, sessions] of Object.entries(timerSessions)) {
    const measure = timeMeasures.find((m) => m.id === parseInt(measureId, 10));
    if (!measure) continue;

    for (const session of sessions) {
      if (session.decryptedValue?.end) {
        allSessions.push({
          ...session,
          measureName: measure.name,
        });
      }
    }
  }

  // Sort by end time descending
  allSessions.sort((a, b) => {
    const aEnd = new Date(a.decryptedValue.end).getTime();
    const bEnd = new Date(b.decryptedValue.end).getTime();
    return bEnd - aEnd;
  });

  if (allSessions.length === 0) {
    el.timersHistoryList.innerHTML = '<p class="timers-history-empty">No completed sessions yet.</p>';
    return;
  }

  const html = allSessions.slice(0, 10).map((s) => `
    <div class="timer-history-item">
      <div class="timer-history-name">${escapeHtml(s.measureName)}</div>
      <div class="timer-history-duration">${formatDuration(s.decryptedValue.duration || 0)}</div>
      <div class="timer-history-time">${formatEndTime(s.decryptedValue.end)}</div>
    </div>
  `).join("");

  el.timersHistoryList.innerHTML = html;
}

function wireUpTimerHandlers() {
  // Start buttons
  el.timersActive?.querySelectorAll("[data-timer-start]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const measureId = parseInt(btn.dataset.timerStart, 10);
      await startTimer(measureId);
    });
  });

  // Stop buttons
  el.timersActive?.querySelectorAll("[data-timer-stop]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const measureId = parseInt(btn.dataset.timerStop, 10);
      await stopTimer(measureId);
    });
  });
}

async function startTimer(measureId) {
  const measure = timeMeasures.find((m) => m.id === measureId);
  if (!measure) return;

  const now = new Date().toISOString();
  const timerData = { start: now };

  try {
    let value = JSON.stringify(timerData);
    if (measure.encrypted) {
      value = await encryptEntry(value);
    }

    const response = await fetch("/tracking/timers/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        measure_id: measureId,
        value,
      }),
    });

    if (!response.ok) throw new Error("Failed to start timer");

    const data = await response.json();

    // Track the running timer
    runningTimers[measureId] = {
      sessionId: data.session?.id,
      start: now,
      intervalId: null,
    };

    // Re-render
    renderTimersPanel();
  } catch (err) {
    console.error("Failed to start timer:", err);
  }
}

async function stopTimer(measureId) {
  const measure = timeMeasures.find((m) => m.id === measureId);
  const running = runningTimers[measureId];
  if (!measure || !running) return;

  const now = new Date();
  const start = new Date(running.start);
  const duration = Math.floor((now.getTime() - start.getTime()) / 1000);

  const timerData = {
    start: running.start,
    end: now.toISOString(),
    duration,
  };

  try {
    let value = JSON.stringify(timerData);
    if (measure.encrypted) {
      value = await encryptEntry(value);
    }

    const response = await fetch("/tracking/timers/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: running.sessionId,
        measure_id: measureId,
        value,
      }),
    });

    if (!response.ok) throw new Error("Failed to stop timer");

    // Clear running timer
    if (running.intervalId) {
      clearInterval(running.intervalId);
    }
    delete runningTimers[measureId];

    // Reload and re-render
    await loadTimerSessions();
    renderTimersPanel();
  } catch (err) {
    console.error("Failed to stop timer:", err);
  }
}

function startTimerDisplay(measureId, startTime) {
  const display = el.timersActive?.querySelector(`[data-timer-display="${measureId}"]`);
  if (!display) return;

  const updateDisplay = () => {
    const elapsed = getElapsedSeconds(startTime);
    display.textContent = formatDuration(elapsed);
  };

  updateDisplay();
  const intervalId = setInterval(updateDisplay, 1000);

  if (runningTimers[measureId]) {
    runningTimers[measureId].intervalId = intervalId;
  }
}

function getElapsedSeconds(startTime) {
  const start = new Date(startTime);
  const now = new Date();
  return Math.floor((now.getTime() - start.getTime()) / 1000);
}

function formatDuration(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatStartTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  if (dateOnly.getTime() === today.getTime()) {
    return `Today ${timeStr}`;
  } else if (dateOnly.getTime() === yesterday.getTime()) {
    return `Yesterday ${timeStr}`;
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + timeStr;
}

function formatEndTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  if (dateOnly.getTime() === today.getTime()) {
    return `Today ${timeStr}`;
  } else if (dateOnly.getTime() === yesterday.getTime()) {
    return `Yesterday ${timeStr}`;
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
