import { appendFileSync } from "fs";
import { join } from "path";

const DEBUG_LOG_PATH = join(process.cwd(), "debug.log");

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
    appendFileSync(DEBUG_LOG_PATH, line);
  } catch (err) {
    console.error("Failed to write debug log:", err);
  }
}

export function getDebugLogPath() {
  return DEBUG_LOG_PATH;
}
