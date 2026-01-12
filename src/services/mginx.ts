import { MGINX_URL, MGINX_API_KEY, MGINX_CREDITS_PRODUCT_ID } from "../config";
import { logDebug, logError } from "../logger";

export type MginxProduct = {
  id: string;
  name: string;
  description: string;
  priceSats: number; // sats per unit
  active: boolean;
};

export type MginxProductResponse = {
  product: MginxProduct;
};

// Raw API response for order creation (not wrapped)
export type MginxOrderResponse = {
  order_id: string;
  invoice: string;
  amount_sats: number;
  status: "pending" | "paid" | "expired";
  expires_at: number;
  product_name: string;
};

// Normalized order type used internally
export type MginxOrder = {
  id: string;
  amount: number;
  bolt11: string;
  status: "pending" | "paid" | "expired";
};

export type MginxOrderStatus = {
  id: string;
  status: "pending" | "paid" | "expired";
  paid_at?: string;
};

class MginxClient {
  private baseUrl: string;
  private apiKey: string;
  private productId: string;

  constructor() {
    this.baseUrl = MGINX_URL;
    this.apiKey = MGINX_API_KEY;
    this.productId = MGINX_CREDITS_PRODUCT_ID;
    console.log(`[mginx] MginxClient initialized: baseUrl=${this.baseUrl}, hasApiKey=${!!this.apiKey}, productId=${this.productId || "(not set)"}`);
    logDebug("mginx", "MginxClient initialized", {
      baseUrl: this.baseUrl,
      hasApiKey: !!this.apiKey,
      apiKeyLength: this.apiKey?.length || 0,
      productId: this.productId || "(not set)",
    });
  }

  private async fetch<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    if (!this.apiKey) {
      return { ok: false, error: "Mginx API key not configured" };
    }

    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    };

    try {
      console.log(`[mginx] Request: ${options.method || "GET"} ${url}`);
      logDebug("mginx", `Request: ${options.method || "GET"} ${url}`);
      const response = await fetch(url, { ...options, headers });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[mginx] API error: ${response.status} - ${errorText}`);
        logError(`Mginx API error: ${response.status}`, errorText);
        return { ok: false, error: `API error: ${response.status} - ${errorText}` };
      }

      const data = (await response.json()) as T;
      console.log(`[mginx] Response OK:`, JSON.stringify(data).slice(0, 200));
      logDebug("mginx", "Response:", data);
      return { ok: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[mginx] Fetch error: ${message}`, error);
      logError("Mginx fetch error", error);
      return { ok: false, error: message };
    }
  }

  async getProduct(): Promise<{ ok: true; product: MginxProduct } | { ok: false; error: string }> {
    if (!this.productId) {
      return { ok: false, error: "Mginx product ID not configured" };
    }

    const result = await this.fetch<MginxProductResponse>(`/api/products/${this.productId}`);
    if (!result.ok) return result;
    return { ok: true, product: result.data.product };
  }

  async createOrder(
    quantity: number
  ): Promise<{ ok: true; order: MginxOrder } | { ok: false; error: string }> {
    if (!this.productId) {
      return { ok: false, error: "Mginx product ID not configured" };
    }

    if (quantity < 1) {
      return { ok: false, error: "Quantity must be at least 1" };
    }

    const result = await this.fetch<MginxOrderResponse>("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        product_id: this.productId,
        quantity,
      }),
    });

    if (!result.ok) return result;

    // Normalize the response to our internal format
    const order: MginxOrder = {
      id: result.data.order_id,
      amount: result.data.amount_sats,
      bolt11: result.data.invoice,
      status: result.data.status,
    };
    return { ok: true, order };
  }

  async getOrderStatus(
    orderId: string
  ): Promise<{ ok: true; status: MginxOrderStatus } | { ok: false; error: string }> {
    if (!orderId) {
      return { ok: false, error: "Order ID required" };
    }

    const result = await this.fetch<MginxOrderStatus>(`/api/orders/${orderId}/status`);
    if (!result.ok) return result;
    return { ok: true, status: result.data };
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.productId);
  }
}

// Export singleton instance
export const mginxClient = new MginxClient();
