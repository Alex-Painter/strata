import type { FileChange, Guide, GuideSection, Hunk } from "@strata/core/model";
import { useId, useState } from "react";
import { lineCount } from "../lib/format";
import { ClaimList } from "./Claims";
import { fileAnchor, meaningful } from "./Diff";

/**
 * The order to read the whole stack (or a range) in. Claude's sections say
 * what they're about, each sentence opening its hunks; every section opens to
 * its files, each linking to its diff. Without Claude it's Strata's own groups.
 */
export function GuideView({
  guide,
  files,
  hunks,
  onFile,
  of = "the whole stack",
}: {
  guide: Guide;
  files: FileChange[];
  hunks: Map<string, Hunk>;
  onFile: (path: string) => void;
  /** What the guide is to: "the whole stack" or "the range". */
  of?: string;
}) {
  if (guide.sections.length === 0) return null;
  const byPath = new Map(files.map((file) => [file.path, file]));
  return (
    <section aria-labelledby="guide-heading" className="space-y-2">
      <h2 id="guide-heading" className="font-semibold">
        Guide
      </h2>
      <p className="text-[11px] text-muted">
        {guide.by === "llm"
          ? `Claude's reading order for ${of}: the core of the change first, glue and mechanical changes last.`
          : `Strata's groups of ${of}: by layer, then mechanical kind, then directory.`}
      </p>
      <ol className="divide-y divide-line rounded-md border border-line bg-surface">
        {guide.sections.map((section, i) => (
          <GuideItem
            key={section.id}
            n={i + 1}
            section={section}
            byPath={byPath}
            hunks={hunks}
            onFile={onFile}
          />
        ))}
      </ol>
    </section>
  );
}

function GuideItem({
  n,
  section,
  byPath,
  hunks,
  onFile,
}: {
  n: number;
  section: GuideSection;
  byPath: Map<string, FileChange>;
  hunks: Map<string, Hunk>;
  onFile: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const files = section.paths.map((path) => byPath.get(path)).filter((file) => file !== undefined);
  const counts = meaningful(files, hunks);
  return (
    <li data-section={section.id} className="px-3 py-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-baseline gap-2 text-left hover:text-accent"
      >
        <span className="w-5 shrink-0 font-mono text-muted">{n}</span>
        <span className="min-w-0 flex-1 font-medium">{section.title}</span>
        <span className="shrink-0 text-[11px] text-muted">
          {files.length === 1 ? "1 file" : `${files.length} files`} ·{" "}
          {files.every((file) => file.mechanical)
            ? "mechanical"
            : lineCount(counts.additions, counts.deletions)}
        </span>
      </button>
      {section.about.length > 0 && (
        <div className="mt-1 pl-7">
          <ClaimList claims={section.about} hunks={hunks} onFile={onFile} />
        </div>
      )}
      {open && (
        <ul id={id} aria-label={`Files in ${section.title}`} className="mt-1 pl-7">
          {files.map((file) => (
            <li key={file.path}>
              <a
                href={`#${fileAnchor(file.path)}`}
                onClick={(event) => {
                  event.preventDefault();
                  onFile(file.path);
                }}
                className="font-mono text-[12px] hover:text-accent hover:underline"
              >
                {file.path}
              </a>
              {file.mechanical && (
                <span className="ml-2 text-[11px] text-muted">{file.mechanical.reason}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
