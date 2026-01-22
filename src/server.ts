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
import {
  handleGetCredits,
  handleInitializeCredits,
  handlePurchaseCredits,
  handleCheckOrderStatus,
  handleGetPendingOrders,
  handleGetTransactionHistory,
} from "./routes/credits";
import { handleGetEntries, handleGetRecentEntries, handleSaveEntry } from "./routes/entries";
import { handleHome, type TabName } from "./routes/home";
import { handleKeyTeleport } from "./routes/keyteleport";
import { handleSyncPull, handleSyncPush } from "./routes/sync";
import { handleTodoCreate, handleTodoDelete, handleTodoState, handleTodoUpdate } from "./routes/todos";
import {
  handleGetMeasures,
  handleSaveMeasure,
  handleDeleteMeasure,
  handleReorderMeasures,
  handleGetTracking,
  handleSaveTracking,
  handleDeleteTracking,
  handleGetActiveTimer,
  handleGetTimerSessions,
  handleStartTimer,
  handleStopTimer,
} from "./routes/tracking";
import { AuthService } from "./services/auth";
import { runHourlyDeduction } from "./services/credits";
import { addConnection, removeConnection } from "./sse";
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
        if (pathname === "/api/measures") return handleGetMeasures(session);
        if (pathname === "/tracking") return handleGetTracking(url, session);
        if (pathname === "/tracking/timer") return handleGetActiveTimer(session);
        if (pathname === "/tracking/timers/sessions") return handleGetTimerSessions(url, session);

        // Sync endpoint for Dexie client
        if (pathname === "/sync") return handleSyncPull(url, session);

        // Credit endpoints
        if (pathname === "/api/credits") return handleGetCredits(session);
        if (pathname === "/api/credits/orders") return handleGetPendingOrders(session);
        if (pathname === "/api/credits/history") return handleGetTransactionHistory(session);
        const orderStatusMatch = pathname.match(/^\/api\/credits\/order\/(\d+)\/status$/);
        if (orderStatusMatch) return handleCheckOrderStatus(session, Number(orderStatusMatch[1]));

        // SSE endpoint for real-time updates
        if (pathname === "/events") {
          if (!session) {
            return new Response("Unauthorized", { status: 401 });
          }

          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              // Register this connection
              const conn = addConnection(session.npub, controller);

              // Send initial connection confirmation
              const encoder = new TextEncoder();
              controller.enqueue(encoder.encode(": connected\n\n"));

              // Keep-alive ping every 30 seconds
              const pingInterval = setInterval(() => {
                try {
                  controller.enqueue(encoder.encode(": ping\n\n"));
                } catch (_err) {
                  clearInterval(pingInterval);
                }
              }, 30000);

              // Cleanup on close - store interval on request for cleanup
              req.signal.addEventListener("abort", () => {
                clearInterval(pingInterval);
                removeConnection(conn);
              });
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive",
            },
          });
        }

        // Tab routes - all serve the same page with different initial tab
        // Handle /daily/:date pattern (e.g., /daily/2024-01-10)
        const dailyDateMatch = pathname.match(/^\/daily\/(\d{4}-\d{2}-\d{2})$/);
        if (dailyDateMatch) {
          return handleHome(url, session, "daily", dailyDateMatch[1]);
        }

        const tabRoutes: Record<string, TabName> = {
          "/": "daily",
          "/daily": "daily",
          "/timers": "timers",
          "/measures": "measures",
          "/results": "results",
        };
        const tabName = tabRoutes[pathname];
        if (tabName !== undefined) return handleHome(url, session, tabName);
      }

      if (req.method === "POST") {
        if (pathname === "/auth/login") return login(req);
        if (pathname === "/auth/logout") return logout(req);
        if (pathname === "/ai/summary") return handleSummaryPost(req);
        if (pathname === "/ai/tasks") return handleAiTasksPost(req);
        if (pathname === "/entries") return handleSaveEntry(req, session);
        if (pathname === "/api/measures") return handleSaveMeasure(req, session);
        if (pathname === "/api/measures/reorder") return handleReorderMeasures(req, session);
        if (pathname === "/tracking") return handleSaveTracking(req, session);
        if (pathname === "/tracking/timers/start") return handleStartTimer(req, session);
        if (pathname === "/tracking/timers/stop") return handleStopTimer(req, session);
        if (pathname === "/sync") return handleSyncPush(req, session);
        if (pathname === "/api/credits/initialize") return handleInitializeCredits(session);
        if (pathname === "/api/credits/purchase") return handlePurchaseCredits(req, session);
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

        // Key Teleport endpoint (no session required - this is for login)
        if (pathname === "/api/keyteleport") {
          return handleKeyTeleport(req);
        }
      }

      if (req.method === "DELETE") {
        const measureMatch = pathname.match(/^\/api\/measures\/(\d+)$/);
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

// Hourly credit deduction cron job
// Runs at the top of each hour
function scheduleHourlyDeduction() {
  const now = new Date();
  const nextHour = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours() + 1,
    0, 0, 0
  ));
  const msUntilNextHour = nextHour.getTime() - now.getTime();

  console.log(`Credit deduction scheduled for ${nextHour.toISOString()} (in ${Math.round(msUntilNextHour / 1000 / 60)} minutes)`);

  // Schedule first run at next hour
  setTimeout(() => {
    runDeductionAndScheduleNext();
  }, msUntilNextHour);
}

function runDeductionAndScheduleNext() {
  console.log("Running hourly credit deduction...");
  try {
    const result = runHourlyDeduction();
    console.log(`Credit deduction complete: ${result.success} success, ${result.failed} failed`);
    if (result.errors.length > 0) {
      console.error("Deduction errors:", result.errors);
    }
  } catch (error) {
    console.error("Credit deduction cron failed:", error);
  }

  // Schedule next run in 1 hour
  setTimeout(runDeductionAndScheduleNext, 60 * 60 * 1000);
}

// Start the cron scheduler
scheduleHourlyDeduction();
