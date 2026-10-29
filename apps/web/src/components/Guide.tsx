import type { Claim, FileChange, Guide, GuideSection, Hunk } from "@strata/core/model";
import { LAYERS } from "@strata/core/model";
import { useId, useState } from "react";
import { lineCount } from "../lib/format";
import { ClaimList } from "./Claims";
import { meaningful } from "./Diff";

/**
 * The order to read the whole stack (or a range) in. Claude's sections say
 * what they're about, each sentence with its evidence; every section opens to
 * its files, each opening in its layer. Without Claude it's Strata's own groups.
 */
export function GuideView({
  guide,
  files,
  hunks,
  onFile,
  selected,
  onClaim,
  of = "the whole stack",
  sections = guide.sections,
  heading = "Guide",
}: {
  guide: Guide;
  files: FileChange[];
  hunks: Map<string, Hunk>;
  onFile: (path: string) => void;
  selected: Claim | null;
  onClaim: (claim: Claim) => void;
  /** What the guide is to: "the whole stack" or "the range". */
  of?: string;
  /** The sections to show, when it's only some of them (or only a layer's part of them). */
  sections?: GuideSection[];
  heading?: string;
}) {
  if (sections.length === 0) return null;
  const byPath = new Map(files.map((file) => [file.path, file]));
  const all =
    sections.length === guide.sections.length && sections.every((s, i) => s === guide.sections[i]);
  return (
    <section aria-labelledby="guide-heading" className="grid gap-3">
      <div className="grid gap-0.5">
        <h2 id="guide-heading" className="h2">
          {heading}
        </h2>
        <p className="sub">
          {guide.by === "llm"
            ? `The order to read ${of} in: first the core of the change, last the glue code and mechanical changes.`
            : `Strata's groups of ${of}, sorted by layer, then by mechanical kind, then by directory.`}
        </p>
      </div>
      <ol className="list">
        {sections.map((section) => (
          <GuideItem
            key={section.id}
            n={guide.sections.findIndex((s) => s.id === section.id) + 1}
            section={section}
            byPath={byPath}
            hunks={hunks}
            onFile={onFile}
            selected={selected}
            onClaim={onClaim}
            startOpen={!all}
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
  selected,
  onClaim,
  startOpen,
}: {
  n: number;
  section: GuideSection;
  byPath: Map<string, FileChange>;
  hunks: Map<string, Hunk>;
  onFile: (path: string) => void;
  selected: Claim | null;
  onClaim: (claim: Claim) => void;
  startOpen: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const id = useId();
  const files = section.paths.map((path) => byPath.get(path)).filter((file) => file !== undefined);
  const counts = meaningful(files, hunks);
  // A section can span layers; then each file says which layer it is in.
  const mixed = new Set(files.map((file) => file.layer.layer)).size > 1;
  return (
    <li data-section={section.id} className="grid gap-1 px-3 py-2.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-baseline gap-2 text-left"
      >
        <span className="w-5 shrink-0 font-mono text-[12px] text-faint">{n}</span>
        <span className="min-w-0 flex-1 font-medium">{section.title}</span>
        <span className="shrink-0 text-[12px] text-faint">
          {files.length === 1 ? "1 file" : `${files.length} files`} ·{" "}
          {files.every((file) => file.mechanical)
            ? "mechanical"
            : lineCount(counts.additions, counts.deletions)}
        </span>
      </button>
      {section.about.length > 0 && (
        <div className="pl-7 text-muted">
          <ClaimList claims={section.about} hunks={hunks} selected={selected} onSelect={onClaim} />
        </div>
      )}
      {open && (
        <ul id={id} aria-label={`Files in ${section.title}`} className="grid pl-7">
          {files.map((file) => (
            <li key={file.path} className="flex items-baseline gap-2">
              <button
                type="button"
                onClick={() => onFile(file.path)}
                className="truncate text-left font-mono text-[12px] text-muted hover:text-text"
              >
                {file.path}
              </button>
              {mixed && (
                <span className="shrink-0 text-[12px] text-faint">
                  {LAYERS[file.layer.layer].title}
                </span>
              )}
              {file.mechanical && (
                <span className="shrink-0 text-[12px] text-faint">{file.mechanical.reason}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
