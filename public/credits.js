import { elements as el, show, hide, setText } from "./dom.js";
import { loadQRCodeLib } from "./nostr.js";
import { state } from "./state.js";
import { closeAvatarMenu } from "./avatar.js";

// Credits state
let creditsState = {
  balance: 0,
  maxCredits: 21,
  canPurchase: 21,
  hasAccess: false,
  pricePerCredit: null,
  isFirstLogin: true,
};

let currentOrder = null;
let pollInterval = null;

// Initialize credits system
export async function initCredits() {
  if (!state.session) return;

  // Initialize credits on server (grants initial credits if first login)
  try {
    const response = await fetch("/api/credits/initialize", { method: "POST" });
    if (response.ok) {
      const data = await response.json();
      updateCreditsState(data);
    }
  } catch (err) {
    console.error("Failed to initialize credits:", err);
  }

  wireCreditsUI();
  updateCreditsDisplay();
  checkAccessState();
}

function wireCreditsUI() {
  // Buy credits button in avatar menu
  el.buyCreditsBtn?.addEventListener("click", () => {
    closeAvatarMenu();
    openCreditsModal();
  });

  // No credits overlay button
  el.noCreditsBtn?.addEventListener("click", () => {
    openCreditsModal();
  });

  // Modal close button
  el.creditsClose?.addEventListener("click", closeCreditsModal);
  el.creditsModal?.addEventListener("click", (e) => {
    if (e.target === el.creditsModal) closeCreditsModal();
  });

  // Quantity slider
  el.creditsQuantitySlider?.addEventListener("input", updateQuantityDisplay);

  // Quick select buttons
  document.querySelectorAll("[data-credits-quick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const hours = Number(btn.getAttribute("data-credits-quick"));
      if (el.creditsQuantitySlider && hours > 0) {
        el.creditsQuantitySlider.value = String(hours);
        updateQuantityDisplay();
      }
    });
  });

  // Generate invoice button
  el.creditsGenerateBtn?.addEventListener("click", generateInvoice);

  // Copy bolt11 button
  el.creditsCopyBtn?.addEventListener("click", copyBolt11);

  // Check payment button
  el.creditsCheckBtn?.addEventListener("click", checkPayment);

  // New invoice button
  el.creditsNewBtn?.addEventListener("click", resetInvoiceForm);

  // History toggle
  el.creditsHistoryToggle?.addEventListener("click", toggleHistory);
}

function updateCreditsState(data) {
  creditsState = {
    balance: data.balance ?? 0,
    maxCredits: data.maxCredits ?? 21,
    canPurchase: data.canPurchase ?? 21,
    hasAccess: data.hasAccess ?? false,
    pricePerCredit: data.pricePerCredit ?? null,
    isFirstLogin: data.isFirstLogin ?? false,
  };
}

export function updateCreditsDisplay() {
  setText(el.creditsDisplay, String(creditsState.balance));
  setText(el.creditsCurrent, String(creditsState.balance));

  if (creditsState.pricePerCredit) {
    setText(el.creditsPrice, String(creditsState.pricePerCredit));
  }

  // Update slider max to maxCredits (server sends hours)
  if (el.creditsQuantitySlider) {
    el.creditsQuantitySlider.max = String(creditsState.maxCredits);
    el.creditsQuantitySlider.value = String(Math.min(24, creditsState.maxCredits)); // Default to 1 day
  }

  updateQuantityDisplay();
}

function updateQuantityDisplay() {
  const quantity = Number(el.creditsQuantitySlider?.value ?? 5);
  setText(el.creditsQuantityValue, String(quantity));

  if (creditsState.pricePerCredit) {
    const total = quantity * creditsState.pricePerCredit;
    setText(el.creditsTotal, String(total));
  } else {
    setText(el.creditsTotal, "...");
  }
}

export function checkAccessState() {
  if (!state.session) {
    hide(el.noCreditsOverlay);
    return;
  }

  if (creditsState.hasAccess) {
    hide(el.noCreditsOverlay);
  } else {
    show(el.noCreditsOverlay);
  }
}

async function openCreditsModal() {
  if (!el.creditsModal) return;

  // Refresh credits status
  try {
    const response = await fetch("/api/credits");
    if (response.ok) {
      const data = await response.json();
      updateCreditsState(data);
      updateCreditsDisplay();
    }
  } catch (err) {
    console.error("Failed to fetch credits:", err);
  }

  // Load pending orders and history in parallel
  await Promise.all([loadPendingOrders(), loadHistory()]);

  // Show history section by default
  show(el.creditsHistory);
  setText(el.creditsHistoryToggle, "Hide History");

  // Reset to purchase form (but keep history visible)
  resetInvoiceForm(false);

  show(el.creditsModal);
  document.addEventListener("keydown", handleCreditsEscape);
}

function closeCreditsModal() {
  hide(el.creditsModal);
  document.removeEventListener("keydown", handleCreditsEscape);
  stopPolling();
}

function handleCreditsEscape(e) {
  if (e.key === "Escape") closeCreditsModal();
}

async function generateInvoice() {
  const quantity = Number(el.creditsQuantitySlider?.value ?? 1);

  if (quantity < 1 || quantity > creditsState.maxCredits) {
    setText(el.creditsStatus, "Invalid quantity");
    return;
  }

  setText(el.creditsStatus, "Generating invoice...");
  el.creditsGenerateBtn?.setAttribute("disabled", "disabled");

  try {
    const response = await fetch("/api/credits/purchase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity }),
    });

    const data = await response.json();

    if (!response.ok) {
      setText(el.creditsStatus, data.error || "Failed to generate invoice");
      el.creditsGenerateBtn?.removeAttribute("disabled");
      return;
    }

    currentOrder = {
      id: data.order_id,
      quantity: data.quantity,
      amount_sats: data.amount_sats,
      bolt11: data.bolt11,
    };

    await showInvoice(data.bolt11);
    setText(el.creditsStatus, "Waiting for payment...");

    // Start polling for payment
    startPolling();

    // Refresh pending orders
    await loadPendingOrders();
  } catch (err) {
    console.error("Failed to generate invoice:", err);
    setText(el.creditsStatus, "Failed to generate invoice");
  } finally {
    el.creditsGenerateBtn?.removeAttribute("disabled");
  }
}

async function showInvoice(bolt11) {
  hide(el.creditsPurchaseForm);
  show(el.creditsInvoice);

  // Set bolt11 input
  if (el.creditsBolt11) {
    el.creditsBolt11.value = bolt11;
  }

  // Generate QR code
  if (el.creditsQr) {
    el.creditsQr.innerHTML = "";
    try {
      const QRCode = await loadQRCodeLib();
      const canvas = document.createElement("canvas");
      // Lightning invoices should be uppercase for QR efficiency
      await QRCode.toCanvas(canvas, bolt11.toUpperCase(), { width: 256, margin: 2 });
      el.creditsQr.appendChild(canvas);
    } catch (err) {
      console.error("Failed to generate QR code:", err);
      el.creditsQr.innerHTML = "<p>Failed to generate QR code</p>";
    }
  }
}

function resetInvoiceForm(hideHistory = true) {
  currentOrder = null;
  stopPolling();

  show(el.creditsPurchaseForm);
  hide(el.creditsInvoice);
  if (hideHistory) {
    hide(el.creditsHistory);
    setText(el.creditsHistoryToggle, "Show History");
  }

  setText(el.creditsStatus, "");
  if (el.creditsQr) el.creditsQr.innerHTML = "";
  if (el.creditsBolt11) el.creditsBolt11.value = "";

  el.creditsGenerateBtn?.removeAttribute("disabled");
  updateQuantityDisplay();
}

async function copyBolt11() {
  const bolt11 = el.creditsBolt11?.value;
  if (!bolt11) return;

  try {
    await navigator.clipboard.writeText(bolt11);
    setText(el.creditsCopyBtn, "Copied!");
    setTimeout(() => setText(el.creditsCopyBtn, "Copy"), 2000);
  } catch (err) {
    console.error("Failed to copy:", err);
  }
}

async function checkPayment() {
  if (!currentOrder) return;

  setText(el.creditsStatus, "Checking payment...");

  try {
    const response = await fetch(`/api/credits/order/${currentOrder.id}/status`);
    const data = await response.json();

    if (!response.ok) {
      setText(el.creditsStatus, data.error || "Failed to check payment");
      return;
    }

    if (data.paid) {
      handlePaymentSuccess(data);
    } else if (data.status === "expired") {
      setText(el.creditsStatus, "Invoice expired. Please generate a new one.");
      stopPolling();
    } else {
      setText(el.creditsStatus, "Waiting for payment...");
    }
  } catch (err) {
    console.error("Failed to check payment:", err);
    setText(el.creditsStatus, "Failed to check payment");
  }
}

function handlePaymentSuccess(data) {
  stopPolling();

  creditsState.balance = data.newBalance ?? creditsState.balance + (data.creditsAdded ?? 0);
  creditsState.hasAccess = creditsState.balance > 0;
  creditsState.canPurchase = creditsState.maxCredits - creditsState.balance;

  updateCreditsDisplay();
  checkAccessState();

  setText(el.creditsStatus, `Payment received! Added ${data.creditsAdded} hours.`);

  // Update pending orders and history to show the new transaction
  loadPendingOrders();
  loadHistory();

  // Reset to purchase form after a delay, but keep history visible
  setTimeout(() => {
    if (el.creditsModal && !el.creditsModal.hasAttribute("hidden")) {
      resetInvoiceForm(false); // Keep history visible
      show(el.creditsHistory);
    }
  }, 3000);
}

function startPolling() {
  stopPolling();
  pollInterval = setInterval(checkPayment, 3000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

async function loadPendingOrders() {
  if (!el.creditsPendingList) return;

  try {
    const response = await fetch("/api/credits/orders");
    if (!response.ok) return;

    const data = await response.json();
    const orders = data.orders || [];

    if (orders.length === 0) {
      el.creditsPendingList.innerHTML = "<p class='no-pending'>No pending orders</p>";
      return;
    }

    el.creditsPendingList.innerHTML = orders
      .map(
        (order) => `
        <div class="pending-order" data-order-id="${order.id}">
          <span class="pending-details">${order.quantity} hours - ${order.amount_sats} sats</span>
          <span class="pending-date">${formatDate(order.created_at)}</span>
          <button type="button" class="pending-pay-btn" data-pay-order="${order.id}">Pay</button>
        </div>
      `
      )
      .join("");

    // Wire up pay buttons
    el.creditsPendingList.querySelectorAll("[data-pay-order]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const orderId = Number(btn.getAttribute("data-pay-order"));
        payPendingOrder(orderId);
      });
    });
  } catch (err) {
    console.error("Failed to load pending orders:", err);
  }
}

async function payPendingOrder(orderId) {
  // Find the order in the pending list
  try {
    const response = await fetch("/api/credits/orders");
    if (!response.ok) return;

    const data = await response.json();
    const order = data.orders?.find((o) => o.id === orderId);

    if (!order) {
      console.error("Order not found:", orderId);
      return;
    }

    currentOrder = {
      id: order.id,
      quantity: order.quantity,
      amount_sats: order.amount_sats,
      bolt11: order.bolt11,
    };

    await showInvoice(order.bolt11);
    setText(el.creditsStatus, "Waiting for payment...");
    startPolling();
  } catch (err) {
    console.error("Failed to load order:", err);
  }
}

async function toggleHistory() {
  if (!el.creditsHistory) return;

  if (el.creditsHistory.hasAttribute("hidden")) {
    // Load and show history
    await loadHistory();
    show(el.creditsHistory);
    setText(el.creditsHistoryToggle, "Hide History");
  } else {
    hide(el.creditsHistory);
    setText(el.creditsHistoryToggle, "Show History");
  }
}

async function loadHistory() {
  if (!el.creditsHistoryList) return;

  try {
    const response = await fetch("/api/credits/history");
    if (!response.ok) return;

    const data = await response.json();
    const transactions = data.transactions || [];

    if (transactions.length === 0) {
      el.creditsHistoryList.innerHTML = "<p class='no-history'>No transaction history</p>";
      return;
    }

    el.creditsHistoryList.innerHTML = transactions
      .map(
        (tx) => `
        <div class="history-item ${tx.amount >= 0 ? "credit" : "debit"}">
          <span class="history-type">${formatTxType(tx.type)}</span>
          <span class="history-amount">${tx.amount >= 0 ? "+" : ""}${tx.amount}</span>
          <span class="history-date">${formatDate(tx.created_at)}</span>
        </div>
      `
      )
      .join("");
  } catch (err) {
    console.error("Failed to load history:", err);
  }
}

function formatTxType(type) {
  switch (type) {
    case "initial_grant":
      return "Welcome bonus";
    case "purchase":
      return "Purchase";
    case "hourly_deduction":
      return "Hourly access";
    case "daily_deduction":
      return "Daily access"; // Legacy
    case "manual_adjustment":
      return "Adjustment";
    default:
      return type;
  }
}

function formatDate(dateStr) {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString();
  } catch {
    return dateStr;
  }
}

// Export for external access
export function hasCredits() {
  return creditsState.hasAccess;
}

export function getCreditsBalance() {
  return creditsState.balance;
}

// Cleanup on logout
export function clearCredits() {
  creditsState = {
    balance: 0,
    maxCredits: 21,
    canPurchase: 21,
    hasAccess: false,
    pricePerCredit: null,
    isFirstLogin: true,
  };
  currentOrder = null;
  stopPolling();
  hide(el.noCreditsOverlay);
}
