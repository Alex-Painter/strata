import type { DiffLine, FileChange, Hunk } from "@strata/core/model";
import { LAYERS } from "@strata/core/model";
import { useState } from "react";
import { FILE_STATUS, lineCount } from "../lib/format";

/** Files with more changed lines than this start closed. */
const OPEN_FILE_LINES = 400;
/** Once this many lines are open, the rest start closed, so big layers stay quick. */
const OPEN_TOTAL_LINES = 3000;

/** A note on a hunk about which PR it came from, or which PR changed it again. */
export interface HunkChip {
  pr: number;
  text: string;
  /** Says what the chip claims in full. */
  title: string;
}

/**
 * A layer's files, each with its hunks under it. Mechanical files and hunks
 * start folded with their reason when `fold` is on, and line counts leave
 * them out. Choosing a file's row or a hunk's header selects it.
 */
export function FileList({
  files,
  hunksOf,
  chips,
  fold,
  selected,
  onFile,
  onHunk,
  onPr,
}: {
  files: FileChange[];
  hunksOf: (file: FileChange) => Hunk[];
  /** Seam chips by hunk id, when they're on. */
  chips: Map<string, HunkChip[]> | null;
  fold: boolean;
  /** The selected file path or hunk id. */
  selected: string | null;
  onFile: (path: string) => void;
  onHunk: (id: string) => void;
  onPr?: (pr: number) => void;
}) {
  let budget = OPEN_TOTAL_LINES;
  const opens = new Map(
    files.map((file) => {
      const size = file.additions + file.deletions;
      const open = !(fold && file.mechanical) && size <= OPEN_FILE_LINES && size <= budget;
      if (open) budget -= size;
      return [file.path, open] as const;
    }),
  );
  return (
    <div className="grid gap-6">
      {files.map((file) => (
        <FileBlock
          // Folding mechanical files again starts each file as the new setting says.
          key={`${file.path} ${fold}`}
          file={file}
          hunks={hunksOf(file)}
          initiallyOpen={opens.get(file.path) ?? false}
          chips={chips}
          fold={fold}
          selected={selected}
          onFile={onFile}
          onHunk={onHunk}
          {...(onPr ? { onPr } : {})}
        />
      ))}
    </div>
  );
}

function FileBlock({
  file,
  hunks,
  initiallyOpen,
  chips,
  fold,
  selected,
  onFile,
  onHunk,
  onPr,
}: {
  file: FileChange;
  hunks: Hunk[];
  initiallyOpen: boolean;
  chips: Map<string, HunkChip[]> | null;
  fold: boolean;
  selected: string | null;
  onFile: (path: string) => void;
  onHunk: (id: string) => void;
  onPr?: (pr: number) => void;
}) {
  // Closed files render no lines, so a big diff costs nothing until opened.
  const [open, setOpen] = useState(initiallyOpen);
  const facts = fileFacts(file);
  const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/") + 1) : "";
  return (
    <section
      id={fileAnchor(file.path)}
      aria-label={file.path}
      data-file={file.path}
      data-mechanical={file.mechanical?.kind}
      data-inspect={file.inspect.map((flag) => flag.rule).join(" ") || undefined}
      className="grid scroll-mt-4 gap-2"
    >
      <div className="flex items-center overflow-hidden rounded-md border border-line">
        <button
          type="button"
          data-nav={`file:${file.path}`}
          aria-current={selected === file.path ? "true" : undefined}
          onClick={() => onFile(file.path)}
          className="frow"
        >
          <span className="fs" title={FILE_STATUS[file.status]}>
            {FILE_STATUS[file.status].charAt(0)}
          </span>
          <span className="fp">
            {file.oldPath && <span className="dir">{file.oldPath} → </span>}
            <span className="dir">{dir}</span>
            {file.path.slice(dir.length)}
          </span>
          {file.inspect.map((flag) => (
            <span
              key={flag.rule}
              className="shrink-0 rounded border border-warn/40 px-1 text-[11px] text-warn"
              title={`${flag.reason}. Changes here must be right first time, so inspect them closely.`}
            >
              {flag.title}
            </span>
          ))}
          {file.mechanical && <span className="fm">{file.mechanical.reason}</span>}
          <LineCount file={file} hunks={hunks} />
        </button>
        {hunks.length > 0 && (
          <button
            type="button"
            className="ib mr-1"
            aria-expanded={open}
            aria-label={open ? `Hide ${file.path}` : `Show ${file.path}`}
            onClick={() => setOpen((value) => !value)}
          >
            <svg className="i" viewBox="0 0 16 16" aria-hidden="true">
              <path d={open ? "M3.5 6L8 10.5 12.5 6" : "M6 3.5L10.5 8 6 12.5"} />
            </svg>
          </button>
        )}
      </div>
      {(facts.length > 0 || file.inspect.length > 0 || (open && hunks.length > 0)) && (
        <p className="px-1 text-[12px] text-muted">{[
            ...facts,
            layerFact(file),
            ...file.inspect.map((flag) => `Inspect: ${flag.reason}`),
          ].join(" · ")}</p>
      )}
      {open &&
        hunks.map((hunk) => (
          <HunkCard
            key={hunk.id}
            hunk={hunk}
            folded={fold && file.mechanical === null && hunk.mechanical !== null}
            chips={chips?.get(hunk.id) ?? []}
            selected={selected === hunk.id}
            onSelect={() => onHunk(hunk.id)}
            {...(onPr ? { onPr } : {})}
          />
        ))}
      {!open && hunks.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="justify-self-start px-1 text-[12px] text-muted hover:text-text"
        >
          {file.mechanical && fold
            ? `Folded: ${file.mechanical.reason.toLowerCase()}. Show ${plural(hunks.length, "hunk")}`
            : `Show ${plural(hunks.length, "hunk")}, ${lineCount(file.additions, file.deletions)}`}
        </button>
      )}
    </section>
  );
}

/**
 * One hunk in Linear's style: a hairline card, a header with its range and
 * where it sits, and lines with faint add and remove tints. A mechanical hunk
 * in a meaningful file starts folded.
 */
export function HunkCard({
  hunk,
  folded = false,
  chips = [],
  selected = false,
  showPath = false,
  onSelect,
  onPr,
}: {
  hunk: Hunk;
  folded?: boolean;
  chips?: HunkChip[];
  selected?: boolean;
  /** Name the file in the header, for hunks shown away from their file. */
  showPath?: boolean;
  onSelect?: () => void;
  onPr?: (pr: number) => void;
}) {
  const [shown, setShown] = useState(!folded);
  const head = (
    <>
      {showPath && <span className="file">{hunk.path}</span>}
      <span className="rng">
        @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines}
      </span>
      {hunk.section && <span className="sect">{hunk.section}</span>}
    </>
  );
  return (
    <div
      className="hunk"
      data-hunk={hunk.id}
      data-mechanical={hunk.mechanical?.kind}
      data-selected={selected}
    >
      <div className="hunk-h">
        {onSelect ? (
          <button
            type="button"
            className="hsel"
            data-nav={`hunk:${hunk.id}`}
            aria-current={selected ? "true" : undefined}
            onClick={onSelect}
          >
            {head}
          </button>
        ) : (
          <span className="hsel">{head}</span>
        )}
        {chips.map((chip) => (
          <button
            key={`${chip.pr} ${chip.text}`}
            type="button"
            title={chip.title}
            disabled={!onPr}
            onClick={() => onPr?.(chip.pr)}
            className="chip seam"
            data-chip={chip.pr}
          >
            {chip.text}
          </button>
        ))}
      </div>
      {shown ? (
        <div className="code">
          {hunk.lines.map((line) => (
            // Old and new numbers together are unique within a hunk.
            <Line key={`${line.oldLine ?? ""}:${line.newLine ?? ""}`} line={line} />
          ))}
        </div>
      ) : (
        <p className="fold">
          {hunk.mechanical?.reason}, {plural(hunk.lines.length, "line")}.{" "}
          <button type="button" onClick={() => setShown(true)} className="lnk">
            Show
          </button>
        </p>
      )}
    </div>
  );
}

const MARK: Record<DiffLine["kind"], string> = { add: "+", del: "-", context: " " };

function Line({ line }: { line: DiffLine }) {
  return (
    <div className="ln" data-line={line.kind}>
      <span className="no">{line.kind === "del" ? line.oldLine : line.newLine}</span>
      <span className="sg">{MARK[line.kind]}</span>
      <span>
        {line.content}
        {line.noNewlineAtEof && <span className="eof">No newline at end of file</span>}
      </span>
    </div>
  );
}

/** Meaningful lines, with every line in the tooltip. Mechanical files show theirs muted. */
export function LineCount({ file, hunks }: { file: FileChange; hunks: Hunk[] }) {
  if (file.binary) return <span className="fm">binary</span>;
  const all = lineCount(file.additions, file.deletions);
  if (file.mechanical) {
    return (
      <span className="fm font-mono text-[11.5px]" title={`All lines: ${all}`}>
        {all}
      </span>
    );
  }
  const counts = meaningful([file], new Map(hunks.map((hunk) => [hunk.id, hunk])));
  return <Counts {...counts} title={`All lines: ${all}`} />;
}

/** `+40 −3` in mono, the only numbers tinted green and red. */
export function Counts({
  additions,
  deletions,
  title,
}: {
  additions: number;
  deletions: number;
  title?: string;
}) {
  return (
    <span className="fm font-mono text-[11.5px]" title={title}>
      <span className="add-n">+{additions}</span> <span className="del-n">−{deletions}</span>
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

/** Why the file is in its layer, said plainly enough to check, and who decided. */
export function layerFact(file: FileChange): string {
  const { layer } = file;
  const who =
    layer.by === "llm" ? ", Claude's call" : layer.confidence === "low" ? ", a guess" : "";
  return `${LAYERS[layer.layer].title}: ${layer.reason}${who}`;
}

/** Lines in hunks that aren't mechanical. */
export function meaningful(
  files: FileChange[],
  byId: Map<string, Hunk>,
): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    if (file.mechanical) continue;
    for (const id of file.hunkIds) {
      const hunk = byId.get(id);
      if (!hunk || hunk.mechanical) continue;
      for (const line of hunk.lines) {
        if (line.kind === "add") additions++;
        else if (line.kind === "del") deletions++;
      }
    }
  }
  return { additions, deletions };
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The id of a file's block on the page. */
export const fileAnchor = (path: string) => `file:${path}`;
