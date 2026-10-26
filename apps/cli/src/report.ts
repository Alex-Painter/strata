/**
 * Prints a report in brief, the way `strata analyze` shows it: the path, each
 * PR's own diff, the whole-stack diff's files by layer, then issues and notes.
 */
import { type ChangeReport, type FileChange, LAYERS, type PrPart } from "@strata/core";

/** Longer whole-stack file lists are cut, and say how many were left out. */
const MAX_FILES = 40;

export function formatReport(report: ChangeReport): string {
  const { change, stack } = report;
  const repo =
    change.repo.kind === "github" ? `${change.repo.owner}/${change.repo.name}` : change.repo.path;
  const lines = [`${repo}: ${change.title}`];

  if (stack) {
    const titles = new Map(stack.nodes.map((node) => [node.pr.number, node.pr.title]));
    const from = stack.base ? `, from ${stack.base.slice(0, 7)}` : "";
    lines.push(
      `${stack.selectedPath.map((n) => `#${n}`).join(" → ")} on ${stack.trunk.name}${from}`,
    );
    lines.push("");
    const width = Math.max(...report.parts.map((part) => String(part.pr).length)) + 1;
    for (const part of report.parts) {
      lines.push(
        `  ${`#${part.pr}`.padEnd(width)}  ${partLine(part)}  ${titles.get(part.pr) ?? ""}`,
      );
      if (part.github && !part.github.same) {
        lines.push(`  ${" ".repeat(width)}  GitHub's diff differs: ${part.github.reason}`);
      }
    }
    lines.push("");
  }

  lines.push(
    change.revisions
      ? `Whole stack: ${fileCount(change.files)}, ${totals(change.files)}`
      : "No whole-stack diff.",
  );
  const byPath = new Map(change.files.map((file) => [file.path, file]));
  // By layer once classified; a report without layers lists files by path.
  const groups =
    change.layers.length > 0
      ? change.layers.map((group) => ({
          title: `${LAYERS[group.layer].title}${LAYERS[group.layer].inspect ? " (inspect)" : ""}`,
          files: group.files.map((f) => byPath.get(f.path)).filter((f) => f !== undefined),
        }))
      : [{ title: null, files: change.files }];
  let shown = 0;
  for (const group of groups) {
    if (shown >= MAX_FILES) break;
    if (group.title) lines.push(`  ${group.title}`);
    const indent = group.title ? "    " : "  ";
    for (const file of group.files.slice(0, MAX_FILES - shown)) {
      const mechanical = file.mechanical ? `  (${file.mechanical.reason})` : "";
      const judged = file.layer.by === "llm" ? `  (Claude: ${file.layer.reason})` : "";
      lines.push(
        `${indent}${file.status.charAt(0).toUpperCase()} ${file.path}  ${totals([file])}${mechanical}${judged}`,
      );
      shown++;
    }
  }
  if (change.files.length > shown) lines.push(`  … and ${change.files.length - shown} more`);

  const path = stack?.selectedPath ?? [];
  const issues = stack?.issues.filter((issue) => issue.prs.some((n) => path.includes(n))) ?? [];
  if (issues.length > 0 || report.notes.length > 0) lines.push("");
  for (const issue of issues) lines.push(`  ! ${issue.message}`);
  for (const note of report.notes) lines.push(`  - ${note}`);
  return `${lines.join("\n")}\n`;
}

function partLine(part: PrPart): string {
  const how = part.how.padEnd(8);
  if (part.how === "unknown") return `${how}  no diff`;
  return `${how}  ${fileCount(part.files).padEnd(9)}  ${totals(part.files).padEnd(11)}`;
}

function fileCount(files: FileChange[]): string {
  return files.length === 1 ? "1 file" : `${files.length} files`;
}

function totals(files: FileChange[]): string {
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return `+${additions} -${deletions}`;
}
