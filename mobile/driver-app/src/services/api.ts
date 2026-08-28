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
  const { token, headers, timeoutMs = 30000, cacheTtlMs, ...init } = options;
  const method = String(init.method || "GET").toUpperCase();
  const ttl = method === "GET" && !init.signal ? getCacheTtl(path, cacheTtlMs) : 0;
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers: reqHeaders,
        signal: init.signal || controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ApiError("The server took too long to respond. Please try again.", 0, null);
      }
      throw new ApiError("Unable to reach the server. Check your connection and try again.", 0, null);
    } finally {
      clearTimeout(timeout);
    }

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
