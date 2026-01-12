# Credits System Design

## Overview

Ambulando uses a credit-based access system where 1 credit = 1 day of access. Users receive 3 credits on their first login and can purchase additional credits via Lightning payments through the Mginx payment server.

## Core Concepts

### Credits
- **1 credit = 1 day of access** to record habits, track measures, etc.
- Maximum balance: `env.MAX_CREDITS` (default: 21)
- Initial grant: 3 credits on first-ever login per npub
- Future consideration: May become hourly instead of daily

### Access Control
- **With credits (balance > 0)**: Full access to all features
- **Without credits (balance = 0)**:
  - No access to record new data
  - Existing encrypted data remains in localStorage
  - Future: Add data export option (CSV/JSON) for users with no credits

## Database Schema

### `user_credits` table
Tracks current credit balance per user.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER | PK AUTOINCREMENT |
| `npub` | TEXT | UNIQUE, user identifier |
| `balance` | INTEGER | Current credit balance |
| `first_login_at` | TEXT | Timestamp of first login (when initial credits granted) |
| `created_at` | TEXT | Default CURRENT_TIMESTAMP |
| `updated_at` | TEXT | Updated on balance change |

### `credit_transactions` table
Immutable log of all credit changes.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER | PK AUTOINCREMENT |
| `npub` | TEXT | User identifier |
| `type` | TEXT | `initial_grant`, `purchase`, `daily_deduction`, `manual_adjustment` |
| `amount` | INTEGER | Positive for additions, negative for deductions |
| `balance_before` | INTEGER | Balance before this transaction |
| `balance_after` | INTEGER | Balance after this transaction |
| `reference_id` | TEXT | NULL or order_id for purchases |
| `notes` | TEXT | Optional description |
| `created_at` | TEXT | Default CURRENT_TIMESTAMP |

### `credit_orders` table
Tracks Lightning invoice orders from Mginx.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER | PK AUTOINCREMENT |
| `npub` | TEXT | User identifier |
| `mginx_order_id` | TEXT | Order ID from Mginx API |
| `quantity` | INTEGER | Number of credits/days |
| `amount_sats` | INTEGER | Total price in satoshis |
| `bolt11` | TEXT | Lightning invoice string |
| `status` | TEXT | `pending`, `paid`, `expired`, `cancelled` |
| `created_at` | TEXT | Default CURRENT_TIMESTAMP |
| `updated_at` | TEXT | Updated on status change |
| `paid_at` | TEXT | NULL until paid |

### `credit_audit_log` table
Tracks login events for reconciliation and failed job recovery.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER | PK AUTOINCREMENT |
| `npub` | TEXT | User identifier |
| `event_type` | TEXT | `login`, `cron_deduction`, `cron_failed` |
| `credits_at_event` | INTEGER | Credit balance at time of event |
| `details` | TEXT | JSON with additional context |
| `created_at` | TEXT | Default CURRENT_TIMESTAMP |

## Environment Variables

```env
# Mginx Payment Server
APIKEY_MGINX=your_api_key_here
CREDITS_ID=your_product_id_here
MGINX_URL=http://localhost:8787

# Credits Configuration
MAX_CREDITS=21
INITIAL_CREDITS=3
```

## API Endpoints

### GET `/api/credits`
Returns current credit balance and status for authenticated user.

**Response:**
```json
{
  "balance": 15,
  "maxCredits": 21,
  "canPurchase": 6,
  "hasAccess": true,
  "pricePerCredit": 100
}
```

### GET `/api/credits/history`
Returns transaction history for authenticated user.

**Response:**
```json
{
  "transactions": [
    {
      "id": 1,
      "type": "initial_grant",
      "amount": 3,
      "balance_after": 3,
      "created_at": "2025-01-10T10:00:00Z"
    },
    {
      "id": 2,
      "type": "daily_deduction",
      "amount": -1,
      "balance_after": 2,
      "created_at": "2025-01-11T00:00:00Z"
    }
  ]
}
```

### GET `/api/credits/orders`
Returns pending/unpaid orders for authenticated user.

**Response:**
```json
{
  "orders": [
    {
      "id": 1,
      "mginx_order_id": "ord_abc123",
      "quantity": 5,
      "amount_sats": 500,
      "bolt11": "lnbc...",
      "status": "pending",
      "created_at": "2025-01-10T15:30:00Z"
    }
  ]
}
```

### POST `/api/credits/purchase`
Creates a new order and returns Lightning invoice.

**Request:**
```json
{
  "quantity": 5
}
```

**Response:**
```json
{
  "order_id": "ord_abc123",
  "local_order_id": 1,
  "quantity": 5,
  "amount_sats": 500,
  "bolt11": "lnbc500n1...",
  "status": "pending"
}
```

### GET `/api/credits/order/:orderId/status`
Checks payment status of an order. If paid, credits the user.

**Response (pending):**
```json
{
  "status": "pending",
  "paid": false
}
```

**Response (paid):**
```json
{
  "status": "paid",
  "paid": true,
  "credits_added": 5,
  "new_balance": 20
}
```

## Mginx Integration

### Get Product Details
```bash
curl -X GET "http://localhost:8787/api/products/CREDITS_ID" \
  -H "Authorization: Bearer APIKEY_MGINX"
```

Response includes `price` field (sats per credit/day).

### Create Order
```bash
curl -X POST "http://localhost:8787/api/orders" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer APIKEY_MGINX" \
  -d '{"product_id": "CREDITS_ID", "quantity": 5}'
```

### Check Order Status
```bash
curl -X GET "http://localhost:8787/api/orders/ORDER_ID/status" \
  -H "Authorization: Bearer APIKEY_MGINX"
```

## Server-Side Cron Job

### Daily Credit Deduction
Runs at midnight (00:00) server time.

**Logic:**
1. Get all users with `balance > 0`
2. For each user:
   - Deduct 1 credit
   - Log transaction in `credit_transactions`
   - Log event in `credit_audit_log`
3. On failure:
   - Log failure in `credit_audit_log` with `event_type = 'cron_failed'`
   - Include error details in JSON

### Login Reconciliation
On each login, verify credit state is consistent:

1. Check `credit_audit_log` for last `login` event
2. Compare expected deductions since then vs actual balance
3. If mismatch, log warning and optionally auto-correct

## UI Components

### Avatar Menu Addition
Add "Credits: X" display and "Buy Credits" button to avatar menu.

```
┌─────────────────────┐
│ View Profile        │
│ ─────────────────── │
│ Credits: 15 days    │
│ [Buy Credits]       │
│ ─────────────────── │
│ Export Secret       │
│ Show Login QR       │
│ Copy ID             │
│ Log out             │
└─────────────────────┘
```

### Credits Purchase Modal

```
┌──────────────────────────────────────┐
│ Buy Credits                      [X] │
├──────────────────────────────────────┤
│                                      │
│ Current balance: 15 days             │
│ Price: 100 sats/day                  │
│                                      │
│ Days to purchase:                    │
│ [─────────●────] 5 days              │
│                                      │
│ Total: 500 sats                      │
│                                      │
│ [Generate Invoice]                   │
│                                      │
├──────────────────────────────────────┤
│ (After invoice generated)            │
│                                      │
│ ┌────────────────┐                   │
│ │   QR CODE      │                   │
│ │                │                   │
│ └────────────────┘                   │
│                                      │
│ ┌──────────────────────────┐ [Copy]  │
│ │ lnbc500n1pj9...          │         │
│ └──────────────────────────┘         │
│                                      │
│ Status: Waiting for payment...       │
│ [Check Payment]                      │
│                                      │
├──────────────────────────────────────┤
│ Pending Orders                       │
│ ─────────────────────────────────    │
│ 5 days - 500 sats - Jan 10 [Pay]     │
│ 3 days - 300 sats - Jan 9  [Pay]     │
└──────────────────────────────────────┘
```

### No Credits Screen
When `balance = 0`, show overlay on main content:

```
┌──────────────────────────────────────┐
│         No Credits Remaining         │
│                                      │
│  Purchase credits to continue        │
│  tracking your habits.               │
│                                      │
│  Your existing data is safely        │
│  stored locally.                     │
│                                      │
│       [Buy Credits]                  │
└──────────────────────────────────────┘
```

## Client-Side State

### Credits State (`public/credits.js`)
```javascript
// Credits state
let creditsState = {
  balance: 0,
  maxCredits: 21,
  pricePerCredit: 100,
  hasAccess: false,
  pendingOrders: []
};

// Fetch on login
async function loadCredits() { ... }

// Check before allowing actions
function requireCredits() {
  if (!creditsState.hasAccess) {
    showNoCreditsOverlay();
    return false;
  }
  return true;
}
```

### Invoice Polling
When invoice modal is open:
- Poll `/api/credits/order/:id/status` every 3 seconds
- Also provide manual "Check Payment" button
- On payment detected:
  - Update balance
  - Show success message
  - Close modal or allow further purchase

## File Changes Summary

### New Files
- `src/routes/credits.ts` - Credit API endpoints
- `src/services/credits.ts` - Credit business logic
- `src/services/mginx.ts` - Mginx API client
- `public/credits.js` - Client-side credits module
- `scripts/credit-cron.ts` - Daily deduction cron job

### Modified Files
- `src/db.ts` - Add credit tables and queries
- `src/server.ts` - Wire credit routes
- `src/types.ts` - Add credit types
- `src/render/home.ts` - Add credits modal, no-credits overlay
- `src/config.ts` - Add credit config constants
- `public/avatar.js` - Add credits display to menu
- `public/dom.js` - Add credit element references
- `public/app.js` - Initialize credits module
- `public/state.js` - Add credits to state
- `.env.example` - Document new env vars

## Security Considerations

1. **Rate limiting**: Limit order creation to prevent spam
2. **Amount validation**: Server validates quantity against MAX_CREDITS
3. **Order ownership**: Only allow users to check their own orders
4. **Mginx API key**: Never expose to client, all calls server-side
5. **Audit trail**: All credit changes logged for accountability

## Future Enhancements

1. **Data export**: Allow no-credit users to export their data
2. **Hourly credits**: Support for finer-grained access control
3. **Subscription model**: Recurring payments via Mginx
4. **Referral credits**: Grant credits for referrals
5. **Credit gifting**: Allow users to gift credits to others
