/**
 * Reads the title, description and linked issues of PRs, live from GitHub,
 * for the chat. One GraphQL query per ten PRs.
 */
import type { GitHubPort } from "./port.js";
import type { PrText } from "./verification.js";

const FIELDS = `number title url body
  closingIssuesReferences(first: 5) { nodes { number title body url } }`;

interface PrTextNode {
  number: number;
  title: string;
  url: string;
  body: string | null;
  closingIssuesReferences: {
    nodes: ({ number: number; title: string; body: string | null; url: string } | null)[];
  } | null;
}

export interface PrTextPage {
  repository: Record<string, PrTextNode | null> | null;
}

export function prTextQuery(numbers: number[]): string {
  const prs = numbers.map((n) => `pr${n}: pullRequest(number: ${n}) { ${FIELDS} }`).join("\n");
  return `query StrataPrText($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
${prs}
  }
}`;
}

/** The PRs in the order given. A PR that GitHub does not return is left out. */
export async function readPrTexts(
  port: GitHubPort,
  repo: string,
  numbers: number[],
): Promise<PrText[]> {
  const [owner, name] = repo.split("/");
  const out: PrText[] = [];
  for (let i = 0; i < numbers.length; i += 10) {
    const batch = numbers.slice(i, i + 10);
    const page = await port.graphql<PrTextPage>(prTextQuery(batch), { owner, name });
    for (const n of batch) {
      const node = page.repository?.[`pr${n}`];
      if (!node) continue;
      out.push({
        number: node.number,
        title: node.title,
        url: node.url,
        body: node.body,
        issues: (node.closingIssuesReferences?.nodes ?? []).flatMap((issue) =>
          issue ? [issue] : [],
        ),
      });
    }
  }
  return out;
}
