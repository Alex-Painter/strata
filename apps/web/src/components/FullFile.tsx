import type { ChangeReport, SourceRef } from "@strata/core/model";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { api, HttpError } from "../lib/api";
import { type FileBlock, fullFile } from "../lib/full-file";
import { highlightLines, type Token } from "../lib/highlight";
import { hunkSource, Line } from "./Diff";
import { Icon } from "./Icon";
import { Spinner } from "./Spinner";

/** A file to show whole, from the whole-stack diff or from one PR's own diff. */
export interface FullFileTarget {
  path: string;
  /** Set for a PR's own diff: the file is read where that diff ends. */
  pr?: number | undefined;
  /** The hunk to scroll to and outline; null scrolls to the first hunk. */
  focus: string | null;
}

/** Opens the full-file view. Absent where no server can read files, such as a static report. */
export const FullFileContext = createContext<((target: FullFileTarget) => void) | null>(null);

/** The button on a file row or a hunk header that opens the full file. */
export function OpenFullFile(target: FullFileTarget) {
  const open = useContext(FullFileContext);
  if (!open) return null;
  return (
    <button
      type="button"
      className="ib cursor-pointer"
      aria-label={`Open all of ${target.path}`}
      title="Open the full file"
      onClick={(event) => {
        event.stopPropagation();
        open(target);
      }}
    >
      <Icon name="expand" />
    </button>
  );
}

/**
 * The whole file in a dialog, with every hunk of its diff in place: added
 * lines green, removed lines red where they were, and the chosen hunk
 * outlined. It opens scrolled to that hunk.
 */
export function FullFileDialog({
  changeId,
  report,
  target,
  onClose,
}: {
  changeId: string;
  report: ChangeReport;
  target: FullFileTarget;
  onClose: () => void;
}) {
  const { path, pr } = target;
  const part = pr === undefined ? null : (report.parts.find((p) => p.pr === pr) ?? null);
  const hunks = useMemo(
    () => (part ? part.hunks : report.change.hunks).filter((hunk) => hunk.path === path),
    [part, report, path],
  );
  const revision = part ? part.to : (report.change.revisions?.head ?? null);
  // A file that the diff deletes is not at the head; its hunks hold all of it.
  const deleted = hunks.length > 0 && hunks.every((h) => h.newStart === 0 && h.newLines === 0);
  const file = useQuery({
    queryKey: ["file", changeId, revision, path],
    queryFn: () => api.file(changeId, path, revision as string),
    enabled: !deleted && revision !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  const blocks = useMemo(() => {
    if (deleted) return fullFile(null, hunks);
    return file.data ? fullFile(file.data.content, hunks) : undefined;
  }, [deleted, hunks, file.data]);
  const tokens = useMemo(() => (blocks ? highlightBlocks(path, blocks) : null), [path, blocks]);

  const focus = target.focus ?? hunks[0]?.id ?? null;
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!blocks || !focus) return;
    body.current
      ?.querySelector(`[data-full-hunk="${CSS.escape(focus)}"]`)
      ?.scrollIntoView?.({ block: "start" });
  }, [blocks, focus]);

  const where = part ? `at the end of #${part.pr}` : "at the top of the stack";
  // Unchanged lines can go to the chat as part of the file at the Change's head.
  // A PR's own diff ends at another revision, so there they are not a surface.
  const gapSource: SourceRef | null =
    pr === undefined ? { kind: "file", path, side: "head" } : null;

  let problem: string | null = null;
  if (revision === null && !deleted) problem = "Strata does not know the revision of this diff.";
  else if (file.error) {
    problem =
      file.error instanceof HttpError && file.error.status === 404
        ? `Strata cannot find ${path} at this revision.`
        : file.error.message;
  } else if (blocks === null) {
    problem = "The file at this revision does not agree with the diff. Strata does not show it.";
  }

  return (
    <div
      className="overlay ff-overlay"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={path}
        tabIndex={-1}
        className="sheet ff"
        data-full-file={path}
      >
        <div className="sheet-h gap-3">
          <h2 className="ff-path">{path}</h2>
          <span className="text-[13px] text-faint" title={revision ?? undefined}>
            {deleted ? "Deleted" : where}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            className="ib cursor-pointer"
            aria-label="Close"
            // biome-ignore lint/a11y/noAutofocus: a dialog takes focus when it opens.
            autoFocus
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </div>
        <div ref={body} className="ff-body">
          {problem ? (
            <p className="p-5 text-muted">{problem}</p>
          ) : !blocks ? (
            <p className="flex items-center gap-2 p-5 text-muted">
              <Spinner /> Opening…
            </p>
          ) : (
            <div className="ff-code">
              {blocks.map((block, b) => {
                const source = block.hunkId ? hunkSource(block.hunkId, pr) : gapSource;
                return (
                  <div
                    // Blocks never move while the dialog is open.
                    // biome-ignore lint/suspicious/noArrayIndexKey: see above.
                    key={b}
                    className="code"
                    data-full-hunk={block.hunkId ?? undefined}
                    data-focus={block.hunkId !== null && block.hunkId === focus}
                    data-anchor-source={source ? JSON.stringify(source) : undefined}
                  >
                    {block.lines.map((line, i) => (
                      <Line
                        key={`${line.oldLine ?? ""}:${line.newLine ?? ""}`}
                        line={line}
                        index={i}
                        tokens={tokens?.[b]?.[i]}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Highlights the file in one pass, so a block keeps the state of the lines above it. */
function highlightBlocks(path: string, blocks: FileBlock[]): Token[][][] | null {
  const all = highlightLines(
    path,
    blocks.flatMap((block) => block.lines),
  );
  if (!all) return null;
  let at = 0;
  return blocks.map((block) => {
    const slice = all.slice(at, at + block.lines.length);
    at += block.lines.length;
    return slice;
  });
}
