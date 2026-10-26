import type { DiffLine, FileChange, Hunk, LayerId } from "@strata/core/model";
import { compareLayers, LAYERS } from "@strata/core/model";
import { useState } from "react";
import { FILE_STATUS, lineCount } from "../lib/format";

/** Files with more changed lines than this start closed. */
const OPEN_FILE_LINES = 400;
/** Once this many lines are open, the rest start closed, so big stacks stay quick. */
const OPEN_TOTAL_LINES = 3000;

/** A note on a hunk about which PR it came from, or which PR changed it again. */
export interface HunkChip {
  pr: number;
  text: string;
  /** Says what the chip claims in full. */
  title: string;
}

/**
 * The files of a diff by layer, in review order, then by directory, then each
 * file's hunks. Mechanical files and hunks start collapsed with their reason,
 * and line counts leave them out.
 */
export function Files({
  files,
  hunks,
  chips,
  onPr,
}: {
  files: FileChange[];
  hunks: Hunk[];
  /** By hunk id. */
  chips?: Map<string, HunkChip[]>;
  /** Choosing a chip's PR. */
  onPr?: (pr: number) => void;
}) {
  const byId = new Map(hunks.map((hunk) => [hunk.id, hunk]));
  const hunksOf = (file: FileChange) =>
    file.hunkIds.map((id) => byId.get(id)).filter((hunk) => hunk !== undefined);
  const layers = byLayer(files);
  let budget = OPEN_TOTAL_LINES;
  const opens = new Map(
    layers.flatMap(([, dirs]) =>
      dirs.flatMap(([, group]) =>
        group.map((file) => {
          const size = file.additions + file.deletions;
          const open = !file.mechanical && size <= OPEN_FILE_LINES && size <= budget;
          if (open) budget -= size;
          return [file.path, open] as const;
        }),
      ),
    ),
  );
  const counts = meaningful(files, byId);

  return (
    <section aria-labelledby="files-heading" className="space-y-3">
      <header className="flex items-baseline gap-3">
        <h2 id="files-heading" className="font-semibold">
          Files
        </h2>
        <span className="text-muted" title={`All lines: ${lineCount(...totals(files))}`}>
          {files.length === 1 ? "1 file" : `${files.length} files`} ·{" "}
          {lineCount(counts.additions, counts.deletions)}
        </span>
      </header>
      {files.length === 0 ? (
        <p className="text-muted">No changes.</p>
      ) : (
        <>
          <nav aria-label="File list" className="rounded-md border border-line bg-surface py-1">
            {layers.map(([layer, dirs]) => (
              <div key={layer} data-layer={layer} className="py-1">
                <LayerHeading layer={layer} files={dirs.flatMap(([, group]) => group)} />
                {dirs.map(([dir, group]) => (
                  <div key={dir}>
                    <div className="px-3 pl-6 font-mono text-[11px] text-muted">{dir || "/"}</div>
                    {group.map((file) => (
                      <a
                        key={file.path}
                        href={`#${fileAnchor(file.path)}`}
                        className="flex items-baseline gap-2 px-3 py-0.5 pl-9 hover:bg-raised"
                      >
                        <StatusMark status={file.status} />
                        <span className="min-w-0 flex-1 truncate font-mono">
                          {basename(file.path)}
                        </span>
                        <LineCount file={file} hunks={hunksOf(file)} />
                      </a>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </nav>
          {layers.map(([layer, dirs]) => (
            <section
              key={layer}
              id={layerAnchor(layer)}
              aria-label={LAYERS[layer].title}
              className="scroll-mt-4 space-y-3"
            >
              <LayerHeading layer={layer} files={dirs.flatMap(([, group]) => group)} as="h3" />
              {dirs.flatMap(([, group]) =>
                group.map((file) => (
                  <FileDiff
                    key={file.path}
                    file={file}
                    hunks={hunksOf(file)}
                    initiallyOpen={opens.get(file.path) ?? false}
                    chips={chips}
                    onPr={onPr}
                  />
                )),
              )}
            </section>
          ))}
        </>
      )}
    </section>
  );
}

function LayerHeading({
  layer,
  files,
  as = "div",
}: {
  layer: LayerId;
  files: FileChange[];
  as?: "div" | "h3";
}) {
  const Tag = as;
  const definition = LAYERS[layer];
  return (
    <Tag
      className={`flex items-baseline gap-2 ${as === "h3" ? "pt-2 font-semibold" : "px-3 font-medium"}`}
    >
      <span title={definition.description}>{definition.title}</span>
      {definition.inspect && (
        <span
          className="rounded border border-warn/40 px-1 text-[11px] font-normal text-warn"
          title="Changes here must be right first time, so inspect them closely."
        >
          Inspect
        </span>
      )}
      <span className="text-[11px] font-normal text-muted">
        {files.length === 1 ? "1 file" : `${files.length} files`}
      </span>
    </Tag>
  );
}

function FileDiff({
  file,
  hunks,
  initiallyOpen,
  chips,
  onPr,
}: {
  file: FileChange;
  hunks: Hunk[];
  initiallyOpen: boolean;
  chips: Map<string, HunkChip[]> | undefined;
  onPr: ((pr: number) => void) | undefined;
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
      data-mechanical={file.mechanical?.kind}
    >
      <summary className="flex cursor-pointer items-baseline gap-2 px-3 py-2 select-none">
        <span className="min-w-0 flex-1 truncate font-mono">
          {file.oldPath && <span className="text-muted">{file.oldPath} → </span>}
          {file.path}
        </span>
        {file.mechanical && (
          <span className="shrink-0 rounded bg-raised px-1.5 text-[11px] text-muted">
            {file.mechanical.reason}
          </span>
        )}
        <LineCount file={file} hunks={hunks} />
      </summary>
      {open && (
        <div className="border-t border-line">
          <p className="border-b border-line px-3 py-1.5 text-muted">
            {[...facts, layerFact(file)].join(" · ")}
          </p>
          {hunks.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse font-mono text-[12px] leading-5">
                {hunks.map((hunk) => (
                  <HunkRows
                    key={hunk.id}
                    hunk={hunk}
                    inMechanicalFile={file.mechanical !== null}
                    chips={chips?.get(hunk.id) ?? []}
                    onPr={onPr}
                  />
                ))}
              </table>
            </div>
          )}
        </div>
      )}
    </details>
  );
}

function HunkRows({
  hunk,
  inMechanicalFile,
  chips,
  onPr,
}: {
  hunk: Hunk;
  inMechanicalFile: boolean;
  chips: HunkChip[];
  onPr: ((pr: number) => void) | undefined;
}) {
  // A mechanical hunk in a meaningful file stays folded until asked for.
  const [shown, setShown] = useState(inMechanicalFile || hunk.mechanical === null);
  return (
    <tbody data-hunk={hunk.id} data-mechanical={hunk.mechanical?.kind}>
      <tr className="bg-raised text-muted">
        <td colSpan={3} className="px-3 py-0.5">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate whitespace-pre">
              @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
              {hunk.section && ` ${hunk.section}`}
            </span>
            {chips.map((chip) => (
              <button
                key={`${chip.pr} ${chip.text}`}
                type="button"
                title={chip.title}
                disabled={!onPr}
                onClick={() => onPr?.(chip.pr)}
                className="shrink-0 rounded border border-line bg-surface px-1.5 font-sans text-[11px] text-muted hover:text-accent"
                data-chip={chip.pr}
              >
                {chip.text}
              </button>
            ))}
          </div>
        </td>
      </tr>
      {shown ? (
        hunk.lines.map((line) => (
          // Old and new numbers together are unique within a hunk.
          <LineRow key={`${line.oldLine ?? ""}:${line.newLine ?? ""}`} line={line} />
        ))
      ) : (
        <tr>
          <td colSpan={3} className="px-3 py-1 font-sans text-muted">
            {hunk.mechanical?.reason}, {hunk.lines.length} lines.{" "}
            <button
              type="button"
              onClick={() => setShown(true)}
              className="text-accent hover:underline"
            >
              Show
            </button>
          </td>
        </tr>
      )}
    </tbody>
  );
}

/**
 * Hunks shown where a sentence cites them, each under its file's path, which
 * opens the file in the diff below.
 */
export function HunkList({ hunks, onFile }: { hunks: Hunk[]; onFile?: (path: string) => void }) {
  return (
    <div className="space-y-2">
      {hunks.map((hunk) => (
        <div
          key={hunk.id}
          data-cited={hunk.id}
          className="overflow-hidden rounded-md border border-line bg-surface"
        >
          <p className="border-b border-line px-3 py-1 font-mono text-[12px]">
            {onFile ? (
              <a
                href={`#${fileAnchor(hunk.path)}`}
                onClick={(event) => {
                  event.preventDefault();
                  onFile(hunk.path);
                }}
                className="hover:text-accent hover:underline"
              >
                {hunk.path}
              </a>
            ) : (
              hunk.path
            )}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse font-mono text-[12px] leading-5">
              <HunkRows hunk={hunk} inMechanicalFile={false} chips={[]} onPr={undefined} />
            </table>
          </div>
        </div>
      ))}
    </div>
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

/** Meaningful lines, with every line in the tooltip. Mechanical files show theirs muted. */
function LineCount({ file, hunks }: { file: FileChange; hunks: Hunk[] }) {
  if (file.binary) return <span className="shrink-0 text-muted">binary</span>;
  const all = lineCount(file.additions, file.deletions);
  if (file.mechanical) {
    return (
      <span className="shrink-0 font-mono text-[11px] text-muted" title={`All lines: ${all}`}>
        {all}
      </span>
    );
  }
  const counts = meaningful([file], new Map(hunks.map((hunk) => [hunk.id, hunk])));
  return (
    <span className="shrink-0 font-mono text-[11px]" title={`All lines: ${all}`}>
      <span className="text-open">+{counts.additions}</span>{" "}
      <span className="text-closed">−{counts.deletions}</span>
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
function layerFact(file: FileChange): string {
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

function totals(files: FileChange[]): [number, number] {
  return [
    files.reduce((sum, file) => sum + file.additions, 0),
    files.reduce((sum, file) => sum + file.deletions, 0),
  ];
}

type Directories = [dir: string, files: FileChange[]][];

/** Layers in review order, then directories by path. */
function byLayer(files: FileChange[]): [LayerId, Directories][] {
  const layers = new Map<LayerId, FileChange[]>();
  for (const file of files) {
    const group = layers.get(file.layer.layer);
    if (group) group.push(file);
    else layers.set(file.layer.layer, [file]);
  }
  return [...layers.entries()]
    .sort(([a], [b]) => compareLayers(a, b))
    .map(([layer, group]) => [layer, byDirectory(group)]);
}

function byDirectory(files: FileChange[]): Directories {
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

/** The id of a layer's section on the page. */
export const layerAnchor = (layer: LayerId) => `layer:${layer}`;
