// Client-side debug logger that sends logs to server for file storage

const LOG_ENDPOINT = "/debug/log";
const LOG_QUEUE = [];
let flushTimer = null;

export function debugLog(message, data) {
  const entry = {
    source: "Bunker",
    message,
    data,
    timestamp: new Date().toISOString(),
  };

  // Also log to console
  if (data) {
    console.log(`[Bunker] ${message}`, data);
  } else {
    console.log(`[Bunker] ${message}`);
  }

  // Queue for server
  LOG_QUEUE.push(entry);

  // Debounce flush
  if (!flushTimer) {
    flushTimer = setTimeout(flushLogs, 100);
  }
}

async function flushLogs() {
  flushTimer = null;
  if (LOG_QUEUE.length === 0) return;

  const entries = LOG_QUEUE.splice(0, LOG_QUEUE.length);
  for (const entry of entries) {
    try {
      await fetch(LOG_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
    } catch (err) {
      console.error("Failed to send debug log:", err);
    }
  }
}

// Flush on page unload
window.addEventListener("beforeunload", () => {
  if (LOG_QUEUE.length > 0) {
    for (const entry of LOG_QUEUE) {
      navigator.sendBeacon(LOG_ENDPOINT, JSON.stringify(entry));
    }
  }
});
