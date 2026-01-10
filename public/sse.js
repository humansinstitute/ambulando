// Client-side SSE connection for real-time updates

import { state } from "./state.js";

let eventSource = null;
let reconnectTimeout = null;
let reconnectDelay = 1000; // Start with 1 second

/**
 * Connect to SSE endpoint for real-time updates
 */
export function connectSSE() {
  // Don't connect if not logged in
  if (!state.session) {
    return;
  }

  // Don't reconnect if already connected
  if (eventSource && eventSource.readyState !== EventSource.CLOSED) {
    return;
  }

  eventSource = new EventSource("/events");

  eventSource.onopen = () => {
    console.log("[SSE] Connected");
    reconnectDelay = 1000; // Reset delay on successful connection
  };

  eventSource.onmessage = (event) => {
    // Handle data events
    if (event.data) {
      try {
        const data = JSON.parse(event.data);
        handleSSEEvent(data);
      } catch (_err) {
        // Ignore parse errors (could be comments/pings)
      }
    }
  };

  eventSource.onerror = () => {
    console.log("[SSE] Connection error, will reconnect...");
    eventSource?.close();
    eventSource = null;

    // Reconnect with exponential backoff
    if (state.session) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = setTimeout(() => {
        connectSSE();
        reconnectDelay = Math.min(reconnectDelay * 2, 30000); // Max 30 seconds
      }, reconnectDelay);
    }
  };
}

/**
 * Disconnect from SSE
 */
export function disconnectSSE() {
  clearTimeout(reconnectTimeout);
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

/**
 * Handle incoming SSE events
 */
function handleSSEEvent(event) {
  console.log("[SSE] Event:", event);

  // Dispatch custom events for different data types
  switch (event.type) {
    case "measures":
      window.dispatchEvent(new CustomEvent("sse:measures", { detail: event }));
      break;
    case "tracking":
      window.dispatchEvent(new CustomEvent("sse:tracking", { detail: event }));
      break;
    case "timers":
      window.dispatchEvent(new CustomEvent("sse:timers", { detail: event }));
      break;
  }
}

/**
 * Check if SSE is connected
 */
export function isConnected() {
  return eventSource && eventSource.readyState === EventSource.OPEN;
}
