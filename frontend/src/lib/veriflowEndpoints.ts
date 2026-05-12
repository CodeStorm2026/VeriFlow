/**
 * Resolve HTTP API and WebSocket URLs for the browser.
 *
 * Priority:
 * 1. In Vite dev (`import.meta.env.DEV`), same-origin `/__veriflow` (Vite → websocket-api) unless
 *    `VITE_VERIFLOW_DIRECT_API=true` (then use env / host:8001 below). This avoids broken setups
 *    where `.env` still sets `VITE_API_URL=http://localhost:8001` while the API is only reachable
 *    via the dev proxy inside Docker.
 * 2. `VITE_API_URL` / `VITE_WS_URL` when set (CI, production, or direct dev).
 * 3. Otherwise same hostname as the page + port 8001 (static build / LAN).
 */
const DEFAULT_API_PORT = "8001";

function useDirectApiInDev(): boolean {
  return (import.meta.env.VITE_VERIFLOW_DIRECT_API as string | undefined)?.trim() === "true";
}

function apiPort(): string {
  const p = (import.meta.env.VITE_API_PORT as string | undefined)?.trim();
  return p && /^\d+$/.test(p) ? p : DEFAULT_API_PORT;
}

export function resolveApiBaseUrl(): string {
  if (import.meta.env.DEV && typeof window !== "undefined" && !useDirectApiInDev()) {
    const proto = window.location.protocol === "https:" ? "https:" : "http:";
    return `${proto}//${window.location.host}/__veriflow`;
  }

  const fromEnv = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }
  if (typeof window === "undefined") {
    return `http://127.0.0.1:${apiPort()}`;
  }
  const proto = window.location.protocol === "https:" ? "https:" : "http:";
  return `${proto}//${window.location.hostname}:${apiPort()}`;
}

export function resolveWebSocketUrl(): string {
  if (import.meta.env.DEV && typeof window !== "undefined" && !useDirectApiInDev()) {
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${wsProto}//${window.location.host}/__veriflow/ws`;
  }

  const fromEnv = (import.meta.env.VITE_WS_URL as string | undefined)?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  if (typeof window === "undefined") {
    return `ws://127.0.0.1:${apiPort()}/ws`;
  }
  const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProto}//${window.location.hostname}:${apiPort()}/ws`;
}
