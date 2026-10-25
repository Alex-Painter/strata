import type { ChangeReport } from "@strata/core";
import { describe, expect, it } from "vitest";
import { injectReport } from "./html.js";

const report = { change: { title: "</script><!-- \u2028" } } as unknown as ChangeReport;

describe("injectReport", () => {
  it("inserts the report before </head> so the content can't escape the script tag", () => {
    const html = injectReport("<html><head><title>x</title></head><body></body></html>", report);
    expect(html).toMatch(
      /<script id="strata-report" type="application\/json">.*<\/script><\/head>/,
    );
    const json =
      /<script id="strata-report" type="application\/json">(.*?)<\/script>/.exec(html)?.[1] ?? "";
    expect(json).not.toContain("<");
    expect(json).not.toContain("\u2028");
    expect(JSON.parse(json)).toEqual(report);
  });

  it("refuses a template without </head>", () => {
    expect(() => injectReport("<html></html>", report)).toThrow(/no <\/head>/);
  });
});
