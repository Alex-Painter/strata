/**
 * Writes a report into the static build of the web app, following the
 * contract in apps/web/src/lib/static-report.ts.
 */
import type { ChangeReport } from "@strata/core";

export function injectReport(template: string, report: ChangeReport): string {
  const at = template.indexOf("</head>");
  if (at === -1) throw new Error("The web app's static build has no </head>; rebuild it.");
  // Escaping "<" means report text can never close the script tag or open a
  // comment; U+2028/2029 are escaped for older JavaScript parsers.
  const json = JSON.stringify(report)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const tag = `<script id="strata-report" type="application/json">${json}</script>`;
  return template.slice(0, at) + tag + template.slice(at);
}
