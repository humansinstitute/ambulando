import { jsonResponse, safeJson } from "../http";
import { logDebug, logError } from "../logger";
import {
  getCreditsStatus,
  initializeUserCredits,
  purchaseCredits,
  checkOrderStatus,
  getUserPendingOrders,
  getUserTransactionHistory,
  refreshPendingOrders,
} from "../services/credits";

import type { Session } from "../types";

export async function handleGetCredits(session: Session | null) {
  if (!session) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const status = await getCreditsStatus(session.npub);
  return jsonResponse(status);
}

export async function handleInitializeCredits(session: Session | null) {
  if (!session) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  // Initialize credits for user (grants initial credits on first login)
  const credits = initializeUserCredits(session.npub);

  // Also refresh any pending orders
  await refreshPendingOrders(session.npub);

  const status = await getCreditsStatus(session.npub);
  return jsonResponse({
    ...status,
    initialized: credits !== null,
  });
}

export async function handlePurchaseCredits(req: Request, session: Session | null) {
  logDebug("credits-route", "Purchase request received", { hasSession: !!session });

  if (!session) {
    logDebug("credits-route", "No session - unauthorized");
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const body = (await safeJson(req)) as { quantity?: number } | null;
  logDebug("credits-route", "Request body", body);

  if (!body || typeof body.quantity !== "number") {
    logDebug("credits-route", "Invalid body or quantity", { body, quantityType: typeof body?.quantity });
    return jsonResponse({ error: "Invalid quantity" }, 400);
  }

  logDebug("credits-route", "Calling purchaseCredits", { npub: session.npub, quantity: body.quantity });
  const result = await purchaseCredits(session.npub, body.quantity);

  if (!result.ok) {
    logError("credits-route", "Purchase failed: " + result.error);
    return jsonResponse({ error: result.error }, 400);
  }

  logDebug("credits-route", "Purchase successful", { orderId: result.order.id });
  return jsonResponse({
    order_id: result.order.id,
    mginx_order_id: result.order.mginx_order_id,
    quantity: result.order.quantity,
    amount_sats: result.order.amount_sats,
    bolt11: result.bolt11,
    status: "pending",
  });
}

export async function handleCheckOrderStatus(session: Session | null, orderId: number) {
  if (!session) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const result = await checkOrderStatus(session.npub, orderId);

  if (!result.ok) {
    return jsonResponse({ error: result.error }, 400);
  }

  return jsonResponse(result);
}

export function handleGetPendingOrders(session: Session | null) {
  if (!session) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const orders = getUserPendingOrders(session.npub);
  return jsonResponse({ orders });
}

export function handleGetTransactionHistory(session: Session | null) {
  if (!session) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const transactions = getUserTransactionHistory(session.npub);
  return jsonResponse({ transactions });
}
