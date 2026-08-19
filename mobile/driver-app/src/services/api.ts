import { API_BASE_URL } from "../config/env";

interface ApiOptions extends RequestInit {
  token?: string | null;
  timeoutMs?: number;
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly payload: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { token, headers, timeoutMs = 15_000, ...init } = options;
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
  return payload as T;
}
