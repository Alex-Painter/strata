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

it("turns the paper texture on and off, and the browser keeps it", async () => {
  localStorage.removeItem("strata-paper");
  delete document.documentElement.dataset.paper;
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
  const paper = [...container.querySelectorAll("label")]
    .find((l) => l.textContent === "Show the paper texture")
    ?.querySelector("input") as HTMLInputElement;
  expect(paper.checked).toBe(false);
  expect(document.documentElement.dataset.paper).toBeUndefined();
  act(() => paper.click());
  expect(paper.checked).toBe(true);
  expect(document.documentElement.dataset.paper).toBe("on");
  expect(localStorage.getItem("strata-paper")).toBe("on");
  act(() => paper.click());
  expect(document.documentElement.dataset.paper).toBeUndefined();
  expect(localStorage.getItem("strata-paper")).toBe("off");
  act(() => root.unmount());
});
