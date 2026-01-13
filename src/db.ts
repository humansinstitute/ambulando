import { Database } from "bun:sqlite";

import type {
  TodoPriority,
  TodoState,
  CreditTransactionType,
  CreditOrderStatus,
  CreditAuditEventType,
} from "./types";

export type Todo = {
  id: number;
  title: string;
  owner: string;
  description: string;
  priority: TodoPriority;
  state: TodoState;
  done: number;
  deleted: number;
  created_at: string;
  scheduled_for: string | null;
  tags: string;
};

export type Summary = {
  id: number;
  owner: string;
  summary_date: string;
  day_ahead: string | null;
  week_ahead: string | null;
  suggestions: string | null;
  created_at: string;
  updated_at: string;
};

export type Entry = {
  id: number;
  owner: string;
  entry_date: string;
  slot: number;
  encrypted_content: string;
  created_at: string;
  updated_at: string;
};

export type MeasureType = "number" | "text" | "goodbad" | "time" | "options" | "rating";

export type Measure = {
  id: number;
  owner: string;
  name: string;
  type: MeasureType;
  encrypted: number; // 0 or 1
  sort_order: number;
  config: string | null; // JSON config for options type (e.g., ["Option1", "Option2"])
  created_at: string;
};

export type TrackingData = {
  id: number;
  owner: string;
  measure_id: number;
  recorded_at: string;
  value: string;
  created_at: string;
  updated_at: string;
};

// Credit system types
export type UserCredits = {
  id: number;
  npub: string;
  balance: number;
  first_login_at: string;
  created_at: string;
  updated_at: string;
};

export type CreditTransaction = {
  id: number;
  npub: string;
  type: CreditTransactionType;
  amount: number;
  balance_before: number;
  balance_after: number;
  reference_id: string | null;
  notes: string | null;
  created_at: string;
};

export type CreditOrder = {
  id: number;
  npub: string;
  mginx_order_id: string;
  quantity: number;
  amount_sats: number;
  bolt11: string;
  status: CreditOrderStatus;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
};

export type CreditAuditLog = {
  id: number;
  npub: string;
  event_type: CreditAuditEventType;
  credits_at_event: number;
  details: string | null;
  created_at: string;
};

const db = new Database(Bun.env.DB_PATH || "do-the-other-stuff.sqlite");

db.run(`
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

const addColumn = (sql: string) => {
  try {
    db.run(sql);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("duplicate column")) {
      throw error;
    }
  }
};

addColumn("ALTER TABLE todos ADD COLUMN description TEXT DEFAULT ''");
addColumn("ALTER TABLE todos ADD COLUMN priority TEXT NOT NULL DEFAULT 'sand'");
addColumn("ALTER TABLE todos ADD COLUMN state TEXT NOT NULL DEFAULT 'new'");
addColumn("ALTER TABLE todos ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0");
addColumn("ALTER TABLE todos ADD COLUMN owner TEXT NOT NULL DEFAULT ''");
addColumn("ALTER TABLE todos ADD COLUMN scheduled_for TEXT DEFAULT NULL");
addColumn("ALTER TABLE todos ADD COLUMN tags TEXT DEFAULT ''");

db.run(`
  CREATE TABLE IF NOT EXISTS ai_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    summary_date TEXT NOT NULL,
    day_ahead TEXT NULL,
    week_ahead TEXT NULL,
    suggestions TEXT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner, summary_date)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    entry_date TEXT NOT NULL,
    slot INTEGER NOT NULL,
    encrypted_content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner, entry_date, slot)
  )
`);

// Measure definitions (user-configurable tracking metrics)
// Note: name and config fields store NIP-44 encrypted ciphertext
db.run(`
  CREATE TABLE IF NOT EXISTS measures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    encrypted INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    config TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
// Migration for existing tables
addColumn("ALTER TABLE measures ADD COLUMN config TEXT DEFAULT NULL");

// Migration: Remove UNIQUE(owner, name) constraint for encrypted names
// SQLite requires table recreation to drop constraints
try {
  const hasConstraint = db.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='measures'").get() as { sql: string } | null;
  if (hasConstraint?.sql?.includes("UNIQUE(owner, name)")) {
    db.run("BEGIN TRANSACTION");
    db.run(`CREATE TABLE measures_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      encrypted INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      config TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run("INSERT INTO measures_new SELECT * FROM measures");
    db.run("DROP TABLE measures");
    db.run("ALTER TABLE measures_new RENAME TO measures");
    db.run("COMMIT");
    console.log("Migrated measures table: removed UNIQUE constraint");
  }
} catch (err) {
  console.error("Migration error (measures UNIQUE constraint):", err);
  try { db.run("ROLLBACK"); } catch { /* ignore */ }
}

// Tracked data points
db.run(`
  CREATE TABLE IF NOT EXISTS tracking_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    measure_id INTEGER NOT NULL,
    recorded_at TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (measure_id) REFERENCES measures(id)
  )
`);
db.run(`CREATE INDEX IF NOT EXISTS idx_tracking_owner_date ON tracking_data(owner, recorded_at)`);

// Credit system tables
db.run(`
  CREATE TABLE IF NOT EXISTS user_credits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    npub TEXT NOT NULL UNIQUE,
    balance INTEGER NOT NULL DEFAULT 0,
    first_login_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS credit_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    npub TEXT NOT NULL,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    balance_before INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reference_id TEXT DEFAULT NULL,
    notes TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
db.run(`CREATE INDEX IF NOT EXISTS idx_credit_tx_npub ON credit_transactions(npub)`);

db.run(`
  CREATE TABLE IF NOT EXISTS credit_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    npub TEXT NOT NULL,
    mginx_order_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    amount_sats INTEGER NOT NULL,
    bolt11 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at TEXT DEFAULT NULL
  )
`);
db.run(`CREATE INDEX IF NOT EXISTS idx_credit_orders_npub ON credit_orders(npub)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_credit_orders_mginx_id ON credit_orders(mginx_order_id)`);

db.run(`
  CREATE TABLE IF NOT EXISTS credit_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    npub TEXT NOT NULL,
    event_type TEXT NOT NULL,
    credits_at_event INTEGER NOT NULL,
    details TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
db.run(`CREATE INDEX IF NOT EXISTS idx_credit_audit_npub ON credit_audit_log(npub)`);

const listByOwnerStmt = db.query<Todo>(
  "SELECT * FROM todos WHERE deleted = 0 AND owner = ? ORDER BY created_at DESC"
);
const listScheduledStmt = db.query<Todo>(
  `SELECT * FROM todos
   WHERE deleted = 0
     AND owner = ?
     AND scheduled_for IS NOT NULL
     AND scheduled_for != ''
     AND date(scheduled_for) <= date(?)
   ORDER BY scheduled_for ASC, created_at DESC`
);
const listUnscheduledStmt = db.query<Todo>(
  `SELECT * FROM todos
   WHERE deleted = 0
     AND owner = ?
     AND (scheduled_for IS NULL OR scheduled_for = '')
   ORDER BY created_at DESC`
);
const insertStmt = db.query(
  "INSERT INTO todos (title, description, priority, state, done, owner, tags) VALUES (?, '', 'sand', 'new', 0, ?, ?) RETURNING *"
);
const insertFullStmt = db.query<Todo>(
  `INSERT INTO todos (title, description, priority, state, done, owner, scheduled_for, tags)
   VALUES (?, ?, ?, ?, CASE WHEN ? = 'done' THEN 1 ELSE 0 END, ?, ?, ?)
   RETURNING *`
);
const deleteStmt = db.query("UPDATE todos SET deleted = 1 WHERE id = ? AND owner = ?");
const updateStmt = db.query<Todo>(
  `UPDATE todos
   SET
    title = ?,
    description = ?,
    priority = ?,
    state = ?,
    done = CASE WHEN ? = 'done' THEN 1 ELSE 0 END,
    scheduled_for = ?,
    tags = ?
   WHERE id = ? AND owner = ?
   RETURNING *`
);
const transitionStmt = db.query<Todo>(
  `UPDATE todos
   SET
    state = ?,
    done = CASE WHEN ? = 'done' THEN 1 ELSE 0 END
   WHERE id = ? AND owner = ?
   RETURNING *`
);
const upsertSummaryStmt = db.query<Summary>(
  `INSERT INTO ai_summaries (owner, summary_date, day_ahead, week_ahead, suggestions)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(owner, summary_date) DO UPDATE SET
     day_ahead = excluded.day_ahead,
     week_ahead = excluded.week_ahead,
     suggestions = excluded.suggestions,
     updated_at = CURRENT_TIMESTAMP
   RETURNING *`
);
const latestDaySummaryStmt = db.query<Summary>(
  `SELECT * FROM ai_summaries
   WHERE owner = ? AND summary_date = ?
   ORDER BY updated_at DESC
   LIMIT 1`
);
const latestWeekSummaryStmt = db.query<Summary>(
  `SELECT * FROM ai_summaries
   WHERE owner = ? AND summary_date BETWEEN ? AND ?
   ORDER BY updated_at DESC
   LIMIT 1`
);

export function listTodos(owner: string | null, filterTags?: string[]) {
  if (!owner) return [];
  const todos = listByOwnerStmt.all(owner);
  if (!filterTags || filterTags.length === 0) return todos;
  // Filter todos that have at least one of the specified tags
  return todos.filter((todo) => {
    const todoTags = todo.tags ? todo.tags.split(",").map((t) => t.trim().toLowerCase()) : [];
    return filterTags.some((ft) => todoTags.includes(ft.toLowerCase()));
  });
}

export function listScheduledTodos(owner: string, endDate: string) {
  return listScheduledStmt.all(owner, endDate);
}

export function listUnscheduledTodos(owner: string) {
  return listUnscheduledStmt.all(owner);
}

export function addTodo(title: string, owner: string, tags: string = "") {
  if (!title.trim()) return null;
  const todo = insertStmt.get(title.trim(), owner, tags) as Todo | undefined;
  return todo ?? null;
}

export function addTodoFull(
  owner: string,
  fields: {
    title: string;
    description?: string;
    priority?: TodoPriority;
    state?: TodoState;
    scheduled_for?: string | null;
    tags?: string;
  }
) {
  const title = fields.title?.trim();
  if (!title) return null;
  const description = fields.description?.trim() ?? "";
  const priority = fields.priority ?? "sand";
  const state = fields.state ?? "new";
  const scheduled_for = fields.scheduled_for ?? null;
  const tags = fields.tags?.trim() ?? "";
  const todo = insertFullStmt.get(
    title,
    description,
    priority,
    state,
    state,
    owner,
    scheduled_for,
    tags
  ) as Todo | undefined;
  return todo ?? null;
}

export function deleteTodo(id: number, owner: string) {
  deleteStmt.run(id, owner);
}

export function updateTodo(
  id: number,
  owner: string,
  fields: {
    title: string;
    description: string;
    priority: TodoPriority;
    state: TodoState;
    scheduled_for: string | null;
    tags: string;
  }
) {
  const todo = updateStmt.get(
    fields.title,
    fields.description,
    fields.priority,
    fields.state,
    fields.state,
    fields.scheduled_for,
    fields.tags,
    id,
    owner
  ) as Todo | undefined;
  return todo ?? null;
}

export function transitionTodo(id: number, owner: string, state: TodoState) {
  const todo = transitionStmt.get(state, state, id, owner) as Todo | undefined;
  return todo ?? null;
}

export function assignAllTodosToOwner(npub: string) {
  if (!npub) return;
  db.run("UPDATE todos SET owner = ? WHERE owner = '' OR owner IS NULL", npub);
}

export function upsertSummary({
  owner,
  summaryDate,
  dayAhead,
  weekAhead,
  suggestions,
}: {
  owner: string;
  summaryDate: string;
  dayAhead: string | null;
  weekAhead: string | null;
  suggestions: string | null;
}) {
  const summary = upsertSummaryStmt.get(owner, summaryDate, dayAhead, weekAhead, suggestions) as Summary | undefined;
  return summary ?? null;
}

export function getLatestSummaries(owner: string, today: string, weekStart: string, weekEnd: string) {
  const day = latestDaySummaryStmt.get(owner, today) as Summary | undefined;
  const week = latestWeekSummaryStmt.get(owner, weekStart, weekEnd) as Summary | undefined;
  return { day: day ?? null, week: week ?? null };
}

export function resetDatabase() {
  db.run("DELETE FROM todos");
  db.run("DELETE FROM ai_summaries");
  db.run("DELETE FROM entries");
  db.run("DELETE FROM tracking_data");
  db.run("DELETE FROM measures");
  db.run("DELETE FROM user_credits");
  db.run("DELETE FROM credit_transactions");
  db.run("DELETE FROM credit_orders");
  db.run("DELETE FROM credit_audit_log");
  db.run("DELETE FROM sqlite_sequence WHERE name IN ('todos', 'ai_summaries', 'entries', 'measures', 'tracking_data', 'user_credits', 'credit_transactions', 'credit_orders', 'credit_audit_log')");
}

// Entry prepared statements
const getEntriesForDateStmt = db.query<Entry>(
  `SELECT * FROM entries
   WHERE owner = ? AND entry_date = ?
   ORDER BY slot ASC`
);

const getRecentEntriesStmt = db.query<Entry>(
  `SELECT * FROM entries
   WHERE owner = ? AND entry_date < ?
   ORDER BY entry_date DESC, slot ASC
   LIMIT ?`
);

const getEntryDatesStmt = db.query<{ entry_date: string; count: number }>(
  `SELECT entry_date, COUNT(*) as count FROM entries
   WHERE owner = ?
   GROUP BY entry_date
   ORDER BY entry_date DESC
   LIMIT ?`
);

const upsertEntryStmt = db.query<Entry>(
  `INSERT INTO entries (owner, entry_date, slot, encrypted_content)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(owner, entry_date, slot) DO UPDATE SET
     encrypted_content = excluded.encrypted_content,
     updated_at = CURRENT_TIMESTAMP
   RETURNING *`
);

// Entry functions
export function getEntriesForDate(owner: string, date: string): Entry[] {
  if (!owner || !date) return [];
  return getEntriesForDateStmt.all(owner, date);
}

export function getRecentEntries(owner: string, beforeDate: string, limit: number = 30): Entry[] {
  if (!owner) return [];
  return getRecentEntriesStmt.all(owner, beforeDate, limit);
}

export function getEntryDates(owner: string, limit: number = 30): { entry_date: string; count: number }[] {
  if (!owner) return [];
  return getEntryDatesStmt.all(owner, limit);
}

export function upsertEntry(
  owner: string,
  entryDate: string,
  slot: number,
  encryptedContent: string
): Entry | null {
  if (!owner || !entryDate || slot < 1 || slot > 3 || !encryptedContent) return null;
  const entry = upsertEntryStmt.get(owner, entryDate, slot, encryptedContent) as Entry | undefined;
  return entry ?? null;
}

// ============================================================
// Measure prepared statements and functions
// ============================================================

const getMeasuresStmt = db.query<Measure>(
  `SELECT * FROM measures WHERE owner = ? ORDER BY sort_order ASC, id ASC`
);

const getMeasureByIdStmt = db.query<Measure>(
  `SELECT * FROM measures WHERE id = ? AND owner = ?`
);

// Simple INSERT since names are now encrypted (no UNIQUE constraint)
const insertMeasureStmt = db.query<Measure>(
  `INSERT INTO measures (owner, name, type, encrypted, sort_order, config)
   VALUES (?, ?, ?, ?, ?, ?)
   RETURNING *`
);

const updateMeasureStmt = db.query<Measure>(
  `UPDATE measures SET name = ?, type = ?, encrypted = ?, sort_order = ?, config = ?
   WHERE id = ? AND owner = ?
   RETURNING *`
);

const deleteMeasureStmt = db.query(
  `DELETE FROM measures WHERE id = ? AND owner = ?`
);

const deleteTrackingForMeasureStmt = db.query(
  `DELETE FROM tracking_data WHERE measure_id = ? AND owner = ?`
);

export function getMeasures(owner: string): Measure[] {
  if (!owner) return [];
  return getMeasuresStmt.all(owner);
}

export function getMeasureById(id: number, owner: string): Measure | null {
  if (!owner) return null;
  const measure = getMeasureByIdStmt.get(id, owner) as Measure | undefined;
  return measure ?? null;
}

export function createMeasure(
  owner: string,
  name: string,
  type: MeasureType,
  encrypted: boolean,
  sortOrder: number = 0,
  config: string | null = null
): Measure | null {
  if (!owner || !name || !type) return null;
  const measure = insertMeasureStmt.get(
    owner,
    name,
    type,
    encrypted ? 1 : 0,
    sortOrder,
    config
  ) as Measure | undefined;
  return measure ?? null;
}

export function updateMeasure(
  id: number,
  owner: string,
  name: string,
  type: MeasureType,
  encrypted: boolean,
  sortOrder: number,
  config: string | null = null
): Measure | null {
  if (!owner || !name || !type) return null;
  const measure = updateMeasureStmt.get(
    name.trim(),
    type,
    encrypted ? 1 : 0,
    sortOrder,
    config,
    id,
    owner
  ) as Measure | undefined;
  return measure ?? null;
}

export function deleteMeasure(id: number, owner: string): void {
  // Delete associated tracking data first
  deleteTrackingForMeasureStmt.run(id, owner);
  deleteMeasureStmt.run(id, owner);
}

const updateMeasureSortOrderStmt = db.query(
  `UPDATE measures SET sort_order = ? WHERE id = ? AND owner = ?`
);

export function updateMeasureSortOrders(owner: string, orders: Array<{ id: number; sort_order: number }>): void {
  if (!owner || orders.length === 0) return;

  // Update each measure's sort_order in a transaction
  db.transaction(() => {
    for (const { id, sort_order } of orders) {
      updateMeasureSortOrderStmt.run(sort_order, id, owner);
    }
  })();
}

// ============================================================
// Tracking data prepared statements and functions
// ============================================================

const getTrackingDataStmt = db.query<TrackingData>(
  `SELECT * FROM tracking_data
   WHERE owner = ?
   ORDER BY recorded_at DESC
   LIMIT ?`
);

const getTrackingDataByDateRangeStmt = db.query<TrackingData>(
  `SELECT * FROM tracking_data
   WHERE owner = ? AND recorded_at >= ? AND recorded_at < ?
   ORDER BY recorded_at DESC`
);

const getTrackingDataByMeasureStmt = db.query<TrackingData>(
  `SELECT * FROM tracking_data
   WHERE owner = ? AND measure_id = ?
   ORDER BY recorded_at DESC
   LIMIT ?`
);

const getTrackingDataForDateStmt = db.query<TrackingData>(
  `SELECT * FROM tracking_data
   WHERE owner = ? AND date(recorded_at) = date(?)
   ORDER BY measure_id ASC, recorded_at DESC`
);

const upsertTrackingDataStmt = db.query<TrackingData>(
  `INSERT INTO tracking_data (owner, measure_id, recorded_at, value)
   VALUES (?, ?, ?, ?)
   RETURNING *`
);

const updateTrackingDataStmt = db.query<TrackingData>(
  `UPDATE tracking_data SET value = ?, updated_at = CURRENT_TIMESTAMP
   WHERE id = ? AND owner = ?
   RETURNING *`
);

const deleteTrackingDataStmt = db.query(
  `DELETE FROM tracking_data WHERE id = ? AND owner = ?`
);

const getActiveTimerStmt = db.query<TrackingData>(
  `SELECT td.* FROM tracking_data td
   JOIN measures m ON td.measure_id = m.id
   WHERE td.owner = ? AND m.type = 'time'
     AND td.value LIKE '%"start":%'
     AND td.value NOT LIKE '%"end":%'
   ORDER BY td.recorded_at DESC
   LIMIT 1`
);

const getTimerSessionsStmt = db.query<TrackingData>(
  `SELECT td.* FROM tracking_data td
   JOIN measures m ON td.measure_id = m.id
   WHERE td.owner = ? AND m.type = 'time'
   ORDER BY td.recorded_at DESC
   LIMIT ?`
);

export function getTrackingData(owner: string, limit: number = 100): TrackingData[] {
  if (!owner) return [];
  return getTrackingDataStmt.all(owner, limit);
}

export function getTrackingDataByDateRange(
  owner: string,
  startDate: string,
  endDate: string
): TrackingData[] {
  if (!owner) return [];
  return getTrackingDataByDateRangeStmt.all(owner, startDate, endDate);
}

export function getTrackingDataByMeasure(
  owner: string,
  measureId: number,
  limit: number = 100
): TrackingData[] {
  if (!owner) return [];
  return getTrackingDataByMeasureStmt.all(owner, measureId, limit);
}

export function getTrackingDataForDate(owner: string, date: string): TrackingData[] {
  if (!owner || !date) return [];
  return getTrackingDataForDateStmt.all(owner, date);
}

export function saveTrackingData(
  owner: string,
  measureId: number,
  recordedAt: string,
  value: string
): TrackingData | null {
  if (!owner || !measureId || !recordedAt || value === undefined) return null;
  const data = upsertTrackingDataStmt.get(owner, measureId, recordedAt, value) as TrackingData | undefined;
  return data ?? null;
}

export function updateTrackingData(
  id: number,
  owner: string,
  value: string
): TrackingData | null {
  if (!owner || value === undefined) return null;
  const data = updateTrackingDataStmt.get(value, id, owner) as TrackingData | undefined;
  return data ?? null;
}

export function deleteTrackingData(id: number, owner: string): void {
  deleteTrackingDataStmt.run(id, owner);
}

export function getActiveTimer(owner: string): TrackingData | null {
  if (!owner) return null;
  const data = getActiveTimerStmt.get(owner) as TrackingData | undefined;
  return data ?? null;
}

export function getTimerSessions(owner: string, limit: number = 20): TrackingData[] {
  if (!owner) return [];
  return getTimerSessionsStmt.all(owner, limit);
}

// ============================================================
// Credit system prepared statements and functions
// ============================================================

const getUserCreditsStmt = db.query<UserCredits>(
  `SELECT * FROM user_credits WHERE npub = ?`
);

const createUserCreditsStmt = db.query<UserCredits>(
  `INSERT INTO user_credits (npub, balance, first_login_at)
   VALUES (?, ?, CURRENT_TIMESTAMP)
   RETURNING *`
);

const updateUserCreditsStmt = db.query<UserCredits>(
  `UPDATE user_credits SET balance = ?, updated_at = CURRENT_TIMESTAMP
   WHERE npub = ?
   RETURNING *`
);

const getAllUsersWithCreditsStmt = db.query<UserCredits>(
  `SELECT * FROM user_credits WHERE balance > 0`
);

const insertCreditTransactionStmt = db.query<CreditTransaction>(
  `INSERT INTO credit_transactions (npub, type, amount, balance_before, balance_after, reference_id, notes)
   VALUES (?, ?, ?, ?, ?, ?, ?)
   RETURNING *`
);

const getCreditTransactionsStmt = db.query<CreditTransaction>(
  `SELECT * FROM credit_transactions WHERE npub = ? ORDER BY created_at DESC LIMIT ?`
);

const createCreditOrderStmt = db.query<CreditOrder>(
  `INSERT INTO credit_orders (npub, mginx_order_id, quantity, amount_sats, bolt11, status)
   VALUES (?, ?, ?, ?, ?, 'pending')
   RETURNING *`
);

const getCreditOrderByIdStmt = db.query<CreditOrder>(
  `SELECT * FROM credit_orders WHERE id = ? AND npub = ?`
);

const getCreditOrderByMginxIdStmt = db.query<CreditOrder>(
  `SELECT * FROM credit_orders WHERE mginx_order_id = ?`
);

const getPendingOrdersStmt = db.query<CreditOrder>(
  `SELECT * FROM credit_orders WHERE npub = ? AND status = 'pending' ORDER BY created_at DESC`
);

const updateCreditOrderStatusStmt = db.query<CreditOrder>(
  `UPDATE credit_orders SET status = ?, updated_at = CURRENT_TIMESTAMP, paid_at = CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE paid_at END
   WHERE id = ?
   RETURNING *`
);

const insertCreditAuditLogStmt = db.query<CreditAuditLog>(
  `INSERT INTO credit_audit_log (npub, event_type, credits_at_event, details)
   VALUES (?, ?, ?, ?)
   RETURNING *`
);

const getCreditAuditLogsStmt = db.query<CreditAuditLog>(
  `SELECT * FROM credit_audit_log WHERE npub = ? ORDER BY created_at DESC LIMIT ?`
);

// Credit functions
export function getUserCredits(npub: string): UserCredits | null {
  if (!npub) return null;
  const credits = getUserCreditsStmt.get(npub) as UserCredits | undefined;
  return credits ?? null;
}

export function createUserCredits(npub: string, initialBalance: number): UserCredits | null {
  if (!npub) return null;
  const credits = createUserCreditsStmt.get(npub, initialBalance) as UserCredits | undefined;
  return credits ?? null;
}

export function updateUserCreditsBalance(npub: string, newBalance: number): UserCredits | null {
  if (!npub) return null;
  const credits = updateUserCreditsStmt.get(newBalance, npub) as UserCredits | undefined;
  return credits ?? null;
}

export function getAllUsersWithCredits(): UserCredits[] {
  return getAllUsersWithCreditsStmt.all();
}

export function addCreditTransaction(
  npub: string,
  type: CreditTransactionType,
  amount: number,
  balanceBefore: number,
  balanceAfter: number,
  referenceId: string | null = null,
  notes: string | null = null
): CreditTransaction | null {
  if (!npub) return null;
  const tx = insertCreditTransactionStmt.get(
    npub,
    type,
    amount,
    balanceBefore,
    balanceAfter,
    referenceId,
    notes
  ) as CreditTransaction | undefined;
  return tx ?? null;
}

export function getCreditTransactions(npub: string, limit: number = 50): CreditTransaction[] {
  if (!npub) return [];
  return getCreditTransactionsStmt.all(npub, limit);
}

export function createCreditOrder(
  npub: string,
  mginxOrderId: string,
  quantity: number,
  amountSats: number,
  bolt11: string
): CreditOrder | null {
  if (!npub || !mginxOrderId || !bolt11) return null;
  const order = createCreditOrderStmt.get(
    npub,
    mginxOrderId,
    quantity,
    amountSats,
    bolt11
  ) as CreditOrder | undefined;
  return order ?? null;
}

export function getCreditOrderById(id: number, npub: string): CreditOrder | null {
  if (!npub) return null;
  const order = getCreditOrderByIdStmt.get(id, npub) as CreditOrder | undefined;
  return order ?? null;
}

export function getCreditOrderByMginxId(mginxOrderId: string): CreditOrder | null {
  if (!mginxOrderId) return null;
  const order = getCreditOrderByMginxIdStmt.get(mginxOrderId) as CreditOrder | undefined;
  return order ?? null;
}

export function getPendingOrders(npub: string): CreditOrder[] {
  if (!npub) return [];
  return getPendingOrdersStmt.all(npub);
}

export function updateCreditOrderStatus(id: number, status: CreditOrderStatus): CreditOrder | null {
  const order = updateCreditOrderStatusStmt.get(status, status, id) as CreditOrder | undefined;
  return order ?? null;
}

export function addCreditAuditLog(
  npub: string,
  eventType: CreditAuditEventType,
  creditsAtEvent: number,
  details: string | null = null
): CreditAuditLog | null {
  if (!npub) return null;
  const log = insertCreditAuditLogStmt.get(npub, eventType, creditsAtEvent, details) as CreditAuditLog | undefined;
  return log ?? null;
}

export function getCreditAuditLogs(npub: string, limit: number = 50): CreditAuditLog[] {
  if (!npub) return [];
  return getCreditAuditLogsStmt.all(npub, limit);
}

// Transaction helper for credit operations
export function withCreditTransaction<T>(fn: () => T): T {
  return db.transaction(fn)();
}
