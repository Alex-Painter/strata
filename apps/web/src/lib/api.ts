/**
 * Typed fetch helpers for the server's JSON API. Requests are same-origin
 * (the Vite dev server proxies /api), so the session cookie rides along.
 */
import type {
  ApiError,
  ChangeDetail,
  ChangeSummary,
  CreateChangeRequest,
  MeResponse,
  RunInfo,
  StacksResponse,
} from "@strata/core/model";

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

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const api = {
  me: () => request<MeResponse>("/api/me"),
  signOut: () => request<void>("/auth/logout", post({})),
  /** `repo` is `owner/name`. */
  stacks: (repo: string) =>
    request<StacksResponse>(
      `/api/repos/${repo.split("/").map(encodeURIComponent).join("/")}/stacks`,
    ),
  changes: () => request<ChangeSummary[]>("/api/changes"),
  change: (id: string) => request<ChangeDetail>(`/api/changes/${encodeURIComponent(id)}`),
  createChange: (body: CreateChangeRequest) => request<ChangeDetail>("/api/changes", post(body)),
  runAgain: (id: string) =>
    request<RunInfo>(`/api/changes/${encodeURIComponent(id)}/runs`, post({})),
};
