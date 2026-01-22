// Dexie database for client-side IndexedDB storage
// All client state lives here; UI reads from Dexie via liveQuery

let db = null;
let Dexie = null;
let liveQuery = null;

/**
 * Load Dexie library from CDN
 */
export async function loadDexie() {
  if (!Dexie) {
    const mod = await import("https://esm.sh/dexie@4.0.11");
    Dexie = mod.Dexie;
    liveQuery = mod.liveQuery;
  }
  return { Dexie, liveQuery };
}

/**
 * Initialize the Dexie database with schema
 */
export async function initDB() {
  if (db) return db;

  await loadDexie();

  db = new Dexie("ambulando");

  // Schema version 1
  db.version(1).stores({
    // Measures (metric definitions)
    measures: "id, owner, type, sort_order, syncedAt",

    // Tracking data (recorded values)
    trackingData: "id, owner, measure_id, recorded_at, [owner+recorded_at], syncedAt",

    // Journal entries
    entries: "id, owner, entry_date, slot, [owner+entry_date], syncedAt",

    // Timer sessions (subset of tracking data for quick timer lookup)
    timerSessions: "id, owner, measure_id, recorded_at, syncedAt",

    // Secrets (encrypted keys/tokens stored in IndexedDB)
    secrets: "id",

    // Sync metadata
    syncMeta: "key",

    // Pending mutations (offline queue)
    pendingMutations: "++id, table, operation, createdAt",

    // Cached profiles
    profiles: "npub, updatedAt",
  });

  return db;
}

/**
 * Get the database instance
 */
export function getDB() {
  if (!db) {
    throw new Error("Database not initialized. Call initDB() first.");
  }
  return db;
}

/**
 * Get liveQuery for reactive queries
 */
export function getLiveQuery() {
  if (!liveQuery) {
    throw new Error("Dexie not loaded. Call initDB() first.");
  }
  return liveQuery;
}

// ============================================================
// Measures
// ============================================================

export async function getMeasures(owner) {
  const db = getDB();
  return db.measures.where("owner").equals(owner).sortBy("sort_order");
}

export async function getMeasureById(id) {
  const db = getDB();
  return db.measures.get(id);
}

export async function upsertMeasure(measure) {
  const db = getDB();
  const now = new Date().toISOString();

  // Check if exists (only if id is provided and not a local id)
  if (measure.id != null) {
    const existing = await db.measures.get(measure.id);
    if (existing) {
      await db.measures.update(measure.id, { ...measure, syncedAt: now });
      return db.measures.get(measure.id);
    }
  }

  // For new records without server ID, use a temporary local ID
  const localId = measure.id || `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  await db.measures.put({ ...measure, id: localId, syncedAt: now });
  return db.measures.get(localId);
}

export async function upsertMeasures(measures) {
  const db = getDB();
  const now = new Date().toISOString();

  await db.measures.bulkPut(
    measures.map((m) => ({ ...m, syncedAt: now }))
  );
}

export async function deleteMeasure(id) {
  const db = getDB();
  await db.measures.delete(id);
  // Also delete associated tracking data
  await db.trackingData.where("measure_id").equals(id).delete();
}

// ============================================================
// Tracking Data
// ============================================================

export async function getTrackingDataForDate(owner, date) {
  const db = getDB();
  // date is YYYY-MM-DD string
  const startOfDay = `${date}T00:00:00`;
  const endOfDay = `${date}T23:59:59`;

  return db.trackingData
    .where("[owner+recorded_at]")
    .between([owner, startOfDay], [owner, endOfDay], true, true)
    .toArray();
}

export async function getTrackingDataByMeasure(owner, measureId, limit = 100) {
  const db = getDB();
  return db.trackingData
    .where("owner")
    .equals(owner)
    .filter((td) => td.measure_id === measureId)
    .limit(limit)
    .reverse()
    .sortBy("recorded_at");
}

export async function upsertTrackingData(data) {
  const db = getDB();
  const now = new Date().toISOString();

  if (data.id) {
    const existing = await db.trackingData.get(data.id);
    if (existing) {
      await db.trackingData.update(data.id, { ...data, syncedAt: now });
      return db.trackingData.get(data.id);
    }
  }

  // For new records without server ID, use a temporary local ID
  const localId = data.id || `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  await db.trackingData.put({ ...data, id: localId, syncedAt: now });
  return db.trackingData.get(localId);
}

export async function upsertTrackingDataBulk(dataArray) {
  const db = getDB();
  const now = new Date().toISOString();

  await db.trackingData.bulkPut(
    dataArray.map((d) => ({ ...d, syncedAt: now }))
  );
}

export async function deleteTrackingData(id) {
  const db = getDB();
  await db.trackingData.delete(id);
}

// ============================================================
// Entries (Journal)
// ============================================================

export async function getEntriesForDate(owner, date) {
  const db = getDB();
  return db.entries
    .where("[owner+entry_date]")
    .equals([owner, date])
    .sortBy("slot");
}

export async function getRecentEntries(owner, beforeDate, limit = 30) {
  const db = getDB();
  return db.entries
    .where("owner")
    .equals(owner)
    .filter((e) => e.entry_date < beforeDate)
    .limit(limit)
    .reverse()
    .sortBy("entry_date");
}

export async function upsertEntry(entry) {
  const db = getDB();
  const now = new Date().toISOString();

  if (entry.id) {
    const existing = await db.entries.get(entry.id);
    if (existing) {
      await db.entries.update(entry.id, { ...entry, syncedAt: now });
      return db.entries.get(entry.id);
    }
  }

  const localId = entry.id || `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  await db.entries.put({ ...entry, id: localId, syncedAt: now });
  return db.entries.get(localId);
}

export async function upsertEntriesBulk(entries) {
  const db = getDB();
  const now = new Date().toISOString();

  await db.entries.bulkPut(
    entries.map((e) => ({ ...e, syncedAt: now }))
  );
}

// ============================================================
// Timer Sessions
// ============================================================

export async function getActiveTimer(owner) {
  const db = getDB();
  // Find timer sessions that have a start but no end
  const timers = await db.trackingData
    .where("owner")
    .equals(owner)
    .toArray();

  for (const timer of timers) {
    try {
      const value = typeof timer.value === "string" ? JSON.parse(timer.value) : timer.value;
      if (value?.start && !value?.end) {
        return timer;
      }
    } catch (_e) {
      // Skip if value is not valid JSON
    }
  }
  return null;
}

export async function getTimerSessions(owner, limit = 20) {
  const db = getDB();
  // Get all tracking data, filter for timer-type values
  const all = await db.trackingData
    .where("owner")
    .equals(owner)
    .reverse()
    .sortBy("recorded_at");

  const timerSessions = [];
  for (const record of all) {
    try {
      const value = typeof record.value === "string" ? JSON.parse(record.value) : record.value;
      if (value?.start) {
        timerSessions.push(record);
        if (timerSessions.length >= limit) break;
      }
    } catch (_e) {
      // Skip if value is not valid JSON
    }
  }
  return timerSessions;
}

// ============================================================
// Secrets (encrypted storage)
// ============================================================

export async function getSecret(id) {
  const db = getDB();
  return db.secrets.get(id);
}

export async function setSecret(id, encryptedData) {
  const db = getDB();
  await db.secrets.put({ id, data: encryptedData, updatedAt: new Date().toISOString() });
}

export async function deleteSecret(id) {
  const db = getDB();
  await db.secrets.delete(id);
}

export async function hasSecret(id) {
  const db = getDB();
  const secret = await db.secrets.get(id);
  return !!secret;
}

// ============================================================
// Sync Metadata
// ============================================================

export async function getSyncMeta(key) {
  const db = getDB();
  const meta = await db.syncMeta.get(key);
  return meta?.value;
}

export async function setSyncMeta(key, value) {
  const db = getDB();
  await db.syncMeta.put({ key, value, updatedAt: new Date().toISOString() });
}

// ============================================================
// Pending Mutations (offline queue)
// ============================================================

export async function addPendingMutation(table, operation, data) {
  const db = getDB();
  return db.pendingMutations.add({
    table,
    operation,
    data,
    createdAt: new Date().toISOString(),
  });
}

export async function getPendingMutations() {
  const db = getDB();
  return db.pendingMutations.orderBy("createdAt").toArray();
}

export async function deletePendingMutation(id) {
  const db = getDB();
  await db.pendingMutations.delete(id);
}

export async function clearPendingMutations() {
  const db = getDB();
  await db.pendingMutations.clear();
}

// ============================================================
// Profiles (cached)
// ============================================================

export async function getCachedProfile(npub) {
  const db = getDB();
  return db.profiles.get(npub);
}

export async function setCachedProfile(npub, profile) {
  const db = getDB();
  await db.profiles.put({
    npub,
    ...profile,
    updatedAt: new Date().toISOString(),
  });
}

// ============================================================
// Bulk Operations for Sync
// ============================================================

export async function clearAllData() {
  const db = getDB();
  await db.transaction("rw", [db.measures, db.trackingData, db.entries, db.pendingMutations], async () => {
    await db.measures.clear();
    await db.trackingData.clear();
    await db.entries.clear();
    await db.pendingMutations.clear();
  });
}

export async function getLastSyncTime() {
  return getSyncMeta("lastSyncTime");
}

export async function setLastSyncTime(time) {
  return setSyncMeta("lastSyncTime", time);
}
