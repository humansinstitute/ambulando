// Client-side SSE connection for real-time updates
// Now writes incoming updates to Dexie before dispatching events

import { state } from "./state.js";
import {
  upsertMeasures,
  upsertTrackingDataBulk,
} from "./db.js";

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
 * Now writes to Dexie before dispatching UI events
 */
async function handleSSEEvent(event) {
  console.log("[SSE] Event:", event);

  // Write to Dexie first, then dispatch UI events
  try {
    switch (event.type) {
      case "measures":
        // Upsert measures into Dexie
        if (event.data?.measures) {
          await upsertMeasures(event.data.measures);
        }
        break;

      case "tracking":
        // Upsert tracking data into Dexie
        if (event.data?.tracking) {
          await upsertTrackingDataBulk(
            Array.isArray(event.data.tracking) ? event.data.tracking : [event.data.tracking]
          );
        }
        break;

      case "timers":
        // Timers are a subset of tracking data
        if (event.data?.timer) {
          await upsertTrackingDataBulk([event.data.timer]);
        }
        break;
    }
  } catch (err) {
    console.error("[SSE] Failed to write to Dexie:", err);
  }

  // Dispatch custom events for different data types
  // These trigger Alpine reactivity via liveQuery subscriptions
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
