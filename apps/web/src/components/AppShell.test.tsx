import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { AppShell } from "./AppShell";

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
});

const render = () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <AppShell navLabel="Strata" nav={<a href="/">Changes</a>} top="Top">
        Page
      </AppShell>,
    ),
  );
  return { container, root };
};

it("collapses the sidebar, and keeps it collapsed on the next visit", () => {
  const first = render();
  const app = first.container.querySelector(".app") as HTMLElement;
  expect(app.dataset.side).toBe("open");
  expect(first.container.querySelector('[aria-label="Expand the sidebar"]')).toBeNull();

  act(() =>
    (first.container.querySelector('[aria-label="Collapse the sidebar"]') as HTMLElement).click(),
  );
  expect(app.dataset.side).toBe("closed");
  act(() => first.root.unmount());

  const second = render();
  expect((second.container.querySelector(".app") as HTMLElement).dataset.side).toBe("closed");
  act(() =>
    (second.container.querySelector('[aria-label="Expand the sidebar"]') as HTMLElement).click(),
  );
  expect((second.container.querySelector(".app") as HTMLElement).dataset.side).toBe("open");
  act(() => second.root.unmount());
});
