// Sync endpoints for Dexie client synchronization

import {
  getMeasures,
  getTrackingDataByDateRange,
  getRecentEntries,
} from "../db";
import { jsonResponse, unauthorized } from "../http";

import type { Session } from "../types";

/**
 * GET /sync?since={timestamp}
 * Pull changes since the given timestamp
 */
export function handleSyncPull(url: URL, session: Session | null) {
  if (!session) return unauthorized();

  const since = url.searchParams.get("since") || "1970-01-01T00:00:00Z";
  const serverTime = new Date().toISOString();

  // For now, we return all data for the user
  // In a full implementation, we'd filter by updated_at > since
  const measures = getMeasures(session.npub);

  // Get tracking data for the last 90 days
  const today = new Date();
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const trackingData = getTrackingDataByDateRange(
    session.npub,
    ninetyDaysAgo.toISOString(),
    today.toISOString()
  );

  // Get recent entries
  const entries = getRecentEntries(session.npub, today.toISOString().slice(0, 10), 100);

  return jsonResponse({
    measures,
    trackingData,
    entries,
    serverTime,
    since,
  });
}

/**
 * POST /sync
 * Push local changes to server
 * Body: { measures?: [], trackingData?: [], entries?: [] }
 */
export async function handleSyncPush(req: Request, session: Session | null) {
  if (!session) return unauthorized();

  const body = await req.json() as {
    measures?: Array<{ id?: number; name: string; type: string; encrypted: boolean; sort_order: number; config?: string | null }>;
    trackingData?: Array<{ id?: number; measure_id: number; recorded_at: string; value: string }>;
    entries?: Array<{ id?: number; entry_date: string; slot: number; encrypted_content: string }>;
  };

  const results = {
    measures: [] as number[],
    trackingData: [] as number[],
    entries: [] as number[],
  };

  // Process measures
  if (body.measures?.length) {
    // Import dynamically to avoid circular deps
    const { createMeasure, updateMeasure } = await import("../db");
    for (const m of body.measures) {
      try {
        if (m.id && m.id > 0) {
          // Update existing
          updateMeasure(
            m.id,
            session.npub,
            m.name,
            m.type as "number" | "text" | "goodbad" | "time" | "options" | "rating",
            m.encrypted,
            m.sort_order,
            m.config || null
          );
          results.measures.push(m.id);
        } else {
          // Create new
          const created = createMeasure(
            session.npub,
            m.name,
            m.type as "number" | "text" | "goodbad" | "time" | "options" | "rating",
            m.encrypted,
            m.sort_order,
            m.config || null
          );
          if (created) results.measures.push(created.id);
        }
      } catch (err) {
        console.error("[sync] Failed to process measure:", err);
      }
    }
  }

  // Process tracking data
  if (body.trackingData?.length) {
    const { saveTrackingData, updateTrackingData } = await import("../db");
    for (const td of body.trackingData) {
      try {
        if (td.id && td.id > 0 && !String(td.id).startsWith("local_")) {
          // Update existing
          updateTrackingData(td.id, session.npub, td.value);
          results.trackingData.push(td.id);
        } else {
          // Create new
          const created = saveTrackingData(
            session.npub,
            td.measure_id,
            td.recorded_at,
            td.value
          );
          if (created) results.trackingData.push(created.id);
        }
      } catch (err) {
        console.error("[sync] Failed to process tracking data:", err);
      }
    }
  }

  // Process entries
  if (body.entries?.length) {
    const { upsertEntry } = await import("../db");
    for (const e of body.entries) {
      try {
        const entry = upsertEntry(
          session.npub,
          e.entry_date,
          e.slot,
          e.encrypted_content
        );
        if (entry) results.entries.push(entry.id);
      } catch (err) {
        console.error("[sync] Failed to process entry:", err);
      }
    }
  }

  return jsonResponse({
    success: true,
    results,
    serverTime: new Date().toISOString(),
  });
}
