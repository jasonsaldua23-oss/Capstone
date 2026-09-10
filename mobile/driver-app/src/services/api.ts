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
  constructor(message: string, public readonly status: number, public readonly payload: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { token, headers, timeoutMs = 30000, cacheTtlMs, signal, ...init } = options;
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
    // FormData must supply its own multipart boundary; only JSON bodies get this header.
    if (!(init.body instanceof FormData) && init.body != null && !reqHeaders.has("Content-Type")) {
      reqHeaders.set("Content-Type", "application/json");
    }
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
        payload = await response.json().catch((error) => {
          if (method === "GET" && response.ok) throw error;
          return {};
        });
        if (!response.ok) {
          throw new ApiError(payload?.error || payload?.message || `Request failed: ${response.status}`, response.status, payload);
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
          if (controller.signal.aborted) throw new ApiError("The server took too long to respond. Please try again.", 0, null);
          throw new ApiError("Unable to reach the server. Check your connection and try again.", 0, null);
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
