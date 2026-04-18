import { API_BASE_URL } from "../config/env";

interface ApiOptions extends RequestInit {
  token?: string | null;
}

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { token, headers, ...init } = options;
  const reqHeaders = new Headers(headers || {});
  reqHeaders.set("Content-Type", "application/json");
  if (token) reqHeaders.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: reqHeaders,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error || payload?.message || `Request failed: ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}
