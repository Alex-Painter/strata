import type { Claim, Hunk } from "@strata/core/model";

/**
 * Sentences Claude wrote, each with a button naming how many hunks it rests
 * on. The button selects the sentence, and the side panel shows those hunks.
 * A sentence none of whose hunks are in this diff isn't shown: no evidence,
 * no claim.
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
  const shown = claims
    .map((claim) => ({ claim, cited: citedHunks(claim, hunks) }))
    .filter(({ cited }) => cited.length > 0);
  if (shown.length === 0) return null;
  return (
    <ul className="claims">
      {shown.map(({ claim, cited }) => {
        const count = cited.length === 1 ? "1 hunk" : `${cited.length} hunks`;
        const where = claim.evidence.map((item) => item.label).join(", ");
        return (
          <li key={claim.text} data-claim>
            {claim.text}{" "}
            <button
              type="button"
              data-nav={`claim:${claim.text}`}
              aria-pressed={selected === claim}
              aria-label={`${count}: ${where}`}
              title={where}
              onClick={() => onSelect(claim)}
              className="chip"
            >
              {count}
            </button>
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
