// Server-Sent Events manager for per-user real-time updates

type SSEConnection = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  npub: string;
};

// Store connections by npub (user can have multiple tabs open)
const connections = new Map<string, Set<SSEConnection>>();

// Event types that can be broadcast
export type SSEEventType = "measures" | "tracking" | "timers";

export type SSEEvent = {
  type: SSEEventType;
  action: "created" | "updated" | "deleted";
  id?: number;
};

/**
 * Register a new SSE connection for a user
 */
export function addConnection(npub: string, controller: ReadableStreamDefaultController<Uint8Array>): SSEConnection {
  const conn: SSEConnection = { controller, npub };

  if (!connections.has(npub)) {
    connections.set(npub, new Set());
  }
  connections.get(npub)!.add(conn);

  return conn;
}

/**
 * Remove an SSE connection when client disconnects
 */
export function removeConnection(conn: SSEConnection): void {
  const userConns = connections.get(conn.npub);
  if (userConns) {
    userConns.delete(conn);
    if (userConns.size === 0) {
      connections.delete(conn.npub);
    }
  }
}

/**
 * Broadcast an event to all connections for a specific user
 */
export function broadcast(npub: string, event: SSEEvent): void {
  const userConns = connections.get(npub);
  if (!userConns || userConns.size === 0) return;

  const data = `data: ${JSON.stringify(event)}\n\n`;
  const encoder = new TextEncoder();
  const encoded = encoder.encode(data);

  // Send to all connections for this user
  for (const conn of userConns) {
    try {
      conn.controller.enqueue(encoded);
    } catch (_err) {
      // Connection likely closed, remove it
      removeConnection(conn);
    }
  }
}

/**
 * Get connection count for debugging
 */
export function getConnectionCount(npub?: string): number {
  if (npub) {
    return connections.get(npub)?.size || 0;
  }
  let total = 0;
  for (const conns of connections.values()) {
    total += conns.size;
  }
  return total;
}
