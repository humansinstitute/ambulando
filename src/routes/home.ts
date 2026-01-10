import { renderHomePage } from "../render/home";

import type { Session } from "../types";

export type TabName = "daily" | "timers" | "measures" | "results";

export function handleHome(_url: URL, session: Session | null, initialTab: TabName = "daily") {
  const page = renderHomePage({ session, initialTab });
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
