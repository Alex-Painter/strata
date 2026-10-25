import type { DiffLine, FileChange, Hunk } from "@strata/core/model";
import { useState } from "react";
import { FILE_STATUS, lineCount } from "../lib/format";

/** Files with more changed lines than this start closed. */
const OPEN_FILE_LINES = 400;
/** Once this many lines are open, the rest start closed, so big stacks stay quick. */
const OPEN_TOTAL_LINES = 3000;

/**
 * The files of a diff, grouped by directory, then each file's hunks. Layers
 * replace the grouping in a later slice.
 */
export function Files({ files, hunks }: { files: FileChange[]; hunks: Hunk[] }) {
  const byId = new Map(hunks.map((hunk) => [hunk.id, hunk]));
  const groups = byDirectory(files);
  let budget = OPEN_TOTAL_LINES;
  const opens = new Map(
    files.map((file) => {
      const size = file.additions + file.deletions;
      const open = size <= OPEN_FILE_LINES && size <= budget;
      if (open) budget -= size;
      return [file.path, open];
    }),
  );
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);

  return (
    <section aria-labelledby="files-heading" className="space-y-3">
      <header className="flex items-baseline gap-3">
        <h2 id="files-heading" className="font-semibold">
          Files
        </h2>
        <span className="text-muted">
          {files.length === 1 ? "1 file" : `${files.length} files`} ·{" "}
          {lineCount(additions, deletions)}
        </span>
      </header>
      {files.length === 0 ? (
        <p className="text-muted">No changes.</p>
      ) : (
        <>
          <nav aria-label="File list" className="rounded-md border border-line bg-surface py-1">
            {groups.map(([dir, group]) => (
              <div key={dir} className="py-0.5">
                <div className="px-3 font-mono text-[11px] text-muted">{dir || "/"}</div>
                {group.map((file) => (
                  <a
                    key={file.path}
                    href={`#${fileAnchor(file.path)}`}
                    className="flex items-baseline gap-2 px-3 py-0.5 pl-6 hover:bg-raised"
                  >
                    <StatusMark status={file.status} />
                    <span className="min-w-0 flex-1 truncate font-mono">{basename(file.path)}</span>
                    <LineCount file={file} />
                  </a>
                ))}
              </div>
            ))}
          </nav>
          {groups.flatMap(([, group]) =>
            group.map((file) => (
              <FileDiff
                key={file.path}
                file={file}
                hunks={file.hunkIds.map((id) => byId.get(id)).filter((h) => h !== undefined)}
                initiallyOpen={opens.get(file.path) ?? false}
              />
            )),
          )}
        </>
      )}
    </section>
  );
}

function FileDiff({
  file,
  hunks,
  initiallyOpen,
}: {
  file: FileChange;
  hunks: Hunk[];
  initiallyOpen: boolean;
}) {
  // Closed files render no lines, so a big diff costs nothing until opened.
  const [open, setOpen] = useState(initiallyOpen);
  const facts = fileFacts(file);
  return (
    <details
      id={fileAnchor(file.path)}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="scroll-mt-4 rounded-md border border-line bg-surface"
      data-file={file.path}
    >
      <summary className="flex cursor-pointer items-baseline gap-2 px-3 py-2 select-none">
        <span className="min-w-0 flex-1 truncate font-mono">
          {file.oldPath && <span className="text-muted">{file.oldPath} → </span>}
          {file.path}
        </span>
        <LineCount file={file} />
      </summary>
      {open && (
        <div className="border-t border-line">
          {facts.length > 0 && (
            <p className="border-b border-line px-3 py-1.5 text-muted">{facts.join(" · ")}</p>
          )}
          {hunks.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse font-mono text-[12px] leading-5">
                {hunks.map((hunk) => (
                  <HunkRows key={hunk.id} hunk={hunk} />
                ))}
              </table>
            </div>
          )}
        </div>
      )}
    </details>
  );
}

function HunkRows({ hunk }: { hunk: Hunk }) {
  return (
    <tbody data-hunk={hunk.id}>
      <tr className="bg-raised text-muted">
        <td colSpan={3} className="px-3 py-0.5 whitespace-pre">
          @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
          {hunk.section && ` ${hunk.section}`}
        </td>
      </tr>
      {hunk.lines.map((line) => (
        // Old and new numbers together are unique within a hunk.
        <LineRow key={`${line.oldLine ?? ""}:${line.newLine ?? ""}`} line={line} />
      ))}
    </tbody>
  );
}

const MARK: Record<DiffLine["kind"], string> = { add: "+", del: "-", context: " " };

function LineRow({ line }: { line: DiffLine }) {
  const tone = line.kind === "add" ? "bg-add" : line.kind === "del" ? "bg-del" : "";
  return (
    <tr className={tone} data-line={line.kind}>
      <td className="w-10 px-2 text-right text-muted select-none">{line.oldLine ?? ""}</td>
      <td className="w-10 px-2 text-right text-muted select-none">{line.newLine ?? ""}</td>
      <td className="pr-3 whitespace-pre">
        <span className="text-muted select-none">{MARK[line.kind]}</span>
        {line.content}
        {line.noNewlineAtEof && (
          <span className="ml-2 font-sans text-[11px] text-muted select-none">
            No newline at end of file
          </span>
        )}
      </td>
    </tr>
  );
}

function StatusMark({ status }: { status: FileChange["status"] }) {
  const tone =
    status === "added" ? "text-open" : status === "deleted" ? "text-closed" : "text-muted";
  return (
    <span className={`w-3 shrink-0 font-mono ${tone}`} title={FILE_STATUS[status]}>
      {FILE_STATUS[status].charAt(0)}
    </span>
  );
}

function LineCount({ file }: { file: FileChange }) {
  if (file.binary) return <span className="shrink-0 text-muted">binary</span>;
  return (
    <span className="shrink-0 font-mono text-[11px]">
      <span className="text-open">+{file.additions}</span>{" "}
      <span className="text-closed">−{file.deletions}</span>
    </span>
  );
}

/** What a file's header says besides its path. */
export function fileFacts(file: FileChange): string[] {
  const facts: string[] = [];
  if (file.status === "renamed" || file.status === "copied") {
    const how = file.status === "renamed" ? "Renamed" : "Copied";
    facts.push(
      file.similarity !== undefined
        ? `${how} from ${file.oldPath}, ${file.similarity}% the same`
        : `${how} from ${file.oldPath}`,
    );
  } else if (file.status !== "modified") {
    facts.push(FILE_STATUS[file.status]);
  }
  if (file.oldMode && file.newMode && file.oldMode !== file.newMode) {
    facts.push(`Mode ${file.oldMode} → ${file.newMode}`);
  }
  const mode = file.newMode ?? file.oldMode;
  if (mode === "120000") facts.push("Symlink");
  if (file.binary) facts.push("Binary file, not shown");
  return facts;
}

function byDirectory(files: FileChange[]): [string, FileChange[]][] {
  const groups = new Map<string, FileChange[]>();
  for (const file of files) {
    const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
    const group = groups.get(dir);
    if (group) group.push(file);
    else groups.set(dir, [file]);
  }
  return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** The id of a file's diff on the page. */
export const fileAnchor = (path: string) => `file:${path}`;
