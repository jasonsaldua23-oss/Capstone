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

// Budget for the automatic second attempt at a timed-out GET (see apiRequest).
const RETRY_REQUEST_TIMEOUT_MS = 10_000;

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

    // Added: stop requests from hanging indefinitely on unreliable mobile networks.
    //
    // One aborted read used to be fatal. Measured against this backend on 31 Aug
    // 2026 - POST /api/auth/customer/login (a full Postgres round trip) at 0.83s,
    // 0.87s, 0.85s, 0.83s, 0.83s over localhost and 0.98-1.53s over the LAN
    // address the app actually calls, with the eight concurrent requests
    // refreshData fires all landing in 0.61-0.67s. Nothing here costs anything
    // close to 25s, so an abort at that mark is a transient stall (a Wi-Fi
    // handover, a cold pooler connect), not the true cost of the call. Retrying
    // an idempotent read once recovers the load instead of surfacing "The request
    // timed out." over an empty screen.
    //
    // Only GETs retry - replaying a POST could place a second order - and only
    // when OUR timer fired: a request the caller cancelled stays cancelled.
    const maxAttempts = method === "GET" ? 2 : 1;
    let response: Response | undefined;

    for (let attempt = 1; attempt <= maxAttempts && !response; attempt += 1) {
      // The retry gets a shorter budget so recovering from a stall cannot cost
      // more than the stall itself: 25s + 10s worst case, not 25s twice. Ten
      // seconds is still ~7x the slowest response measured over the LAN, so a
      // second attempt that has not answered by then is not going to.
      const attemptTimeoutMs = attempt === 1 ? timeoutMs : Math.min(timeoutMs, RETRY_REQUEST_TIMEOUT_MS);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);
      const abortFromCaller = () => controller.abort();
      signal?.addEventListener("abort", abortFromCaller, { once: true });

      try {
        response = await fetch(`${API_BASE_URL}${path}`, {
          ...init,
          headers: reqHeaders,
          signal: controller.signal,
        });
      } catch (error) {
        const cancelledByCaller = Boolean(signal?.aborted);
        if (!cancelledByCaller && attempt < maxAttempts) continue;
        if (controller.signal.aborted) {
          throw new Error("The request timed out. Check your connection and try again.");
        }
        throw error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abortFromCaller);
      }
    }

    // Unreachable: every path through the loop above either assigns a response or
    // throws. Present so the retry rewrite cannot silently widen the type below.
    if (!response) throw new Error("The request timed out. Check your connection and try again.");

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error || payload?.message || `Request failed: ${response.status}`;
      throw new ApiError(message, response.status, payload);
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
