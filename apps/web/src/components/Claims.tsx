import type { Claim, Hunk } from "@strata/core/model";
import { useId, useState } from "react";
import { HunkList } from "./Diff";

/**
 * Sentences Claude wrote, each with a button that opens the hunks it rests on
 * in place. A sentence none of whose hunks are in this diff isn't shown: no
 * evidence, no claim.
 */
export function ClaimList({
  claims,
  hunks,
  onFile,
}: {
  claims: Claim[];
  /** The diff's hunks by id: the whole stack's, or one PR's. */
  hunks: Map<string, Hunk>;
  onFile?: (path: string) => void;
}) {
  const shown = claims
    .map((claim) => ({ claim, cited: citedHunks(claim, hunks) }))
    .filter(({ cited }) => cited.length > 0);
  if (shown.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {shown.map(({ claim, cited }) => (
        <ClaimItem key={claim.text} claim={claim} cited={cited} onFile={onFile} />
      ))}
    </ul>
  );
}

function ClaimItem({
  claim,
  cited,
  onFile,
}: {
  claim: Claim;
  cited: Hunk[];
  onFile: ((path: string) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const count = cited.length === 1 ? "1 hunk" : `${cited.length} hunks`;
  const where = claim.evidence.map((item) => item.label).join(", ");
  return (
    <li data-claim>
      <p>
        {claim.text}{" "}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          aria-label={`${count}: ${where}`}
          title={where}
          onClick={() => setOpen((value) => !value)}
          className="rounded border border-line px-1 text-[11px] whitespace-nowrap text-accent hover:bg-raised"
        >
          {count}
        </button>
      </p>
      {open && (
        <div id={id} className="mt-1.5 mb-3">
          <HunkList hunks={cited} {...(onFile ? { onFile } : {})} />
        </div>
      )}
    </li>
  );
}

/** The hunks a sentence cites, from the diff it was written about. */
export function citedHunks(claim: Claim, hunks: Map<string, Hunk>): Hunk[] {
  return claim.evidence.flatMap((item) => {
    const { source } = item.anchor;
    const hunk =
      source.kind === "hunk" || source.kind === "pr-hunk" ? hunks.get(source.hunkId) : undefined;
    return hunk ? [hunk] : [];
  });
}
