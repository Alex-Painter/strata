/**
 * Typed fetch helpers for the server's JSON API. Requests are same-origin
 * (the Vite dev server proxies /api), so the session cookie rides along.
 */
import type { ApiError, MeResponse } from "@strata/core/model";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new HttpError(res.status, body?.error ?? `${res.status} ${res.statusText}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  me: () => request<MeResponse>("/api/me"),
  signOut: () => request<void>("/auth/logout", { method: "POST", body: "{}" }),
};
