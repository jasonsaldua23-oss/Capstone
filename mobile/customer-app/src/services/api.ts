import { API_BASE_URL } from "../config/env";

interface ApiOptions extends RequestInit {
  token?: string | null;
  timeoutMs?: number;
  cacheTtlMs?: number;
}

const DEFAULT_API_CACHE_TTL_MS = 15_000;
const REFERENCE_API_CACHE_TTL_MS = 5 * 60_000;
const responseCache = new Map<string, { payload: unknown; expiresAt: number }>();
const inFlightReads = new Map<string, Promise<unknown>>();
let cacheGeneration = 0;

function clonePayload<T>(payload: T): T {
  return JSON.parse(JSON.stringify(payload)) as T;
}

function getCacheTtl(path: string, override?: number): number {
  if (override !== undefined) return Math.max(0, override);
  if (/^\/api\/(?:auth\/|notifications|customer\/tracking|driver\/location)/.test(path)) return 0;
  if (/^\/api\/(?:products|warehouses|roles|vehicles)(?:[/?]|$)/.test(path)) return REFERENCE_API_CACHE_TTL_MS;
  return DEFAULT_API_CACHE_TTL_MS;
}

export function clearApiCache(): void {
  cacheGeneration += 1;
  responseCache.clear();
  inFlightReads.clear();
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Endpoints that send email do a full SMTP round trip to Gmail inside the request:
// the handshake alone is ~3s before AUTH and the send, and the whole call measures
// 7-9s against this backend. The 15s default above is sized for ordinary JSON calls
// and left so little headroom that a send which actually SUCCEEDED was aborted at
// 15s and reported to the user as "The request timed out." Give those calls their
// own budget. The backend caps its own SMTP wait (EMAIL_TIMEOUT), so a genuine
// failure still comes back as a real error well before this fires.
export const MAIL_REQUEST_TIMEOUT_MS = 30_000;

// Measured against this backend on 31 Aug 2026, POST /api/auth/customer/login,
// identical requests back to back: 3.4s, 4.1s, 4.9s, 5.6s, 6.7s, 8.6s, 10.8s.
// The cost is Django reaching Supabase in ap-southeast-1, and the problem is the
// SPREAD, not the median - there is no reliable warm path to optimise into. A 15s
// budget sat close enough to the top of that range that a login which was going to
// succeed got aborted and reported as "The request timed out. Check your connection
// and try again." - blaming the user's connection for the server's latency.
//
// 25s puts the abort well clear of the observed worst case while still failing fast
// enough to be useful on a genuinely dead network. It is a floor, not a fix: the
// durable repair is on the backend, where that latency is generated.
const DEFAULT_REQUEST_TIMEOUT_MS = 25_000;

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { token, headers, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, cacheTtlMs, signal, ...init } = options;
  const method = String(init.method || "GET").toUpperCase();
  const ttl = method === "GET" && !signal ? getCacheTtl(path, cacheTtlMs) : 0;
  if (method !== "GET") clearApiCache();

  if (ttl > 0) {
    const cached = responseCache.get(path);
    if (cached && cached.expiresAt > Date.now()) return clonePayload(cached.payload as T);
    if (cached) responseCache.delete(path);
    const pending = inFlightReads.get(path);
    if (pending) return pending.then((payload) => clonePayload(payload as T));
  }

  const requestGeneration = cacheGeneration;
  const request = (async () => {
    const reqHeaders = new Headers(headers || {});
    // Added: multipart uploads must supply their own boundary; JSON remains the default.
    if (!(init.body instanceof FormData)) reqHeaders.set("Content-Type", "application/json");
    if (token) reqHeaders.set("Authorization", `Bearer ${token}`);

    // Fix: failed reads stay pending so every mobile section keeps its loading state.
    // Writes run once; replaying a submission could create a duplicate order or replacement.
    let payload: any;
    let attempt = 0;
    while (true) {
      if (signal?.aborted) throw signal.reason || new Error("Request cancelled");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const abortFromCaller = () => controller.abort();
      signal?.addEventListener("abort", abortFromCaller, { once: true });
      try {
        const response = await fetch(`${API_BASE_URL}${path}`, {
          ...init,
          headers: reqHeaders,
          signal: controller.signal,
        });
        // Keep the timeout active during body reads; malformed GET data must also retry.
        if (method === "GET" && (response.status === 408 || response.status === 429 || response.status >= 500)) {
          throw new TypeError("Temporary read failure");
        }
        // Fix: an empty/truncated save response cannot confirm that the action succeeded.
        payload = response.status === 204 || response.status === 205 ? {} : await response.json().catch((error) => {
          if (method === "GET" && response.ok) throw error;
          if (method !== "GET" && response.ok) {
            throw new ApiError("The server did not confirm this action. Check the latest record before submitting again.", response.status, null);
          }
          return {};
        });
        if (!response.ok) {
          throw new ApiError(payload?.error || payload?.message || `Request failed: ${response.status}`, response.status, payload);
        }
        // Fix: application-level failures must not clear forms or report a successful save.
        if (method !== "GET" && (!payload || typeof payload !== "object" || payload.success === false || payload.dbUnavailable)) {
          throw new ApiError(payload?.error || payload?.message || "The server did not confirm this action. Check the latest record before submitting again.", response.status, payload);
        }
        if (method === "GET" && (payload?.success === false || payload?.dbUnavailable)) {
          throw new TypeError("Data is temporarily unavailable");
        }
        if (signal?.aborted) throw signal.reason || new Error("Request cancelled");
        break;
      } catch (error) {
        // Caller cancellation and access/validation errors retain their existing handling.
        if (signal?.aborted) throw signal.reason || error;
        if (error instanceof ApiError) throw error;
        if (method !== "GET") {
          if (controller.signal.aborted) throw new ApiError("The server took too long to confirm this action. Check the latest record before submitting again.", 0, null);
          throw error;
        }
        if (!(error instanceof TypeError) && !(error instanceof SyntaxError) && !controller.signal.aborted) throw error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abortFromCaller);
      }

      // Back off during outages, without leaving an uncancellable retry timer behind.
      const delay = Math.min(1000 * 2 ** Math.min(attempt++, 5), 30_000);
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(retryTimer);
          reject(signal?.reason || new Error("Request cancelled"));
        };
        const retryTimer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }, delay);
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
      });
    }
    if (ttl > 0 && requestGeneration === cacheGeneration) {
      responseCache.set(path, { payload: clonePayload(payload), expiresAt: Date.now() + ttl });
    }
    return payload as T;
  })();

  if (ttl > 0) inFlightReads.set(path, request);
  try {
    const payload = await request;
    return ttl > 0 ? clonePayload(payload) : payload;
  } finally {
    // Keep a newer request registered if this older request finishes after invalidation.
    if (ttl > 0 && inFlightReads.get(path) === request) inFlightReads.delete(path);
  }
}
