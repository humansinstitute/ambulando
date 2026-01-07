// Client-side debug logger that sends logs to server immediately

const LOG_ENDPOINT = "/debug/log";

export function debugLog(message, data, source = "Bunker") {
  const entry = {
    source,
    message,
    data,
  };

  // Log to console
  if (data) {
    console.log(`[${source}] ${message}`, data);
  } else {
    console.log(`[${source}] ${message}`);
  }

  // Send immediately (fire and forget)
  const body = JSON.stringify(entry);
  const blob = new Blob([body], { type: "application/json" });

  if (navigator.sendBeacon) {
    navigator.sendBeacon(LOG_ENDPOINT, blob);
  } else {
    fetch(LOG_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }).catch(() => {});
  }
}
