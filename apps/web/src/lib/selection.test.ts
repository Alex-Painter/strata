import { resolveAnchor } from "@strata/core/model";
import { afterEach, expect, it } from "vitest";
import { rangeAnchor } from "./selection";

afterEach(() => {
  document.body.innerHTML = "";
});

const surface = (lines: string[]) => {
  document.body.innerHTML = `<div data-anchor-source='{"kind":"hunk","hunkId":"hunk_1"}'>
    <div class="hunk-h">@@ -1,3 +1,3 @@</div>
    ${lines
      .map(
        (line, i) =>
          `<div data-anchor-line="${i}"><span class="no">${i + 1}</span><span class="sg">+</span><span data-anchor-text>${line}</span></div>`,
      )
      .join("")}
  </div>`;
  return [...document.querySelectorAll("[data-anchor-text]")].map((el) => el.firstChild as Text);
};

it("anchors a selection inside one line", () => {
  const [, second] = surface(["def warm():", "    ttl = 6", "    return ttl"]);
  const anchor = rangeAnchor(second as Text, 4, second as Text, 7);
  expect(anchor?.source).toEqual({ kind: "hunk", hunkId: "hunk_1" });
  expect(anchor?.quote?.exact).toBe("ttl");
  expect(anchor?.quote?.prefix).toBe("def warm():\n    ");
  const text = "def warm():\n    ttl = 6\n    return ttl";
  expect(anchor && resolveAnchor(anchor, text)).toEqual({ start: 16, end: 19 });
});

it("anchors a selection across lines that starts on a line number", () => {
  surface(["a = 1", "b = 2", "c = 3"]);
  const number = document.querySelector(".no")?.firstChild as Text;
  const second = document.querySelectorAll("[data-anchor-text]")[1]?.firstChild as Text;
  const anchor = rangeAnchor(number, 0, second, 3);
  expect(anchor?.quote?.exact).toBe("a = 1\nb =");
});

it("gives nothing for a selection outside a surface or of blank space", () => {
  const [first] = surface(["x = 1   "]);
  const outside = document.createElement("p");
  outside.textContent = "elsewhere";
  document.body.append(outside);
  expect(rangeAnchor(outside.firstChild as Text, 0, first as Text, 2)).toBeNull();
  expect(rangeAnchor(first as Text, 5, first as Text, 8)).toBeNull();
});
