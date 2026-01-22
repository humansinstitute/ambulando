export type TodoState = "new" | "ready" | "in_progress" | "done";
export type TodoPriority = "rock" | "pebble" | "sand";

export type Session = {
  token: string;
  pubkey: string;
  npub: string;
  method: LoginMethod;
  createdAt: number;
};

export type LoginMethod = "ephemeral" | "extension" | "bunker" | "secret" | "keyteleport";

// Credit system types
export type CreditTransactionType = "initial_grant" | "purchase" | "daily_deduction" | "manual_adjustment";
export type CreditOrderStatus = "pending" | "paid" | "expired" | "cancelled";
export type CreditAuditEventType = "login" | "cron_deduction" | "cron_failed";

export type UserCredits = {
  id: number;
  npub: string;
  balance: number;
  first_login_at: string;
  created_at: string;
  updated_at: string;
};

export type CreditTransaction = {
  id: number;
  npub: string;
  type: CreditTransactionType;
  amount: number;
  balance_before: number;
  balance_after: number;
  reference_id: string | null;
  notes: string | null;
  created_at: string;
};

export type CreditOrder = {
  id: number;
  npub: string;
  mginx_order_id: string;
  quantity: number;
  amount_sats: number;
  bolt11: string;
  status: CreditOrderStatus;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
};

export type CreditAuditLog = {
  id: number;
  npub: string;
  event_type: CreditAuditEventType;
  credits_at_event: number;
  details: string | null;
  created_at: string;
};
