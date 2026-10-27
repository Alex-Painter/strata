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
  PendingResponse,
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

/** The server is still working on it (a 202): ask again for progress or the result. */
export function isPending(body: unknown): body is PendingResponse {
  return typeof body === "object" && body !== null && (body as PendingResponse).pending === true;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sends the request until it's done, passing on the progress of each 202. */
async function untilDone<T>(
  send: () => Promise<T | PendingResponse>,
  onProgress?: (step: string | null) => void,
): Promise<T> {
  for (;;) {
    const body = await send();
    if (!isPending(body)) return body;
    onProgress?.(body.progress);
    await sleep(1000);
  }
}

export const api = {
  me: () => request<MeResponse>("/api/me"),
  signOut: () => request<void>("/auth/logout", post({})),
  /** `repo` is `owner/name`. Pending while the server is still reading it; ask again. */
  stacks: (repo: string) =>
    request<StacksResponse | PendingResponse>(
      `/api/repos/${repo.split("/").map(encodeURIComponent).join("/")}/stacks`,
    ),
  changes: () => request<ChangeSummary[]>("/api/changes"),
  change: (id: string) => request<ChangeDetail>(`/api/changes/${encodeURIComponent(id)}`),
  createChange: (body: CreateChangeRequest, onProgress?: (step: string | null) => void) =>
    untilDone(
      () => request<ChangeDetail | PendingResponse>("/api/changes", post(body)),
      onProgress,
    ),
  runAgain: (id: string) =>
    request<RunInfo>(`/api/changes/${encodeURIComponent(id)}/runs`, post({})),
};
