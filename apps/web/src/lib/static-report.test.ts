import { describe, expect, it } from "vitest";
import { readStaticReport, STATIC_REPORT_ELEMENT_ID } from "./static-report";

describe("readStaticReport", () => {
  it("returns null when the page has no embedded report", () => {
    document.head.innerHTML = "";
    expect(readStaticReport()).toBeNull();
  });

  it("reads an escaped report", () => {
    const report = { change: { title: "</script><b>x</b>" } };
    const json = JSON.stringify(report).replace(/</g, "\\u003c");
    document.head.innerHTML = `<script id="${STATIC_REPORT_ELEMENT_ID}" type="application/json">${json}</script>`;
    expect(readStaticReport()).toEqual(report);
  });
});
