import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";

let send = false;
beforeEach(() => {
  send = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/assigned") {
        return Response.json({
          repos: ["acme/app"],
          running: false,
          progress: null,
          lastFinishedAt: null,
          errors: [],
        });
      }
      if (url === "/api/repos/acme/app/settings") {
        if (init?.method === "POST") send = JSON.parse(String(init.body)).sendCodeToAnthropic;
        return Response.json({
          repo: "acme/app",
          sendCodeToAnthropic: send,
          claudeAvailable: true,
        });
      }
      return Response.json([]);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

it("turns Claude on for each searched repo, off until you do", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <SettingsPage me={{ login: "alex", name: null, avatarUrl: null }} />
      </QueryClientProvider>,
    ),
  );
  await flush();
  await flush();
  const claude = [...container.querySelectorAll("label")]
    .find((l) => l.textContent?.startsWith("Send the code in acme/app to Claude"))
    ?.querySelector("input") as HTMLInputElement;
  expect(claude.checked).toBe(false);
  act(() => claude.click());
  await flush();
  expect(send).toBe(true);
  expect(claude.checked).toBe(true);
  act(() => root.unmount());
});
