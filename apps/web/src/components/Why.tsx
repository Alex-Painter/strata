import type { Claim, ContextSource, Evidence, Hunk } from "@strata/core/model";
import { useContext } from "react";
import { citedHunks, EvidenceContext } from "./Claims";
import { HunkCard } from "./Diff";

/** The text a why sentence quotes, with the source it is in. */
export interface Quoted {
  evidence: Evidence;
  source: ContextSource | undefined;
  quote: string;
}

/** The descriptions, issues and commits that a sentence quotes, in its order. */
export function quotedSources(claim: Claim, sources: readonly ContextSource[]): Quoted[] {
  return claim.evidence.flatMap((evidence) => {
    const { source, quote } = evidence.anchor;
    if (source.kind !== "context") return [];
    return [
      {
        evidence,
        source: sources.find((item) => item.id === source.sourceId),
        quote: quote?.exact ?? "",
      },
    ];
  });
}

/**
 * Why the Change exists: Claude's sentences as one paragraph, each followed by
 * chips for what it rests on. A chip for a description, an issue or a commit
 * shows the quoted words on hover; a chip for hunks counts them. Each chip
 * selects the sentence, and the hunks open under the paragraph. A sentence
 * that quotes nothing is not shown: no evidence, no claim.
 */
export function WhyText({
  claims,
  sources,
  hunks,
  selected,
  onSelect,
}: {
  claims: Claim[];
  sources: readonly ContextSource[];
  hunks: Map<string, Hunk>;
  selected: Claim | null;
  onSelect: (claim: Claim) => void;
}) {
  const evidence = useContext(EvidenceContext);
  const shown = claims
    .map((claim) => ({
      claim,
      quoted: quotedSources(claim, sources),
      cited: citedHunks(claim, hunks),
    }))
    .filter(({ quoted }) => quoted.length > 0);
  if (shown.length === 0) return null;
  const open = shown.find(({ claim }) => claim === selected);
  const toggle = (claim: Claim) =>
    evidence !== null && selected === claim ? evidence.onClose() : onSelect(claim);
  return (
    <div className="grid gap-2">
      <p className="why" data-why>
        {shown.map(({ claim, quoted, cited }) => (
          <span key={claim.text} data-claim>
            {claim.text}{" "}
            {quoted.map(({ evidence: item, quote }) => (
              <button
                key={`${item.label}:${quote}`}
                type="button"
                className="chip"
                aria-pressed={selected === claim}
                aria-label={`${item.label}: “${quote}”`}
                title={`“${quote}”`}
                onClick={() => toggle(claim)}
              >
                {item.label}
              </button>
            ))}
            {cited.length > 0 && (
              <button
                type="button"
                className="chip"
                aria-pressed={selected === claim}
                aria-label={`${cited.length === 1 ? "1 hunk" : `${cited.length} hunks`}: ${cited
                  .map((hunk) => `${hunk.path}:${hunk.newStart}`)
                  .join(", ")}`}
                onClick={() => toggle(claim)}
              >
                {cited.length === 1 ? "1 hunk" : `${cited.length} hunks`}
              </button>
            )}{" "}
          </span>
        ))}
      </p>
      {evidence && open && open.cited.length > 0 && (
        <section className="claim-ev" aria-label={`The hunks for: ${open.claim.text}`}>
          {open.cited.map((hunk) => (
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
    </div>
  );
}
