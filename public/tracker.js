// Track panel for Daily Tracker

import { elements as el, show, hide, setText } from "./dom.js";
import { encryptEntry, decryptEntry } from "./entryCrypto.js";
import { state } from "./state.js";

let measures = [];
let trackingData = {}; // Map of measureId -> tracking record
let currentDate = new Date();
let timerIntervals = {}; // Map of measureId -> interval ID
let activeTimerInterval = null; // Interval for banner timer
let activeTimerData = null; // Currently active timer from server

export async function initTracker() {
  if (!state.session) return;

  // Wire up date navigation
  el.prevDayBtn?.addEventListener("click", () => navigateDate(-1));
  el.nextDayBtn?.addEventListener("click", () => navigateDate(1));

  // Wire up active timer banner "View" button
  el.activeTimerGoto?.addEventListener("click", handleActiveTimerGoto);

  // Listen for tab switches
  window.addEventListener("tab-switched", (e) => {
    if (e.detail.tab === "track") {
      void loadTrackingData();
      void loadActiveTimer();
    }
  });

  // Listen for measures changes
  window.addEventListener("measures-changed", () => {
    void loadMeasuresAndRender();
  });

  // Initial load
  await loadMeasuresAndRender();
  await loadActiveTimer();
}

async function loadMeasuresAndRender() {
  await loadMeasures();
  await loadTrackingData();
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

async function loadTrackingData() {
  if (!state.session) return;

  updateDateDisplay();

  const dateStr = getLocalDateString(currentDate);
  trackingData = {};

  try {
    const response = await fetch(`/tracking?date=${dateStr}`);
    if (!response.ok) throw new Error("Failed to fetch tracking data");

    const data = await response.json();

    // Decrypt and organize by measure_id
    for (const record of data.data || []) {
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

      trackingData[record.measure_id] = {
        ...record,
        decryptedValue: value,
      };
    }

    renderTrackList();
  } catch (err) {
    console.error("Failed to load tracking data:", err);
    renderTrackList();
  }
}

function renderTrackList() {
  if (!el.trackList) return;

  // Clear existing timer intervals
  Object.values(timerIntervals).forEach(clearInterval);
  timerIntervals = {};

  // Filter out time-type measures (those go to Timers tab)
  const dailyMeasures = measures.filter((m) => m.type !== "time");

  if (dailyMeasures.length === 0) {
    el.trackList.innerHTML = '<p class="track-empty">No daily measures set up yet. Go to Measures tab to add some.</p>';
    return;
  }

  const html = dailyMeasures.map((m) => renderMeasureCard(m)).join("");
  el.trackList.innerHTML = html;

  // Wire up event handlers
  wireUpInputHandlers();
}

function renderMeasureCard(measure) {
  const data = trackingData[measure.id];
  const value = data?.decryptedValue;

  return `
    <div class="measure-card" data-measure-card="${measure.id}">
      <div class="measure-card-header">
        <span class="measure-card-name">${escapeHtml(measure.name)}</span>
        ${measure.encrypted ? '<span class="measure-card-badge" title="Encrypted"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg></span>' : ""}
      </div>
      ${renderMeasureInput(measure, value, data)}
    </div>
  `;
}

function renderMeasureInput(measure, value, data) {
  switch (measure.type) {
    case "number":
      return renderNumberInput(measure, value);
    case "text":
      return renderTextInput(measure, value);
    case "goodbad":
      return renderGoodBadInput(measure, value);
    case "options":
      return renderOptionsInput(measure, value);
    case "rating":
      return renderRatingInput(measure, value);
    case "time":
      return renderTimeInput(measure, value, data);
    default:
      return '<p class="muted">Unknown type</p>';
  }
}

function renderNumberInput(measure, value) {
  const numValue = value ?? "";
  return `
    <div class="number-input-wrapper">
      <button class="number-btn" data-number-dec="${measure.id}">-</button>
      <input type="number" class="number-input"
             data-number-input="${measure.id}"
             value="${numValue}"
             step="any"
             placeholder="0" />
      <button class="number-btn" data-number-inc="${measure.id}">+</button>
    </div>
  `;
}

function renderTextInput(measure, value) {
  const textValue = value ?? "";
  return `
    <div class="text-input-wrapper">
      <textarea data-text-input="${measure.id}"
                placeholder="Add notes..."
                rows="3">${escapeHtml(textValue)}</textarea>
    </div>
  `;
}

function renderGoodBadInput(measure, value) {
  const isGood = value === "good" || value === 1 || value === "1";
  const isBad = value === "bad" || value === -1 || value === "-1";
  return `
    <div class="goodbad-toggle">
      <button class="goodbad-btn good ${isGood ? "selected" : ""}"
              data-goodbad="${measure.id}" data-value="good">+</button>
      <button class="goodbad-btn bad ${isBad ? "selected" : ""}"
              data-goodbad="${measure.id}" data-value="bad">-</button>
    </div>
  `;
}

function renderOptionsInput(measure, value) {
  let options = [];
  try {
    options = measure.config ? JSON.parse(measure.config) : [];
  } catch (_err) {
    options = [];
  }

  if (options.length === 0) {
    return '<p class="muted">No options configured</p>';
  }

  const buttons = options.map((opt) => {
    const isSelected = value === opt;
    return `<button class="option-btn ${isSelected ? "selected" : ""}"
                    data-option="${measure.id}" data-value="${escapeHtml(opt)}">${escapeHtml(opt)}</button>`;
  }).join("");

  return `<div class="options-toggle" data-count="${options.length}">${buttons}</div>`;
}

function renderRatingInput(measure, value) {
  const currentRating = parseInt(value, 10) || 0;
  const buttons = [];

  for (let i = 1; i <= 10; i++) {
    const isSelected = i === currentRating;
    const isFilled = i <= currentRating;
    buttons.push(`<button class="rating-btn ${isSelected ? "selected" : ""} ${isFilled ? "filled" : ""}"
                          data-rating="${measure.id}" data-value="${i}">${i}</button>`);
  }

  return `<div class="rating-scale">${buttons.join("")}</div>`;
}

function renderTimeInput(measure, value, data) {
  // Value is an object: { start?: string, end?: string, duration?: number }
  const timerData = typeof value === "object" ? value : {};
  const isRunning = timerData.start && !timerData.end;
  const elapsed = isRunning ? getElapsedSeconds(timerData.start) : (timerData.duration || 0);

  // Format start time for display
  const startTimeDisplay = timerData.start ? formatStartTime(timerData.start) : "";

  return `
    <div class="time-tracker" data-timer="${measure.id}">
      <div class="timer-display-wrapper">
        <div class="timer-display ${isRunning ? "running" : ""}" data-timer-display="${measure.id}">
          ${formatDuration(elapsed)}
        </div>
        ${isRunning ? `<button class="timer-edit-btn" data-timer-edit="${measure.id}" title="Edit start time">⚙</button>` : ""}
      </div>
      ${isRunning ? `<div class="timer-start-info" data-timer-start-info="${measure.id}">Started: ${startTimeDisplay}</div>` : ""}
      <div class="timer-edit-form" data-timer-edit-form="${measure.id}" hidden>
        <label>
          <span>Backdate start time:</span>
          <input type="datetime-local" data-timer-datetime="${measure.id}" />
        </label>
        <div class="timer-edit-actions">
          <button type="button" class="timer-edit-save" data-timer-save="${measure.id}">Save</button>
          <button type="button" class="timer-edit-cancel" data-timer-cancel="${measure.id}">Cancel</button>
        </div>
      </div>
      <div class="timer-actions">
        ${
          isRunning
            ? `<button class="timer-btn stop" data-timer-stop="${measure.id}">Stop</button>`
            : `<button class="timer-btn start" data-timer-start="${measure.id}">Start</button>`
        }
      </div>
    </div>
  `;
}

function formatStartTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  if (date.toDateString() === now.toDateString()) {
    return `Today ${timeStr}`;
  } else if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday ${timeStr}`;
  } else {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + timeStr;
  }
}

function wireUpInputHandlers() {
  // Number inputs
  el.trackList?.querySelectorAll("[data-number-input]").forEach((input) => {
    const measureId = parseInt(input.dataset.numberInput, 10);
    let debounceTimer;

    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void saveTrackingValue(measureId, input.value);
      }, 500);
    });

    input.addEventListener("blur", () => {
      clearTimeout(debounceTimer);
      void saveTrackingValue(measureId, input.value);
    });
  });

  el.trackList?.querySelectorAll("[data-number-dec]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const measureId = parseInt(btn.dataset.numberDec, 10);
      const input = el.trackList?.querySelector(`[data-number-input="${measureId}"]`);
      if (input) {
        const current = parseFloat(input.value) || 0;
        input.value = current - 1;
        void saveTrackingValue(measureId, input.value);
      }
    });
  });

  el.trackList?.querySelectorAll("[data-number-inc]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const measureId = parseInt(btn.dataset.numberInc, 10);
      const input = el.trackList?.querySelector(`[data-number-input="${measureId}"]`);
      if (input) {
        const current = parseFloat(input.value) || 0;
        input.value = current + 1;
        void saveTrackingValue(measureId, input.value);
      }
    });
  });

  // Text inputs
  el.trackList?.querySelectorAll("[data-text-input]").forEach((textarea) => {
    const measureId = parseInt(textarea.dataset.textInput, 10);
    let debounceTimer;

    textarea.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void saveTrackingValue(measureId, textarea.value);
      }, 1000);
    });

    textarea.addEventListener("blur", () => {
      clearTimeout(debounceTimer);
      void saveTrackingValue(measureId, textarea.value);
    });
  });

  // Good/Bad buttons
  el.trackList?.querySelectorAll("[data-goodbad]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const measureId = parseInt(btn.dataset.goodbad, 10);
      const value = btn.dataset.value;

      // Toggle: if already selected, deselect
      const currentData = trackingData[measureId];
      const currentValue = currentData?.decryptedValue;
      const newValue = currentValue === value ? null : value;

      void saveTrackingValue(measureId, newValue);

      // Update UI immediately
      const container = btn.closest(".goodbad-toggle");
      container?.querySelectorAll(".goodbad-btn").forEach((b) => {
        b.classList.toggle("selected", b.dataset.value === newValue);
      });
    });
  });

  // Options buttons
  el.trackList?.querySelectorAll("[data-option]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const measureId = parseInt(btn.dataset.option, 10);
      const value = btn.dataset.value;

      // Toggle: if already selected, deselect
      const currentData = trackingData[measureId];
      const currentValue = currentData?.decryptedValue;
      const newValue = currentValue === value ? null : value;

      void saveTrackingValue(measureId, newValue);

      // Update UI immediately
      const container = btn.closest(".options-toggle");
      container?.querySelectorAll(".option-btn").forEach((b) => {
        b.classList.toggle("selected", b.dataset.value === newValue);
      });
    });
  });

  // Rating buttons
  el.trackList?.querySelectorAll("[data-rating]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const measureId = parseInt(btn.dataset.rating, 10);
      const value = parseInt(btn.dataset.value, 10);

      // Toggle: if already selected, deselect
      const currentData = trackingData[measureId];
      const currentValue = parseInt(currentData?.decryptedValue, 10) || 0;
      const newValue = currentValue === value ? null : value;

      void saveTrackingValue(measureId, newValue);

      // Update UI immediately
      const container = btn.closest(".rating-scale");
      container?.querySelectorAll(".rating-btn").forEach((b) => {
        const btnValue = parseInt(b.dataset.value, 10);
        b.classList.toggle("selected", btnValue === newValue);
        b.classList.toggle("filled", newValue && btnValue <= newValue);
      });
    });
  });

  // Timer start buttons
  el.trackList?.querySelectorAll("[data-timer-start]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const measureId = parseInt(btn.dataset.timerStart, 10);
      void startTimer(measureId);
    });
  });

  // Timer stop buttons
  el.trackList?.querySelectorAll("[data-timer-stop]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const measureId = parseInt(btn.dataset.timerStop, 10);
      void stopTimer(measureId);
    });
  });

  // Timer edit buttons (cog)
  el.trackList?.querySelectorAll("[data-timer-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const measureId = parseInt(btn.dataset.timerEdit, 10);
      const form = el.trackList?.querySelector(`[data-timer-edit-form="${measureId}"]`);
      const input = el.trackList?.querySelector(`[data-timer-datetime="${measureId}"]`);
      const data = trackingData[measureId];
      const startTime = data?.decryptedValue?.start;

      if (form && input && startTime) {
        // Set the datetime-local input to current start time
        const date = new Date(startTime);
        const localDateTime = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16);
        input.value = localDateTime;
        form.hidden = false;
      }
    });
  });

  // Timer edit save buttons
  el.trackList?.querySelectorAll("[data-timer-save]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const measureId = parseInt(btn.dataset.timerSave, 10);
      void saveBackdatedStart(measureId);
    });
  });

  // Timer edit cancel buttons
  el.trackList?.querySelectorAll("[data-timer-cancel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const measureId = parseInt(btn.dataset.timerCancel, 10);
      const form = el.trackList?.querySelector(`[data-timer-edit-form="${measureId}"]`);
      if (form) form.hidden = true;
    });
  });

  // Start timer display updates for running timers
  measures.forEach((m) => {
    if (m.type === "time") {
      const data = trackingData[m.id];
      const value = data?.decryptedValue;
      if (typeof value === "object" && value.start && !value.end) {
        startTimerDisplay(m.id, value.start);
      }
    }
  });
}

async function saveTrackingValue(measureId, value) {
  if (!state.session) return;

  const measure = measures.find((m) => m.id === measureId);
  if (!measure) return;

  // Skip empty values
  if (value === "" || value === null || value === undefined) {
    return;
  }

  // Convert value to string for storage
  let valueStr = typeof value === "object" ? JSON.stringify(value) : String(value);

  // Encrypt if needed
  if (measure.encrypted) {
    try {
      valueStr = await encryptEntry(valueStr);
    } catch (err) {
      console.error("Failed to encrypt:", err);
      return;
    }
  }

  const existingRecord = trackingData[measureId];
  const dateStr = getLocalDateString(currentDate);

  try {
    const response = await fetch("/tracking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: existingRecord?.id,
        measure_id: measureId,
        recorded_at: existingRecord?.recorded_at || new Date(dateStr + "T12:00:00").toISOString(),
        value: valueStr,
      }),
    });

    if (!response.ok) throw new Error("Failed to save tracking data");

    const data = await response.json();

    // Update local state
    trackingData[measureId] = {
      ...data.data,
      decryptedValue: value,
    };
  } catch (err) {
    console.error("Failed to save tracking data:", err);
  }
}

async function startTimer(measureId) {
  const now = new Date().toISOString();
  const timerData = { start: now };
  await saveTrackingValue(measureId, timerData);

  // Update local state and UI
  trackingData[measureId] = {
    ...trackingData[measureId],
    decryptedValue: timerData,
  };

  // Re-render just this card
  const card = el.trackList?.querySelector(`[data-measure-card="${measureId}"]`);
  if (card) {
    const measure = measures.find((m) => m.id === measureId);
    if (measure) {
      card.outerHTML = renderMeasureCard(measure);
      wireUpInputHandlers();
    }
  }

  // Refresh active timer banner
  await loadActiveTimer();
}

async function stopTimer(measureId) {
  const data = trackingData[measureId];
  const value = data?.decryptedValue;

  if (!value?.start) return;

  const now = new Date();
  const start = new Date(value.start);
  const duration = Math.floor((now.getTime() - start.getTime()) / 1000);

  const timerData = {
    start: value.start,
    end: now.toISOString(),
    duration,
  };

  await saveTrackingValue(measureId, timerData);

  // Stop the display update interval
  if (timerIntervals[measureId]) {
    clearInterval(timerIntervals[measureId]);
    delete timerIntervals[measureId];
  }

  // Update local state and UI
  trackingData[measureId] = {
    ...trackingData[measureId],
    decryptedValue: timerData,
  };

  // Re-render just this card
  const card = el.trackList?.querySelector(`[data-measure-card="${measureId}"]`);
  if (card) {
    const measure = measures.find((m) => m.id === measureId);
    if (measure) {
      card.outerHTML = renderMeasureCard(measure);
      wireUpInputHandlers();
    }
  }

  // Refresh active timer banner (will hide it since timer is stopped)
  await loadActiveTimer();
}

async function saveBackdatedStart(measureId) {
  const input = el.trackList?.querySelector(`[data-timer-datetime="${measureId}"]`);
  if (!input?.value) return;

  const newStart = new Date(input.value).toISOString();
  const timerData = { start: newStart };

  await saveTrackingValue(measureId, timerData);

  // Update local state
  trackingData[measureId] = {
    ...trackingData[measureId],
    decryptedValue: timerData,
  };

  // Re-render just this card
  const card = el.trackList?.querySelector(`[data-measure-card="${measureId}"]`);
  if (card) {
    const measure = measures.find((m) => m.id === measureId);
    if (measure) {
      card.outerHTML = renderMeasureCard(measure);
      wireUpInputHandlers();
    }
  }
}

function startTimerDisplay(measureId, startTime) {
  // Clear any existing interval
  if (timerIntervals[measureId]) {
    clearInterval(timerIntervals[measureId]);
  }

  const display = el.trackList?.querySelector(`[data-timer-display="${measureId}"]`);
  if (!display) return;

  timerIntervals[measureId] = setInterval(() => {
    const elapsed = getElapsedSeconds(startTime);
    display.textContent = formatDuration(elapsed);
  }, 1000);
}

function getElapsedSeconds(startTime) {
  const start = new Date(startTime);
  const now = new Date();
  return Math.floor((now.getTime() - start.getTime()) / 1000);
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function navigateDate(delta) {
  currentDate = new Date(currentDate);
  currentDate.setDate(currentDate.getDate() + delta);
  void loadTrackingData();
}

function updateDateDisplay() {
  const today = new Date();
  const todayStr = getLocalDateString(today);
  const currentStr = getLocalDateString(currentDate);

  if (todayStr === currentStr) {
    setText(el.trackDate, "Today");
  } else {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getLocalDateString(yesterday);

    if (currentStr === yesterdayStr) {
      setText(el.trackDate, "Yesterday");
    } else {
      const options = { weekday: "short", month: "short", day: "numeric" };
      setText(el.trackDate, currentDate.toLocaleDateString("en-US", options));
    }
  }
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
// Active Timer Banner
// ============================================================

async function loadActiveTimer() {
  if (!state.session) return;

  try {
    const response = await fetch("/tracking/timer");
    if (!response.ok) throw new Error("Failed to fetch active timer");

    const data = await response.json();
    activeTimerData = data.timer;

    if (activeTimerData) {
      // Decrypt the value if the measure is encrypted
      const measure = measures.find((m) => m.id === activeTimerData.measure_id);
      if (measure?.encrypted && activeTimerData.value) {
        try {
          const decrypted = await decryptEntry(activeTimerData.value);
          activeTimerData.decryptedValue = JSON.parse(decrypted);
        } catch (err) {
          console.error("Failed to decrypt active timer:", err);
          activeTimerData = null;
        }
      } else {
        try {
          activeTimerData.decryptedValue = JSON.parse(activeTimerData.value);
        } catch (_err) {
          activeTimerData.decryptedValue = activeTimerData.value;
        }
      }
      activeTimerData.measureName = measure?.name || "Timer";
    }

    updateActiveTimerBanner();
  } catch (err) {
    console.error("Failed to load active timer:", err);
    activeTimerData = null;
    updateActiveTimerBanner();
  }
}

function updateActiveTimerBanner() {
  if (!activeTimerData?.decryptedValue?.start) {
    hide(el.activeTimerBanner);
    if (activeTimerInterval) {
      clearInterval(activeTimerInterval);
      activeTimerInterval = null;
    }
    return;
  }

  // Show banner
  show(el.activeTimerBanner);
  setText(el.activeTimerName, activeTimerData.measureName);

  // Update duration display
  const updateDuration = () => {
    const elapsed = getElapsedSeconds(activeTimerData.decryptedValue.start);
    setText(el.activeTimerDuration, formatDuration(elapsed));
  };

  updateDuration();

  // Start interval to update duration
  if (activeTimerInterval) {
    clearInterval(activeTimerInterval);
  }
  activeTimerInterval = setInterval(updateDuration, 1000);
}

function handleActiveTimerGoto() {
  if (!activeTimerData?.decryptedValue?.start) return;

  // Navigate to the date when the timer was started
  const startDate = new Date(activeTimerData.decryptedValue.start);
  currentDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  void loadTrackingData();
}
