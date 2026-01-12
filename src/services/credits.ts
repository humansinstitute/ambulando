import { MAX_CREDITS, INITIAL_CREDITS } from "../config";
import {
  getUserCredits,
  createUserCredits,
  updateUserCreditsBalance,
  addCreditTransaction,
  getCreditTransactions,
  createCreditOrder,
  getCreditOrderById,
  getPendingOrders,
  updateCreditOrderStatus,
  addCreditAuditLog,
  getAllUsersWithCredits,
  withCreditTransaction,
} from "../db";
import { logDebug, logError } from "../logger";

import { mginxClient } from "./mginx";

import type { UserCredits, CreditOrder, CreditTransaction } from "../db";

export type CreditsStatus = {
  balance: number;
  maxCredits: number;
  canPurchase: number;
  hasAccess: boolean;
  pricePerCredit: number | null;
  isFirstLogin: boolean;
};

export type PurchaseResult =
  | {
      ok: true;
      order: CreditOrder;
      bolt11: string;
    }
  | { ok: false; error: string };

export type OrderCheckResult =
  | {
      ok: true;
      status: "pending" | "paid" | "expired";
      paid: boolean;
      creditsAdded?: number;
      newBalance?: number;
    }
  | { ok: false; error: string };

// Cache for product price (refresh every 5 minutes)
let cachedPrice: number | null = null;
let priceCacheTime = 0;
const PRICE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getProductPrice(): Promise<number | null> {
  const now = Date.now();
  if (cachedPrice !== null && now - priceCacheTime < PRICE_CACHE_TTL) {
    return cachedPrice;
  }

  const result = await mginxClient.getProduct();
  if (result.ok) {
    cachedPrice = result.product.priceSats;
    priceCacheTime = now;
    logDebug("credits", `Product price cached: ${cachedPrice} sats`);
    return cachedPrice;
  }

  logError("Failed to fetch product price", result.error);
  return cachedPrice; // Return stale cache if available
}

export async function getCreditsStatus(npub: string): Promise<CreditsStatus> {
  const credits = getUserCredits(npub);
  const price = await getProductPrice();

  if (!credits) {
    // User hasn't logged in yet (no credit record)
    return {
      balance: 0,
      maxCredits: MAX_CREDITS, // Max hours per purchase
      canPurchase: MAX_CREDITS,
      hasAccess: false,
      pricePerCredit: price,
      isFirstLogin: true,
    };
  }

  return {
    balance: credits.balance,
    maxCredits: MAX_CREDITS, // Max hours per purchase
    canPurchase: MAX_CREDITS,
    hasAccess: credits.balance > 0,
    pricePerCredit: price,
    isFirstLogin: false,
  };
}

export function initializeUserCredits(npub: string): UserCredits | null {
  // Check if user already has credits
  const existing = getUserCredits(npub);
  if (existing) {
    logDebug("credits", `User ${npub} already has credits: ${existing.balance}`);
    // Log the login audit event
    addCreditAuditLog(npub, "login", existing.balance, JSON.stringify({ existing: true }));
    return existing;
  }

  // First time user - grant initial credits
  logDebug("credits", `Initializing credits for new user ${npub} with ${INITIAL_CREDITS} credits`);

  return withCreditTransaction(() => {
    const credits = createUserCredits(npub, INITIAL_CREDITS);
    if (!credits) {
      logError("Failed to create user credits", npub);
      return null;
    }

    // Log the initial grant transaction
    addCreditTransaction(npub, "initial_grant", INITIAL_CREDITS, 0, INITIAL_CREDITS, null, "Welcome bonus");

    // Log the login audit event
    addCreditAuditLog(npub, "login", INITIAL_CREDITS, JSON.stringify({ firstLogin: true }));

    return credits;
  });
}

export async function purchaseCredits(npub: string, quantity: number): Promise<PurchaseResult> {
  logDebug("credits", `purchaseCredits called`, { npub, quantity });

  // Validate quantity (max per purchase, not total balance)
  if (quantity < 1) {
    logDebug("credits", "Quantity validation failed: less than 1");
    return { ok: false, error: "Quantity must be at least 1" };
  }

  if (quantity > MAX_CREDITS) {
    logDebug("credits", "Quantity exceeds max per purchase", { quantity, maxCredits: MAX_CREDITS });
    return {
      ok: false,
      error: `Cannot purchase more than ${MAX_CREDITS} hours at a time`,
    };
  }

  // Check if Mginx is configured
  if (!mginxClient.isConfigured()) {
    logError("Mginx not configured", {
      hasApiKey: !!process.env.APIKEY_MGINX,
      hasProductId: !!process.env.CREDITS_ID
    });
    return { ok: false, error: "Payment system not configured. Please contact support." };
  }

  // Get price
  logDebug("credits", "Fetching product price...");
  const price = await getProductPrice();
  logDebug("credits", "Product price result", { price });
  if (!price) {
    return { ok: false, error: "Unable to fetch product price. Please try again." };
  }

  // Create order with Mginx
  logDebug("credits", "Creating order with Mginx...", { quantity });
  const orderResult = await mginxClient.createOrder(quantity);
  logDebug("credits", "Mginx order result", { ok: orderResult.ok, error: orderResult.ok ? undefined : orderResult.error });
  if (!orderResult.ok) {
    return { ok: false, error: orderResult.error };
  }

  const mginxOrder = orderResult.order;
  logDebug("credits", "Mginx order created", { orderId: mginxOrder.id, amount: mginxOrder.amount });

  // Store order locally
  const localOrder = createCreditOrder(
    npub,
    mginxOrder.id,
    quantity,
    mginxOrder.amount,
    mginxOrder.bolt11
  );

  if (!localOrder) {
    logError("Failed to save order locally", { npub, mginxOrderId: mginxOrder.id });
    return { ok: false, error: "Failed to save order locally" };
  }

  logDebug("credits", `Created order ${localOrder.id} for ${npub}: ${quantity} credits @ ${mginxOrder.amount} sats`);

  return {
    ok: true,
    order: localOrder,
    bolt11: mginxOrder.bolt11,
  };
}

export async function checkOrderStatus(npub: string, orderId: number): Promise<OrderCheckResult> {
  // Get local order
  const order = getCreditOrderById(orderId, npub);
  if (!order) {
    return { ok: false, error: "Order not found" };
  }

  // If already paid, return immediately
  if (order.status === "paid") {
    return { ok: true, status: "paid", paid: true };
  }

  // Check with Mginx
  const statusResult = await mginxClient.getOrderStatus(order.mginx_order_id);
  if (!statusResult.ok) {
    return { ok: false, error: statusResult.error };
  }

  const mginxStatus = statusResult.status;

  // Update local status if changed
  if (mginxStatus.status !== order.status) {
    updateCreditOrderStatus(order.id, mginxStatus.status);
  }

  // If paid, credit the user
  if (mginxStatus.status === "paid" && order.status !== "paid") {
    const result = creditUserForOrder(npub, order);
    if (result) {
      return {
        ok: true,
        status: "paid",
        paid: true,
        creditsAdded: order.quantity,
        newBalance: result.balance,
      };
    }
  }

  return {
    ok: true,
    status: mginxStatus.status,
    paid: mginxStatus.status === "paid",
  };
}

function creditUserForOrder(npub: string, order: CreditOrder): UserCredits | null {
  return withCreditTransaction(() => {
    let credits = getUserCredits(npub);
    const balanceBefore = credits?.balance ?? 0;
    const balanceAfter = balanceBefore + order.quantity;

    if (!credits) {
      // Create user if doesn't exist (shouldn't happen normally)
      credits = createUserCredits(npub, balanceAfter);
    } else {
      credits = updateUserCreditsBalance(npub, balanceAfter);
    }

    if (!credits) {
      logError("Failed to credit user", { npub, order: order.id });
      return null;
    }

    // Log transaction
    addCreditTransaction(
      npub,
      "purchase",
      order.quantity,
      balanceBefore,
      balanceAfter,
      order.mginx_order_id,
      `Purchased ${order.quantity} hours for ${order.amount_sats} sats`
    );

    // Update order status
    updateCreditOrderStatus(order.id, "paid");

    logDebug("credits", `Credited ${order.quantity} credits to ${npub}. New balance: ${balanceAfter}`);

    return credits;
  });
}

export function getUserPendingOrders(npub: string): CreditOrder[] {
  return getPendingOrders(npub);
}

export function getUserTransactionHistory(npub: string, limit = 50): CreditTransaction[] {
  return getCreditTransactions(npub, limit);
}

// Track last deduction hour to prevent duplicates from multiple scheduled jobs
let lastDeductionHour: string | null = null;

// Hourly deduction cron job
export function runHourlyDeduction(): { success: number; failed: number; skipped: number; errors: string[] } {
  const currentHour = new Date().toISOString().slice(0, 13); // "2026-01-12T09"

  // Prevent duplicate runs in the same hour
  if (lastDeductionHour === currentHour) {
    console.log(`[credits-cron] Skipping duplicate deduction for hour ${currentHour}`);
    return { success: 0, failed: 0, skipped: 0, errors: [] };
  }
  lastDeductionHour = currentHour;

  const users = getAllUsersWithCredits();
  let success = 0;
  let failed = 0;
  let skipped = 0;
  const errors: string[] = [];

  console.log(`[credits-cron] Starting hourly deduction for ${users.length} users at ${currentHour}`);
  logDebug("credits-cron", `Starting hourly deduction for ${users.length} users`);

  for (const user of users) {
    try {
      const result = deductHourlyCredit(user.npub);
      if (result) {
        console.log(`[credits-cron] Deducted 1 credit from ${user.npub.slice(0, 20)}... (${result.balance + 1} -> ${result.balance})`);
        success++;
      } else if (user.balance <= 0) {
        console.log(`[credits-cron] Skipped ${user.npub.slice(0, 20)}... (balance: ${user.balance})`);
        skipped++;
      } else {
        failed++;
        errors.push(`Failed to deduct from ${user.npub}`);
      }
    } catch (error) {
      failed++;
      const msg = error instanceof Error ? error.message : "Unknown error";
      errors.push(`Error deducting from ${user.npub}: ${msg}`);
      console.error(`[credits-cron] Error deducting from ${user.npub.slice(0, 20)}...: ${msg}`);
      logError("Hourly deduction error", { npub: user.npub, error });

      // Log the failure in audit
      addCreditAuditLog(user.npub, "cron_failed", user.balance, JSON.stringify({ error: msg }));
    }
  }

  console.log(`[credits-cron] Deduction complete: ${success} success, ${skipped} skipped, ${failed} failed`);
  logDebug("credits-cron", `Hourly deduction complete: ${success} success, ${skipped} skipped, ${failed} failed`);

  return { success, failed, skipped, errors };
}

function deductHourlyCredit(npub: string): UserCredits | null {
  return withCreditTransaction(() => {
    const credits = getUserCredits(npub);
    if (!credits || credits.balance <= 0) {
      return null;
    }

    const balanceBefore = credits.balance;
    const balanceAfter = balanceBefore - 1;

    const updated = updateUserCreditsBalance(npub, balanceAfter);
    if (!updated) {
      return null;
    }

    // Log transaction
    addCreditTransaction(npub, "hourly_deduction", -1, balanceBefore, balanceAfter, null, "Hourly access deduction");

    // Log audit
    addCreditAuditLog(npub, "cron_deduction", balanceAfter, JSON.stringify({ deducted: 1 }));

    return updated;
  });
}

// Check and refresh pending orders (call on login to update any that may have been paid)
export async function refreshPendingOrders(npub: string): Promise<void> {
  const pending = getPendingOrders(npub);

  for (const order of pending) {
    try {
      await checkOrderStatus(npub, order.id);
    } catch (error) {
      logError("Error refreshing order status", { orderId: order.id, error });
    }
  }
}
