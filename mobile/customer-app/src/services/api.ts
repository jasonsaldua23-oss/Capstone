import { API_BASE_URL } from "../config/env";

interface ApiOptions extends RequestInit {
  token?: string | null;
  timeoutMs?: number;
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

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { token, headers, timeoutMs = 15_000, signal, ...init } = options;
  const reqHeaders = new Headers(headers || {});
  // Added: multipart uploads must supply their own boundary; JSON remains the default.
  if (!(init.body instanceof FormData)) reqHeaders.set("Content-Type", "application/json");
  if (token) reqHeaders.set("Authorization", `Bearer ${token}`);

  // Added: stop requests from hanging indefinitely on unreliable mobile networks.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller, { once: true });

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: reqHeaders,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("The request timed out. Check your connection and try again.");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error || payload?.message || `Request failed: ${response.status}`;
    throw new ApiError(message, response.status, payload);
  }
  return payload as T;
}
