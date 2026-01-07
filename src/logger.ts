import { appendFileSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";

const SESSION_LOG_PATH = join(process.cwd(), "temp", "logs", "session.log");

// Ensure log directory exists and clear previous session logs
export function initLogs() {
  try {
    mkdirSync(dirname(SESSION_LOG_PATH), { recursive: true });
    writeFileSync(SESSION_LOG_PATH, `=== Session started at ${new Date().toISOString()} ===\n`);
  } catch (err) {
    console.error("Failed to initialize logs:", err);
  }
}

export function logInfo(message: string, meta?: Record<string, unknown>) {
  if (meta) console.info(message, meta);
  else console.info(message);
}

export function logError(message: string, error?: unknown) {
  if (error instanceof Error) {
    console.error(message, { message: error.message, stack: error.stack });
  } else {
    console.error(message, error);
  }
}

export function logDebug(source: string, message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  const line = data
    ? `[${timestamp}] [${source}] ${message} ${JSON.stringify(data)}\n`
    : `[${timestamp}] [${source}] ${message}\n`;

  // Also log to console for immediate feedback
  console.log(line.trim());

  // Append to file
  try {
    appendFileSync(SESSION_LOG_PATH, line);
  } catch (err) {
    console.error("Failed to write debug log:", err);
  }
}

export function getLogPath() {
  return SESSION_LOG_PATH;
}
