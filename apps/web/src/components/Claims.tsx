import type { Claim, Hunk } from "@strata/core/model";
import { createContext, useContext } from "react";
import { HunkCard, type HunkChip } from "./Diff";

/**
 * How the canvas shows a selected sentence's hunks, under the sentence. The
 * workspace gives it; without it (a test, a page with no canvas) a sentence
 * shows no hunks.
 */
export interface EvidenceView {
  chips: Map<string, HunkChip[]>;
  /** The PR whose own diff the hunks are from, if they are a PR's. */
  pr?: number | undefined;
  /** Shows a hunk in its layer. */
  onHunk: (id: string) => void;
  onPr: (pr: number) => void;
  /** Closes the hunks: nothing is selected after it. */
  onClose: () => void;
}

export const EvidenceContext = createContext<EvidenceView | null>(null);

/**
 * Sentences Claude wrote, each with a button naming how many hunks it rests
 * on. The button selects the sentence, and the canvas shows those hunks under
 * it; the button closes them again. A sentence none of whose hunks are in this
 * diff isn't shown: no evidence, no claim.
 */
export function ClaimList({
  claims,
  hunks,
  selected,
  onSelect,
}: {
  claims: Claim[];
  /** The diff's hunks by id: the whole stack's, or one PR's. */
  hunks: Map<string, Hunk>;
  selected: Claim | null;
  onSelect: (claim: Claim) => void;
}) {
  const evidence = useContext(EvidenceContext);
  const shown = claims
    .map((claim) => ({ claim, cited: citedHunks(claim, hunks) }))
    .filter(({ cited }) => cited.length > 0);
  if (shown.length === 0) return null;
  return (
    <ul className="claims">
      {shown.map(({ claim, cited }) => {
        const count = cited.length === 1 ? "1 hunk" : `${cited.length} hunks`;
        const where = claim.evidence.map((item) => item.label).join(", ");
        const open = evidence !== null && selected === claim;
        return (
          <li key={claim.text} data-claim>
            {claim.text}{" "}
            <button
              type="button"
              data-nav={`claim:${claim.text}`}
              aria-pressed={selected === claim}
              aria-expanded={evidence ? open : undefined}
              aria-label={`${count}: ${where}`}
              title={where}
              onClick={() => (open ? evidence.onClose() : onSelect(claim))}
              className="chip"
            >
              {count}
            </button>
            {open && (
              <section className="claim-ev" aria-label={`The hunks for: ${claim.text}`}>
                {cited.map((hunk) => (
                  <HunkCard
                    key={hunk.id}
                    hunk={hunk}
                    showPath
                    chips={evidence.chips.get(hunk.id) ?? []}
                    onSelect={() => evidence.onHunk(hunk.id)}
                    onPr={evidence.onPr}
                    pr={evidence.pr}
                  />
                ))}
              </section>
            )}
          </li>
        );
      })}
    </ul>
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
