/**
 * Typed fetch helpers for the server's JSON API. Requests are same-origin
 * (the Vite dev server proxies /api), so the session cookie rides along.
 */
import type {
  ApiError,
  AssignedStatus,
  ChangeDetail,
  ChangeSummary,
  CreateChangeRequest,
  MeResponse,
  PendingResponse,
  RepoSettingsResponse,
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

/**
 * How often a query asks again while the server is still working: each second,
 * until it answers or fails. A failed read isn't retried by itself, since each
 * try starts the whole read again.
 */
export function pollWhilePending(query: {
  state: { status: string; data: unknown };
}): number | false {
  return query.state.status !== "error" && isPending(query.state.data) ? 1000 : false;
}

/**
 * How often a stack list asks again: like pollWhilePending, then every few
 * seconds while the server reads a newer list behind the one it answered.
 */
export function pollStacks(query: { state: { status: string; data: unknown } }): number | false {
  const data = query.state.data as { refreshing?: boolean } | undefined;
  return (
    pollWhilePending(query) || (query.state.status !== "error" && data?.refreshing ? 5000 : false)
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface PollOptions {
  onProgress?: (step: string | null) => void;
  /** Stops asking; the request then rejects. */
  signal?: AbortSignal;
}

/** Sends the request until it's done, passing on the progress of each 202. */
async function untilDone<T>(
  send: () => Promise<T | PendingResponse>,
  { onProgress, signal }: PollOptions,
): Promise<T> {
  for (;;) {
    const body = await send();
    signal?.throwIfAborted();
    if (!isPending(body)) return body;
    onProgress?.(body.progress);
    await sleep(1000);
    signal?.throwIfAborted();
  }
}

const repoPath = (repo: string) => repo.split("/").map(encodeURIComponent).join("/");

export const api = {
  me: () => request<MeResponse>("/api/me"),
  /** `repo` is `owner/name`. */
  repoSettings: (repo: string) =>
    request<RepoSettingsResponse>(`/api/repos/${repoPath(repo)}/settings`),
  setSendCode: (repo: string, sendCodeToAnthropic: boolean) =>
    request<RepoSettingsResponse>(
      `/api/repos/${repoPath(repo)}/settings`,
      post({ sendCodeToAnthropic }),
    ),
  signOut: () => request<void>("/auth/logout", post({})),
  /** `repo` is `owner/name`. Pending while the server is still reading it; ask again. */
  stacks: (repo: string) =>
    request<StacksResponse | PendingResponse>(
      `/api/repos/${repo.split("/").map(encodeURIComponent).join("/")}/stacks`,
    ),
  changes: () => request<ChangeSummary[]>("/api/changes"),
  /** Where the search for PRs assigned to you stands. */
  assigned: () => request<AssignedStatus>("/api/assigned"),
  /** Starts that search now, or joins the one going. */
  searchAssigned: () => request<AssignedStatus>("/api/assigned/search", post({})),
  change: (id: string) => request<ChangeDetail>(`/api/changes/${encodeURIComponent(id)}`),
  createChange: (body: CreateChangeRequest, options: PollOptions = {}) =>
    untilDone(
      () =>
        request<ChangeDetail | PendingResponse>("/api/changes", {
          ...post(body),
          ...(options.signal ? { signal: options.signal } : {}),
        }),
      options,
    ),
  runAgain: (id: string) =>
    request<RunInfo>(`/api/changes/${encodeURIComponent(id)}/runs`, post({})),
};
