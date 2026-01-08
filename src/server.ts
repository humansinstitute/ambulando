import {
  APP_NAME,
  APP_TAG,
  COOKIE_SECURE,
  IS_DEV,
  LOGIN_EVENT_KIND,
  LOGIN_MAX_AGE_SECONDS,
  PORT,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "./config";
import { withErrorHandling } from "./http";
import { initLogs, logDebug, logError } from "./logger";
import { handleAiTasks, handleAiTasksPost, handleLatestSummary, handleSummaryPost } from "./routes/ai";
import { createAuthHandlers } from "./routes/auth";
import { handleGetEntries, handleGetRecentEntries, handleSaveEntry } from "./routes/entries";
import { handleHome } from "./routes/home";
import { handleTodoCreate, handleTodoDelete, handleTodoState, handleTodoUpdate } from "./routes/todos";
import {
  handleGetMeasures,
  handleSaveMeasure,
  handleDeleteMeasure,
  handleGetTracking,
  handleSaveTracking,
  handleDeleteTracking,
  handleGetActiveTimer,
  handleGetTimerSessions,
  handleStartTimer,
  handleStopTimer,
} from "./routes/tracking";
import { AuthService } from "./services/auth";
import { serveStatic } from "./static";

// Initialize logs (clears previous session)
initLogs();

const authService = new AuthService(
  SESSION_COOKIE,
  APP_TAG,
  LOGIN_EVENT_KIND,
  LOGIN_MAX_AGE_SECONDS,
  COOKIE_SECURE,
  SESSION_MAX_AGE_SECONDS
);

const { login, logout, sessionFromRequest } = createAuthHandlers(authService, SESSION_COOKIE);

const server = Bun.serve({
  port: PORT,
  fetch: withErrorHandling(
    async (req) => {
      const url = new URL(req.url);
      const { pathname } = url;
      const session = sessionFromRequest(req);

      if (req.method === "GET") {
        const staticResponse = await serveStatic(pathname);
        if (staticResponse) return staticResponse;

        const aiTasksMatch = pathname.match(/^\/ai\/tasks\/(\d+)(?:\/(yes|no))?$/);
        if (aiTasksMatch) return handleAiTasks(url, aiTasksMatch);
        if (pathname === "/ai/summary/latest") return handleLatestSummary(url);
        if (pathname === "/entries") return handleGetEntries(url, session);
        if (pathname === "/entries/recent") return handleGetRecentEntries(url, session);
        if (pathname === "/measures") return handleGetMeasures(session);
        if (pathname === "/tracking") return handleGetTracking(url, session);
        if (pathname === "/tracking/timer") return handleGetActiveTimer(session);
        if (pathname === "/tracking/timers/sessions") return handleGetTimerSessions(url, session);
        if (pathname === "/") return handleHome(url, session);
      }

      if (req.method === "POST") {
        if (pathname === "/auth/login") return login(req);
        if (pathname === "/auth/logout") return logout(req);
        if (pathname === "/ai/summary") return handleSummaryPost(req);
        if (pathname === "/ai/tasks") return handleAiTasksPost(req);
        if (pathname === "/entries") return handleSaveEntry(req, session);
        if (pathname === "/measures") return handleSaveMeasure(req, session);
        if (pathname === "/tracking") return handleSaveTracking(req, session);
        if (pathname === "/tracking/timers/start") return handleStartTimer(req, session);
        if (pathname === "/tracking/timers/stop") return handleStopTimer(req, session);
        if (pathname === "/todos") return handleTodoCreate(req, session);

        const updateMatch = pathname.match(/^\/todos\/(\d+)\/update$/);
        if (updateMatch) return handleTodoUpdate(req, session, Number(updateMatch[1]));

        const stateMatch = pathname.match(/^\/todos\/(\d+)\/state$/);
        if (stateMatch) return handleTodoState(req, session, Number(stateMatch[1]));

        const deleteMatch = pathname.match(/^\/todos\/(\d+)\/delete$/);
        if (deleteMatch) return handleTodoDelete(session, Number(deleteMatch[1]));

        // Debug log endpoint for client-side logs (dev mode only)
        if (pathname === "/debug/log" && IS_DEV) {
          const body = await req.json() as { source?: string; message?: string; data?: unknown };
          const source = body.source || "client";
          const message = body.message || "";
          logDebug(source, message, body.data);
          return new Response("ok", { status: 200 });
        }
      }

      if (req.method === "DELETE") {
        const measureMatch = pathname.match(/^\/measures\/(\d+)$/);
        if (measureMatch) return handleDeleteMeasure(session, Number(measureMatch[1]));

        const trackingMatch = pathname.match(/^\/tracking\/(\d+)$/);
        if (trackingMatch) return handleDeleteTracking(session, Number(trackingMatch[1]));
      }

      return new Response("Not found", { status: 404 });
    },
    (error) => logError("Request failed", error)
  ),
});

console.log(`${APP_NAME} ready on http://localhost:${server.port}`);
