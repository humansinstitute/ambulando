// Alpine.js stores backed by Dexie IndexedDB
// UI reactivity comes from Alpine watching Dexie liveQueries

import {
  initDB,
  getDB,
  getLiveQuery,
  getMeasures as dbGetMeasures,
  upsertMeasure as dbUpsertMeasure,
  upsertMeasures as dbUpsertMeasures,
  deleteMeasure as dbDeleteMeasure,
  getTrackingDataForDate as dbGetTrackingDataForDate,
  upsertTrackingData as dbUpsertTrackingData,
  upsertTrackingDataBulk as dbUpsertTrackingDataBulk,
  getEntriesForDate as dbGetEntriesForDate,
  getRecentEntries as dbGetRecentEntries,
  upsertEntry as dbUpsertEntry,
  getActiveTimer as dbGetActiveTimer,
  getTimerSessions as dbGetTimerSessions,
  addPendingMutation,
  getPendingMutations,
  deletePendingMutation,
  setLastSyncTime,
  getLastSyncTime,
  getSecret,
  setSecret,
  deleteSecret,
  hasSecret,
  getCachedProfile,
  setCachedProfile,
} from "./db.js";

let Alpine = null;
let storesInitialized = false;

/**
 * Load Alpine.js from CDN
 */
export async function loadAlpine() {
  if (!Alpine) {
    const mod = await import("https://esm.sh/alpinejs@3.14.8");
    Alpine = mod.default;
    window.Alpine = Alpine;
  }
  return Alpine;
}

/**
 * Initialize all Alpine stores
 * Call this after session is established
 */
export async function initStores(session) {
  if (storesInitialized) return;

  await initDB();
  await loadAlpine();

  const liveQuery = getLiveQuery();
  const db = getDB();

  // ============================================================
  // Session Store
  // ============================================================
  Alpine.store("session", {
    data: session,
    npub: session?.npub || null,
    method: session?.method || null,

    set(newSession) {
      this.data = newSession;
      this.npub = newSession?.npub || null;
      this.method = newSession?.method || null;
    },

    clear() {
      this.data = null;
      this.npub = null;
      this.method = null;
    },

    get isLoggedIn() {
      return !!this.npub;
    },
  });

  // ============================================================
  // Measures Store
  // ============================================================
  Alpine.store("measures", {
    list: [],
    loading: false,
    _subscription: null,

    async init() {
      if (!Alpine.store("session").npub) return;

      this.loading = true;

      // Set up live query subscription
      this._subscription = liveQuery(() =>
        db.measures
          .where("owner")
          .equals(Alpine.store("session").npub)
          .sortBy("sort_order")
      ).subscribe({
        next: (measures) => {
          this.list = measures;
          this.loading = false;
        },
        error: (err) => {
          console.error("[stores] Measures liveQuery error:", err);
          this.loading = false;
        },
      });
    },

    destroy() {
      if (this._subscription) {
        this._subscription.unsubscribe();
        this._subscription = null;
      }
    },

    async refresh() {
      if (!Alpine.store("session").npub) return;
      this.list = await dbGetMeasures(Alpine.store("session").npub);
    },

    byId(id) {
      return this.list.find((m) => m.id === id);
    },

    byType(type) {
      return this.list.filter((m) => m.type === type);
    },

    get dailyMeasures() {
      return this.list.filter((m) => m.type !== "time");
    },

    get timerMeasures() {
      return this.list.filter((m) => m.type === "time");
    },
  });

  // ============================================================
  // Tracking Store
  // ============================================================
  Alpine.store("tracking", {
    data: {}, // Map of measureId -> tracking record
    currentDate: new Date().toISOString().slice(0, 10),
    loading: false,
    _subscription: null,

    async init() {
      await this.loadForDate(this.currentDate);
    },

    destroy() {
      if (this._subscription) {
        this._subscription.unsubscribe();
        this._subscription = null;
      }
    },

    async loadForDate(dateStr) {
      if (!Alpine.store("session").npub) return;

      this.currentDate = dateStr;
      this.loading = true;

      const startOfDay = `${dateStr}T00:00:00`;
      const endOfDay = `${dateStr}T23:59:59`;
      const owner = Alpine.store("session").npub;

      // Set up live query for this date
      if (this._subscription) {
        this._subscription.unsubscribe();
      }

      this._subscription = liveQuery(() =>
        db.trackingData
          .where("[owner+recorded_at]")
          .between([owner, startOfDay], [owner, endOfDay], true, true)
          .toArray()
      ).subscribe({
        next: (records) => {
          // Organize by measure_id
          const dataMap = {};
          for (const record of records) {
            dataMap[record.measure_id] = record;
          }
          this.data = dataMap;
          this.loading = false;
        },
        error: (err) => {
          console.error("[stores] Tracking liveQuery error:", err);
          this.loading = false;
        },
      });
    },

    get(measureId) {
      return this.data[measureId];
    },

    async setDate(dateStr) {
      await this.loadForDate(dateStr);
    },

    navigateDate(delta) {
      const current = new Date(this.currentDate);
      current.setDate(current.getDate() + delta);
      const newDate = current.toISOString().slice(0, 10);
      this.loadForDate(newDate);
      return newDate;
    },
  });

  // ============================================================
  // Timer Store
  // ============================================================
  Alpine.store("timers", {
    active: null, // Currently running timer
    sessions: [], // Recent timer sessions
    loading: false,

    async init() {
      await this.refresh();
    },

    async refresh() {
      if (!Alpine.store("session").npub) return;

      this.loading = true;
      try {
        this.active = await dbGetActiveTimer(Alpine.store("session").npub);
        this.sessions = await dbGetTimerSessions(Alpine.store("session").npub, 20);
      } catch (err) {
        console.error("[stores] Timer refresh error:", err);
      }
      this.loading = false;
    },

    get isRunning() {
      return !!this.active;
    },
  });

  // ============================================================
  // Entries Store (Journal)
  // ============================================================
  Alpine.store("entries", {
    today: [],
    history: [],
    loading: false,
    _subscription: null,

    async init() {
      if (!Alpine.store("session").npub) return;

      const todayStr = new Date().toISOString().slice(0, 10);
      const owner = Alpine.store("session").npub;

      // Live query for today's entries
      this._subscription = liveQuery(() =>
        db.entries
          .where("[owner+entry_date]")
          .equals([owner, todayStr])
          .sortBy("slot")
      ).subscribe({
        next: (entries) => {
          this.today = entries;
        },
        error: (err) => {
          console.error("[stores] Entries liveQuery error:", err);
        },
      });
    },

    destroy() {
      if (this._subscription) {
        this._subscription.unsubscribe();
        this._subscription = null;
      }
    },

    async loadHistory(beforeDate, limit = 30) {
      if (!Alpine.store("session").npub) return;

      this.loading = true;
      try {
        const entries = await dbGetRecentEntries(
          Alpine.store("session").npub,
          beforeDate,
          limit
        );
        this.history = [...this.history, ...entries];
      } catch (err) {
        console.error("[stores] History load error:", err);
      }
      this.loading = false;
    },
  });

  // ============================================================
  // Sync Store
  // ============================================================
  Alpine.store("sync", {
    online: navigator.onLine,
    syncing: false,
    lastSync: null,
    pendingCount: 0,

    async init() {
      // Listen for online/offline events
      window.addEventListener("online", () => {
        this.online = true;
        this.flushPending();
      });
      window.addEventListener("offline", () => {
        this.online = false;
      });

      // Load last sync time
      this.lastSync = await getLastSyncTime();

      // Count pending mutations
      const pending = await getPendingMutations();
      this.pendingCount = pending.length;
    },

    async flushPending() {
      if (!this.online || this.syncing) return;

      const pending = await getPendingMutations();
      if (pending.length === 0) return;

      this.syncing = true;

      for (const mutation of pending) {
        try {
          await this.processMutation(mutation);
          await deletePendingMutation(mutation.id);
          this.pendingCount--;
        } catch (err) {
          console.error("[sync] Failed to process mutation:", err);
          // Keep in queue for retry
          break;
        }
      }

      this.syncing = false;
    },

    async processMutation(mutation) {
      const { table, operation, data } = mutation;

      let endpoint, method, body;

      switch (table) {
        case "measures":
          endpoint = "/api/measures";
          method = operation === "delete" ? "DELETE" : "POST";
          body = data;
          break;
        case "trackingData":
          endpoint = "/tracking";
          method = operation === "delete" ? "DELETE" : "POST";
          body = data;
          break;
        case "entries":
          endpoint = "/entries";
          method = "POST";
          body = data;
          break;
        default:
          console.warn("[sync] Unknown table:", table);
          return;
      }

      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.status}`);
      }

      return response.json();
    },

    async pullChanges() {
      if (!this.online || this.syncing) return;

      this.syncing = true;

      try {
        const since = this.lastSync || "1970-01-01T00:00:00Z";
        const response = await fetch(`/sync?since=${encodeURIComponent(since)}`);

        if (!response.ok) {
          throw new Error(`Pull failed: ${response.status}`);
        }

        const { measures, trackingData, entries, serverTime } = await response.json();

        // Upsert into Dexie
        if (measures?.length) {
          await dbUpsertMeasures(measures);
        }
        if (trackingData?.length) {
          await dbUpsertTrackingDataBulk(trackingData);
        }
        if (entries?.length) {
          for (const entry of entries) {
            await dbUpsertEntry(entry);
          }
        }

        // Update last sync time
        this.lastSync = serverTime || new Date().toISOString();
        await setLastSyncTime(this.lastSync);
      } catch (err) {
        console.error("[sync] Pull failed:", err);
      }

      this.syncing = false;
    },
  });

  // ============================================================
  // Secrets Store
  // ============================================================
  Alpine.store("secrets", {
    async get(id) {
      const secret = await getSecret(id);
      return secret?.data || null;
    },

    async set(id, encryptedData) {
      await setSecret(id, encryptedData);
    },

    async delete(id) {
      await deleteSecret(id);
    },

    async has(id) {
      return hasSecret(id);
    },
  });

  // ============================================================
  // Profile Store
  // ============================================================
  Alpine.store("profile", {
    current: null,
    loading: false,

    async load(npub) {
      // Check cache first
      const cached = await getCachedProfile(npub);
      if (cached) {
        this.current = cached;
        return cached;
      }
      return null;
    },

    async save(npub, profile) {
      await setCachedProfile(npub, profile);
      if (npub === Alpine.store("session").npub) {
        this.current = profile;
      }
    },
  });

  storesInitialized = true;

  // Initialize stores that need it
  await Alpine.store("sync").init();
}

/**
 * Initialize stores for a logged-in session
 */
export async function initSessionStores() {
  if (!storesInitialized) return;

  const Alpine = window.Alpine;
  if (!Alpine) return;

  // Initialize session-dependent stores
  await Alpine.store("measures").init();
  await Alpine.store("tracking").init();
  await Alpine.store("timers").init();
  await Alpine.store("entries").init();

  // Pull latest changes from server
  await Alpine.store("sync").pullChanges();
}

/**
 * Clean up stores on logout
 */
export function destroyStores() {
  if (!storesInitialized) return;

  const Alpine = window.Alpine;
  if (!Alpine) return;

  Alpine.store("measures").destroy();
  Alpine.store("tracking").destroy();
  Alpine.store("entries").destroy();
  Alpine.store("session").clear();
}

/**
 * Helper to save tracking data (writes to Dexie + queues server sync)
 */
export async function saveTrackingData(measureId, value, options = {}) {
  const session = window.Alpine?.store("session");
  if (!session?.npub) return null;

  const tracking = window.Alpine?.store("tracking");
  const existingRecord = tracking?.get(measureId);

  const data = {
    id: existingRecord?.id,
    owner: session.npub,
    measure_id: measureId,
    recorded_at: existingRecord?.recorded_at || new Date().toISOString(),
    value: typeof value === "object" ? JSON.stringify(value) : String(value),
  };

  // Save to Dexie
  const saved = await dbUpsertTrackingData(data);

  // Queue for server sync if online, otherwise add to pending
  const sync = window.Alpine?.store("sync");
  if (sync?.online) {
    try {
      const response = await fetch("/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        const { data: serverData } = await response.json();
        // Update local record with server ID
        if (serverData?.id && saved?.id !== serverData.id) {
          await dbUpsertTrackingData({ ...saved, id: serverData.id });
        }
      }
    } catch (err) {
      console.error("[stores] Server save failed, queuing:", err);
      await addPendingMutation("trackingData", "upsert", data);
      sync.pendingCount++;
    }
  } else {
    await addPendingMutation("trackingData", "upsert", data);
    if (sync) sync.pendingCount++;
  }

  return saved;
}

/**
 * Helper to save a measure (writes to Dexie + queues server sync)
 */
export async function saveMeasure(measure) {
  const session = window.Alpine?.store("session");
  if (!session?.npub) return null;

  const data = {
    ...measure,
    owner: session.npub,
  };

  // Save to Dexie
  const saved = await dbUpsertMeasure(data);

  // Queue for server sync
  const sync = window.Alpine?.store("sync");
  if (sync?.online) {
    try {
      const response = await fetch("/api/measures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        const { measure: serverMeasure } = await response.json();
        if (serverMeasure?.id && saved?.id !== serverMeasure.id) {
          await dbUpsertMeasure({ ...saved, id: serverMeasure.id });
        }
      }
    } catch (err) {
      console.error("[stores] Measure save failed, queuing:", err);
      await addPendingMutation("measures", "upsert", data);
      sync.pendingCount++;
    }
  } else {
    await addPendingMutation("measures", "upsert", data);
    if (sync) sync.pendingCount++;
  }

  return saved;
}

/**
 * Helper to save an entry (writes to Dexie + queues server sync)
 */
export async function saveEntry(entry) {
  const session = window.Alpine?.store("session");
  if (!session?.npub) return null;

  const data = {
    ...entry,
    owner: session.npub,
  };

  // Save to Dexie
  const saved = await dbUpsertEntry(data);

  // Queue for server sync
  const sync = window.Alpine?.store("sync");
  if (sync?.online) {
    try {
      const response = await fetch("/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry_date: data.entry_date,
          slot: data.slot,
          encrypted_content: data.encrypted_content,
        }),
      });

      if (response.ok) {
        const { entry: serverEntry } = await response.json();
        if (serverEntry?.id && saved?.id !== serverEntry.id) {
          await dbUpsertEntry({ ...saved, id: serverEntry.id });
        }
      }
    } catch (err) {
      console.error("[stores] Entry save failed, queuing:", err);
      await addPendingMutation("entries", "upsert", data);
      sync.pendingCount++;
    }
  } else {
    await addPendingMutation("entries", "upsert", data);
    if (sync) sync.pendingCount++;
  }

  return saved;
}

export { Alpine };
