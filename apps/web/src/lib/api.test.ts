import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, pollWhilePending } from "./api";

const pending = (progress: string) =>
  new Response(JSON.stringify({ pending: true, progress }), { status: 202 });

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a request the server is still working on", () => {
  it("asks again each second, passing on the progress, until it's done", async () => {
    const answers = [pending("Reading PRs from GitHub: 100 so far"), pending("Fetching")];
    const fetch = vi.fn(async () => answers.shift() ?? Response.json({ change: { id: "chg_1" } }));
    vi.stubGlobal("fetch", fetch);
    const steps: Array<string | null> = [];
    const done = api.createChange({ input: "acme/app#1" }, { onProgress: (s) => steps.push(s) });
    await vi.advanceTimersByTimeAsync(2500);
    await expect(done).resolves.toEqual({ change: { id: "chg_1" } });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(steps).toEqual(["Reading PRs from GitHub: 100 so far", "Fetching"]);
  });

  it("stops asking once it's abandoned", async () => {
    const fetch = vi.fn(async () => pending("Reading"));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const done = api.createChange({ input: "acme/app#1" }, { signal: controller.signal });
    const failed = expect(done).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1500);
    controller.abort();
    await vi.advanceTimersByTimeAsync(5000);
    await failed;
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("stops polling a query once a poll fails", async () => {
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce({ pending: true, progress: null })
      .mockRejectedValue(new Error("GitHub's rate limit"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const observer = new QueryObserver(client, {
      queryKey: ["stacks"],
      queryFn,
      refetchInterval: pollWhilePending,
      refetchIntervalInBackground: true,
    });
    const unsubscribe = observer.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(10_000);
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(observer.getCurrentResult().status).toBe("error");
    unsubscribe();
    client.clear();
  });
});
