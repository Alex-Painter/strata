/**
 * The verification matrix: a row per PR on the path and a whole-stack row,
 * a column per kind of proof. Each cell holds the items behind it.
 *
 * The PR rows are "How it arrived". The whole-stack row reads only the CI,
 * previews and bot reviews on the top PR's head commit, which holds the code
 * of the whole path, so it is the same however the work was split.
 */
import type { ChangeReport } from "../model/report.js";
import type { PrVerification, VerificationItem, VerificationKind } from "../model/verification.js";

export type VerifyColumn = "ci" | "tests" | "ui" | "preview" | "bot" | "human";

export const VERIFY_COLUMNS: { id: VerifyColumn; title: string; kinds: VerificationKind[] }[] = [
  { id: "ci", title: "CI", kinds: ["check"] },
  { id: "tests", title: "Tests", kinds: ["test"] },
  { id: "ui", title: "UI", kinds: ["screenshot", "recording", "walk"] },
  { id: "preview", title: "Preview", kinds: ["preview"] },
  { id: "bot", title: "Bot", kinds: ["bot-review"] },
  { id: "human", title: "Human", kinds: ["human-review"] },
];

/**
 * - `fail`: a check, walk, bot or reviewer says no.
 * - `stale`: the only proof is on an older commit.
 * - `pending`: it still runs.
 * - `claimed`: only the PR body says so.
 * - `pass`: observed or attached, on the head.
 * - `none`: nothing.
 */
export type VerifyStatus = "fail" | "stale" | "pending" | "claimed" | "pass" | "none";

/** Worst first: the matrix leads with the weakest cell. */
export const STATUS_ORDER: VerifyStatus[] = ["fail", "stale", "pending", "claimed", "none", "pass"];

export interface VerifyCell {
  column: VerifyColumn;
  status: VerifyStatus;
  /** A few words, such as "12 pass" or "3 screenshots". */
  label: string;
  itemIds: string[];
}

export interface VerifyRow {
  /** Null for the whole stack. */
  pr: number | null;
  cells: VerifyCell[];
  flags: number;
}

export interface VerifyMatrix {
  rows: VerifyRow[];
  /** The weakest PR cell, worst status first; null when all pass. */
  weakest: { pr: number; column: VerifyColumn; status: VerifyStatus } | null;
}

export function verifyMatrix(report: ChangeReport): VerifyMatrix | null {
  const verification = report.verification;
  if (!verification || verification.prs.length === 0) return null;
  const rows: VerifyRow[] = verification.prs.map((pr) => ({
    pr: pr.pr,
    cells: VERIFY_COLUMNS.map((column) => cell(column.id, column.kinds, pr.items, pr.head)),
    flags: pr.flags.length,
  }));

  // The top PR's head holds the code of the whole path, however it was split.
  // A PR below it that moved on since makes that code old.
  const tip = verification.prs[verification.prs.length - 1];
  const moved = (report.stack?.issues ?? []).some(
    (issue) =>
      (issue.kind === "needs-restack" || issue.kind === "replay-conflict") &&
      issue.prs.some((n) => verification.prs.some((pr) => pr.pr === n)),
  );
  if (tip) {
    const head = tip.head;
    rows.push({
      pr: null,
      cells: VERIFY_COLUMNS.map((column) =>
        ["ci", "preview", "bot"].includes(column.id)
          ? wholeCell(
              cell(
                column.id,
                column.kinds,
                tip.items.filter((item) => item.commit === head),
                head,
              ),
              moved,
            )
          : { column: column.id, status: "none", label: "", itemIds: [] },
      ),
      flags: 0,
    });
  }

  let weakest: VerifyMatrix["weakest"] = null;
  for (const status of STATUS_ORDER.filter((s) => s !== "none" && s !== "pass")) {
    for (const row of rows) {
      if (row.pr === null) continue;
      const found = row.cells.find((c) => c.status === status);
      if (found) {
        weakest = { pr: row.pr, column: found.column, status };
        break;
      }
    }
    if (weakest) break;
  }
  if (!weakest) {
    // No CI on a PR is weaker than a missing screenshot.
    const noCi = rows.find((row) => row.pr !== null && row.cells[0]?.status === "none");
    if (noCi?.pr) weakest = { pr: noCi.pr, column: "ci", status: "none" };
  }
  return { rows, weakest };
}

/** On a stack that needs a restack, the top PR's proof is on old code below it. */
function wholeCell(cell: VerifyCell, moved: boolean): VerifyCell {
  if (!moved || cell.status === "none") return cell;
  return { ...cell, status: "stale", label: "Needs a restack" };
}

function cell(
  column: VerifyColumn,
  kinds: VerificationKind[],
  all: VerificationItem[],
  head: string,
): VerifyCell {
  const items = all.filter((item) => kinds.includes(item.kind));
  const ids = items.map((item) => item.id);
  const counted = items.filter((item) => item.result !== "skipped");
  if (counted.length === 0) return { column, status: "none", label: "", itemIds: ids };

  const fails = counted.filter((item) => item.result === "fail");
  const current = counted.filter((item) => item.commit === null || item.commit === head);
  if (fails.some((item) => current.includes(item))) {
    return { column, status: "fail", label: count(fails.length, "fails", "fail"), itemIds: ids };
  }
  if (current.length === 0) return { column, status: "stale", label: "Old commit", itemIds: ids };
  if (current.some((item) => item.result === "pending")) {
    return { column, status: "pending", label: "Running", itemIds: ids };
  }

  switch (column) {
    case "ci":
      return {
        column,
        status: "pass",
        label: count(current.length, "passes", "pass"),
        itemIds: ids,
      };
    case "ui": {
      const shots = current.filter((item) => item.kind === "screenshot").length;
      const videos = current.filter((item) => item.kind === "recording").length;
      const walks = current.filter((item) => item.kind === "walk").length;
      const label = [
        shots ? count(shots, "screenshot", "screenshots") : "",
        videos ? count(videos, "recording", "recordings") : "",
        walks ? count(walks, "walk", "walks") : "",
      ]
        .filter(Boolean)
        .join(", ");
      const attached = current.some((item) => item.strength !== "claimed");
      return { column, status: attached ? "pass" : "claimed", label, itemIds: ids };
    }
    default: {
      const observed = current.some((item) => item.strength !== "claimed");
      const label =
        column === "tests"
          ? count(current.length, "claim", "claims")
          : column === "human"
            ? "Approved"
            : "Passes";
      return {
        column,
        status: observed ? "pass" : "claimed",
        label: observed && column === "tests" ? count(current.length, "passes", "pass") : label,
        itemIds: ids,
      };
    }
  }
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The verification of one PR, if the report has it. */
export function prVerification(report: ChangeReport, pr: number): PrVerification | undefined {
  return report.verification?.prs.find((item) => item.pr === pr);
}
