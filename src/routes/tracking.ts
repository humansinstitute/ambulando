import {
  getMeasures,
  getMeasureById,
  upsertMeasure,
  updateMeasure,
  deleteMeasure,
  getTrackingData,
  getTrackingDataForDate,
  getTrackingDataByDateRange,
  saveTrackingData,
  updateTrackingData,
  deleteTrackingData,
  getActiveTimer,
  getTimerSessions,
} from "../db";
import { jsonResponse, safeJson, unauthorized } from "../http";

import type { MeasureType } from "../db";
import type { Session } from "../types";

// ============================================================
// Measure endpoints
// ============================================================

export function handleGetMeasures(session: Session | null) {
  if (!session) return unauthorized();
  const measures = getMeasures(session.npub);
  return jsonResponse({ measures });
}

export async function handleSaveMeasure(req: Request, session: Session | null) {
  if (!session) return unauthorized();

  const body = await safeJson(req);
  if (!body) {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { id, name, type, encrypted, sort_order, config } = body;

  if (!name || typeof name !== "string") {
    return jsonResponse({ error: "name required" }, 400);
  }

  const validTypes: MeasureType[] = ["number", "text", "goodbad", "time", "options", "rating"];
  if (!type || !validTypes.includes(type)) {
    return jsonResponse({ error: "type must be one of: number, text, goodbad, time, options, rating" }, 400);
  }

  // Validate options config
  if (type === "options") {
    if (!config || !Array.isArray(config) || config.length < 2 || config.length > 5) {
      return jsonResponse({ error: "options type requires 2-5 options in config array" }, 400);
    }
  }

  const isEncrypted = encrypted !== false; // default true
  const sortOrder = typeof sort_order === "number" ? sort_order : 0;
  const configJson = config ? JSON.stringify(config) : null;

  let measure;
  if (id) {
    // Update existing
    measure = updateMeasure(id, session.npub, name, type, isEncrypted, sortOrder, configJson);
  } else {
    // Create new
    measure = upsertMeasure(session.npub, name, type, isEncrypted, sortOrder, configJson);
  }

  if (!measure) {
    return jsonResponse({ error: "Failed to save measure" }, 500);
  }

  return jsonResponse({ measure });
}

export function handleDeleteMeasure(session: Session | null, id: number) {
  if (!session) return unauthorized();

  const existing = getMeasureById(id, session.npub);
  if (!existing) {
    return jsonResponse({ error: "Measure not found" }, 404);
  }

  deleteMeasure(id, session.npub);
  return jsonResponse({ success: true });
}

// ============================================================
// Tracking data endpoints
// ============================================================

export function handleGetTracking(url: URL, session: Session | null) {
  if (!session) return unauthorized();

  const date = url.searchParams.get("date");
  const startDate = url.searchParams.get("start");
  const endDate = url.searchParams.get("end");
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 500) : 100;

  let data;
  if (date) {
    // Get data for specific date
    data = getTrackingDataForDate(session.npub, date);
  } else if (startDate && endDate) {
    // Get data for date range
    data = getTrackingDataByDateRange(session.npub, startDate, endDate);
  } else {
    // Get recent data
    data = getTrackingData(session.npub, limit);
  }

  return jsonResponse({ data });
}

export async function handleSaveTracking(req: Request, session: Session | null) {
  if (!session) return unauthorized();

  const body = await safeJson(req);
  if (!body) {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { id, measure_id, recorded_at, value } = body;

  // Update existing record
  if (id) {
    if (value === undefined) {
      return jsonResponse({ error: "value required for update" }, 400);
    }
    const data = updateTrackingData(id, session.npub, value);
    if (!data) {
      return jsonResponse({ error: "Failed to update tracking data" }, 500);
    }
    return jsonResponse({ data });
  }

  // Create new record
  if (!measure_id || typeof measure_id !== "number") {
    return jsonResponse({ error: "measure_id required" }, 400);
  }

  if (!recorded_at || typeof recorded_at !== "string") {
    return jsonResponse({ error: "recorded_at required (ISO datetime)" }, 400);
  }

  if (value === undefined) {
    return jsonResponse({ error: "value required" }, 400);
  }

  // Verify measure exists and belongs to user
  const measure = getMeasureById(measure_id, session.npub);
  if (!measure) {
    return jsonResponse({ error: "Measure not found" }, 404);
  }

  const data = saveTrackingData(session.npub, measure_id, recorded_at, value);
  if (!data) {
    return jsonResponse({ error: "Failed to save tracking data" }, 500);
  }

  return jsonResponse({ data });
}

export function handleDeleteTracking(session: Session | null, id: number) {
  if (!session) return unauthorized();
  deleteTrackingData(id, session.npub);
  return jsonResponse({ success: true });
}

export function handleGetActiveTimer(session: Session | null) {
  if (!session) return unauthorized();
  const timer = getActiveTimer(session.npub);
  return jsonResponse({ timer });
}

// ============================================================
// Timer session endpoints (for Timers tab)
// ============================================================

export function handleGetTimerSessions(url: URL, session: Session | null) {
  if (!session) return unauthorized();

  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 100) : 20;

  const sessions = getTimerSessions(session.npub, limit);
  return jsonResponse({ sessions });
}

export async function handleStartTimer(req: Request, session: Session | null) {
  if (!session) return unauthorized();

  const body = await safeJson(req);
  if (!body) {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { measure_id, value } = body;

  if (!measure_id || typeof measure_id !== "number") {
    return jsonResponse({ error: "measure_id required" }, 400);
  }

  if (value === undefined) {
    return jsonResponse({ error: "value required" }, 400);
  }

  // Verify measure exists and is time type
  const measure = getMeasureById(measure_id, session.npub);
  if (!measure) {
    return jsonResponse({ error: "Measure not found" }, 404);
  }
  if (measure.type !== "time") {
    return jsonResponse({ error: "Measure must be time type" }, 400);
  }

  // Create a new timer session record
  const now = new Date().toISOString();
  const data = saveTrackingData(session.npub, measure_id, now, value);

  if (!data) {
    return jsonResponse({ error: "Failed to start timer" }, 500);
  }

  return jsonResponse({ session: data });
}

export async function handleStopTimer(req: Request, session: Session | null) {
  if (!session) return unauthorized();

  const body = await safeJson(req);
  if (!body) {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { session_id, value } = body;

  if (!session_id || typeof session_id !== "number") {
    return jsonResponse({ error: "session_id required" }, 400);
  }

  if (value === undefined) {
    return jsonResponse({ error: "value required" }, 400);
  }

  // Update the timer session with end time
  const data = updateTrackingData(session_id, session.npub, value);

  if (!data) {
    return jsonResponse({ error: "Failed to stop timer" }, 500);
  }

  return jsonResponse({ session: data });
}
