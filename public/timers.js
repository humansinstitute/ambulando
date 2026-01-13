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

  // Listen for SSE timer updates
  window.addEventListener("sse:timers", () => {
    void loadTimersData();
  });

  // Initialize edit modal handlers
  initEditModal();
}

async function loadTimersData() {
  if (!state.session) return;

  await loadTimeMeasures();
  await loadTimerSessions();
  renderTimersPanel();
}

async function loadTimeMeasures() {
  try {
    const response = await fetch("/api/measures");
    if (!response.ok) throw new Error("Failed to fetch measures");

    const data = await response.json();
    const rawMeasures = (data.measures || []).filter((m) => m.type === "time");

    // Decrypt measure names and configs
    timeMeasures = await decryptMeasures(rawMeasures);
  } catch (err) {
    console.error("Failed to load measures:", err);
    timeMeasures = [];
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
        ${measure.encrypted ? '<span class="timer-card-badge" title="Encrypted"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg></span>' : ""}
      </div>
      <div class="timer-card-display" data-timer-display="${measure.id}">
        ${formatDuration(elapsed)}
      </div>
      ${running ? `<div class="timer-card-started">
        Started: ${formatStartTime(running.start)}
        <button class="timer-edit-start-btn" data-edit-running="${measure.id}"
                data-session-id="${running.sessionId}"
                data-start="${running.start}"
                title="Edit start time">Edit</button>
      </div>` : ""}
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
    <div class="timer-history-item" data-session-id="${s.id}">
      <div class="timer-history-main">
        <div class="timer-history-name">${escapeHtml(s.measureName)}</div>
        <div class="timer-history-duration">${formatDuration(s.decryptedValue.duration || 0)}</div>
        <div class="timer-history-time">${formatEndTime(s.decryptedValue.end)}</div>
      </div>
      <div class="timer-history-actions">
        <button class="timer-history-btn edit" data-edit-session="${s.id}"
                data-measure-id="${s.measure_id}"
                data-start="${s.decryptedValue.start}"
                data-end="${s.decryptedValue.end}"
                title="Edit">Edit</button>
        <button class="timer-history-btn delete" data-delete-session="${s.id}"
                data-measure-id="${s.measure_id}"
                title="Delete">Delete</button>
      </div>
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

  // Edit running timer buttons
  el.timersActive?.querySelectorAll("[data-edit-running]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const measureId = parseInt(btn.dataset.editRunning, 10);
      const sessionId = parseInt(btn.dataset.sessionId, 10);
      const start = btn.dataset.start;
      openEditModal(sessionId, measureId, start, null); // null end = running timer
    });
  });

  // Edit buttons (in history)
  el.timersHistoryList?.querySelectorAll("[data-edit-session]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sessionId = parseInt(btn.dataset.editSession, 10);
      const measureId = parseInt(btn.dataset.measureId, 10);
      const start = btn.dataset.start;
      const end = btn.dataset.end;
      openEditModal(sessionId, measureId, start, end);
    });
  });

  // Delete buttons (in history)
  el.timersHistoryList?.querySelectorAll("[data-delete-session]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const sessionId = parseInt(btn.dataset.deleteSession, 10);
      if (confirm("Delete this timer session?")) {
        await deleteSession(sessionId);
      }
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

    // Clear running timer immediately
    if (running.intervalId) {
      clearInterval(running.intervalId);
    }
    delete runningTimers[measureId];

    // Re-render immediately to show stopped state
    renderTimersPanel();

    // Then reload sessions in background for history update
    void loadTimerSessions().then(() => renderTimersPanel());
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

// ============================================================
// Edit/Delete Timer Sessions
// ============================================================

let editingSessionId = null;
let editingMeasureId = null;
let editingIsRunning = false;

function openEditModal(sessionId, measureId, start, end) {
  editingSessionId = sessionId;
  editingMeasureId = measureId;
  editingIsRunning = end === null;

  const modal = document.querySelector("[data-timer-edit-modal]");
  const startInput = document.querySelector("[data-timer-edit-start]");
  const endInput = document.querySelector("[data-timer-edit-end]");
  const endLabel = endInput?.closest("label");

  if (!modal || !startInput || !endInput) return;

  // Convert ISO to datetime-local format
  startInput.value = toDatetimeLocal(start);

  // Show/hide end time based on whether timer is running
  if (editingIsRunning) {
    endInput.value = "";
    if (endLabel) endLabel.style.display = "none";
  } else {
    endInput.value = toDatetimeLocal(end);
    if (endLabel) endLabel.style.display = "";
  }

  modal.removeAttribute("hidden");
}

function closeEditModal() {
  const modal = document.querySelector("[data-timer-edit-modal]");
  if (modal) modal.setAttribute("hidden", "hidden");
  editingSessionId = null;
  editingMeasureId = null;
  editingIsRunning = false;

  // Reset end label visibility
  const endInput = document.querySelector("[data-timer-edit-end]");
  const endLabel = endInput?.closest("label");
  if (endLabel) endLabel.style.display = "";
}

function toDatetimeLocal(isoString) {
  const date = new Date(isoString);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function fromDatetimeLocal(datetimeLocal) {
  return new Date(datetimeLocal).toISOString();
}

async function saveSessionEdit() {
  if (!editingSessionId || !editingMeasureId) return;

  const startInput = document.querySelector("[data-timer-edit-start]");
  const endInput = document.querySelector("[data-timer-edit-end]");

  if (!startInput?.value) {
    alert("Please enter a start time");
    return;
  }

  const start = fromDatetimeLocal(startInput.value);
  const startDate = new Date(start);

  // Validate start time is not in the future
  if (startDate > new Date()) {
    alert("Start time cannot be in the future");
    return;
  }

  let timerData;

  if (editingIsRunning) {
    // Running timer: only update start time
    timerData = { start };
  } else {
    // Completed timer: need end time too
    if (!endInput?.value) {
      alert("Please enter an end time");
      return;
    }

    const end = fromDatetimeLocal(endInput.value);
    const endDate = new Date(end);

    if (endDate <= startDate) {
      alert("End time must be after start time");
      return;
    }

    const duration = Math.floor((endDate.getTime() - startDate.getTime()) / 1000);
    timerData = { start, end, duration };
  }

  const measure = timeMeasures.find((m) => m.id === editingMeasureId);
  if (!measure) return;

  try {
    let value = JSON.stringify(timerData);
    if (measure.encrypted) {
      value = await encryptEntry(value);
    }

    const response = await fetch("/tracking/timers/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: editingSessionId,
        value,
      }),
    });

    if (!response.ok) throw new Error("Failed to update session");

    // If editing a running timer, update local state
    if (editingIsRunning && runningTimers[editingMeasureId]) {
      runningTimers[editingMeasureId].start = start;
    }

    closeEditModal();
    await loadTimerSessions();
    renderTimersPanel();
  } catch (err) {
    console.error("Failed to update session:", err);
    alert("Failed to update session");
  }
}

async function deleteSession(sessionId) {
  try {
    const response = await fetch(`/tracking/${sessionId}`, {
      method: "DELETE",
    });

    if (!response.ok) throw new Error("Failed to delete session");

    await loadTimerSessions();
    renderTimersPanel();
  } catch (err) {
    console.error("Failed to delete session:", err);
    alert("Failed to delete session");
  }
}

// Wire up modal events on init
function initEditModal() {
  const closeBtn = document.querySelector("[data-timer-edit-close]");
  const cancelBtn = document.querySelector("[data-timer-edit-cancel]");
  const saveBtn = document.querySelector("[data-timer-edit-save]");
  const overlay = document.querySelector("[data-timer-edit-modal]");

  closeBtn?.addEventListener("click", closeEditModal);
  cancelBtn?.addEventListener("click", closeEditModal);
  saveBtn?.addEventListener("click", saveSessionEdit);

  // Close on overlay click
  overlay?.addEventListener("click", (e) => {
    if (e.target === overlay) closeEditModal();
  });
}

