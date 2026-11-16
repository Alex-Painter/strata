/** The parts of a list row that the Changes search looks at. */
export interface Searchable {
  title: string;
  repo: string;
  note?: string | null;
  /** Every PR number the row holds. */
  numbers: number[];
  /** PR titles, authors, branches and other free text. */
  text: (string | null | undefined)[];
}

/**
 * True when `row` matches every word of `query`. A word of digits, with or
 * without "#", matches a PR number that starts with those digits; any other
 * word (such as "acme/app#12") matches free text, without regard to case. An empty query matches all.
 */
export function matchesSearch(row: Searchable, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const refs = row.numbers.map((n) => `${row.repo}#${n}`);
  const haystack = [row.title, row.note, ...refs, ...row.text]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return words.every((word) => {
    const number = /^#?(\d+)$/.exec(word)?.[1];
    if (number) return row.numbers.some((n) => String(n).startsWith(number));
    return haystack.includes(word);
  });
}
