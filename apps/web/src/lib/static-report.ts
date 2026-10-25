/**
 * Static mode: the CLI writes a report into the page and the app renders it
 * with no server. The contract, which apps/cli relies on:
 *
 *   <script id="strata-report" type="application/json">JSON</script>
 *
 * placed before </head>, where JSON is JSON.stringify(report) with every "<"
 * written as < (and U+2028/U+2029 escaped) so the content can't close the
 * script tag. JSON.parse undoes the escapes.
 */
import type { ChangeReport } from "@strata/core/model";

export const STATIC_REPORT_ELEMENT_ID = "strata-report";

export function readStaticReport(doc: Document = document): ChangeReport | null {
  const element = doc.getElementById(STATIC_REPORT_ELEMENT_ID);
  if (!element?.textContent) return null;
  return JSON.parse(element.textContent) as ChangeReport;
}
