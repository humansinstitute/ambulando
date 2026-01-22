# Agents

- My preference is for you to answer quickly. Do the research you need but dont get carried away doing long tasks
- If you have multiple steps aska. question to ensure you keep on track. 
- Install deps with `bun install`, then run `bun dev --hot` for hot reloads while editing. Use `bun start` when you want the production-like server.
- Primary files: `src/server.ts` (Bun server, HTML rendering, inline client script) and `src/db.ts` (SQLite helpers). Static assets live in `public/`. The SQLite file `do-the-other-stuff.sqlite` is created automatically; reset with `bun run reset-db` if needed.
- For current layout and where logic lives, see `docs/structure.md` (routes, services, rendering, config).
- When mutating client-side state in the inline script, call `refreshUI()` so the login controls, hero input, and other UI panels redraw correctly.
- Keep the existing routes and forms intact (`/todos`, `/todos/:id/update`, `/todos/:id/state`, `/todos/:id/delete`, `/auth/login`, `/auth/logout`) to avoid breaking submissions.
- Always check for syntax errors before submitting changes by running the app locally and watching the console output.
- Always check for type errors before finishing the job.
- Ensure you always review links to images when presented in a prompt.
- Run lint before shipping: `bun run lint` (use `bun run lint:fix` for autofixes) and keep commits clean.
- Lint enforces async/import hygiene (no floating promises, ordered imports) and parses inline `<script>` blocks for syntax errors; fix warnings instead of silencing them.
- Commit incrementally as you work (not batched at the end) with descriptive messages for easy rollbacks. Do not include self-crediting in commit messages—keep them purely functional.
- Note the current commit hash at the start of work and after completing changes.
- Debug logs are written to `temp/logs/session.log` (cleared on each server start). Requires `MODE=dev` in `.env`. Inspect this file to debug client-side issues like bunker login.
- For schema and ownership details, consult `docs/data_model.md` before changing queries or migrations.
- For AI agent interactions (fetching tasks, posting summaries), follow `docs/agent_api_spec.md` for endpoints, payloads, and example curls.
- For UI changes (structure, refresh flow, styling hooks), see `docs/ui.md` to quickly find component markup, state update patterns, and styling entry points.

---

# Architecture: Dexie + Alpine Frontend

## Core Stack
- **Dexie.js** — All client state lives in IndexedDB via Dexie
- **Alpine.js** — Reactive UI binds directly to Dexie queries
- **Backend DB** — PostgreSQL or SQLite as source of truth

## State Management
- Browser state is Dexie-first; never store app state in memory-only variables
- UI reactivity comes from Alpine watching Dexie liveQueries
- All user-facing data reads come from Dexie, not direct API responses

## Secrets & Keys
- Store keys/passwords/tokens **encrypted** in IndexedDB
- Encrypt with a key derived from user passphrase (e.g., PBKDF2 + AES-GCM)
- Never store plaintext secrets; decrypt only when needed in memory

## Sync Strategy

### Real-time (WebSocket or SSE)
- Maintain persistent connection for server→client pushes
- On receiving update: upsert into Dexie, Alpine reactivity handles UI
- Client→server writes go via WebSocket message or REST POST

### Page Load / Refresh
- `GET /sync?since={lastSyncTimestamp}` — pull changes since last sync
- `POST /sync` — push local unsynced changes (track with `syncedAt` or dirty flag)
- Resolve conflicts with last-write-wins or server-authoritative merge

### Offline Handling
- Queue mutations in Dexie with `pending: true` flag
- On reconnect: flush pending queue to server, then pull latest

## Dexie Schema Conventions
```javascript
db.version(1).stores({
  items: '++id, visitorId, [syncedAt+id], *tags',
  secrets: 'id',           // encrypted blobs
  syncMeta: 'key'          // lastSyncTimestamp, etc.
});
```

## Alpine Integration Pattern
```javascript
// Expose Dexie liveQuery to Alpine
Alpine.store('items', {
  list: [],
  async init() {
    liveQuery(() => db.items.toArray())
      .subscribe(items => this.list = items);
  }
});
```

```html
<div x-data x-init="$store.items.init()">
  <template x-for="item in $store.items.list" :key="item.id">
    <div x-text="item.name"></div>
  </template>
</div>
```

## Rules
- No raw `fetch` results displayed directly — always write to Dexie first
- All sensitive data encrypted at rest in IndexedDB
- Sync timestamps on every record for incremental sync
- WebSocket/SSE for live updates; REST fallback on reconnect/refresh
