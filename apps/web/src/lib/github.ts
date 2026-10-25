/** Links into GitHub for the PRs and commits a stack's evidence names. */
import type { Evidence } from "@strata/core/model";

export const shortOid = (oid: string) => oid.slice(0, 7);

export const commitUrl = (repo: string, oid: string) => `https://github.com/${repo}/commit/${oid}`;

export const prUrl = (repo: string, number: number) => `https://github.com/${repo}/pull/${number}`;

/** Where a piece of stack evidence can be checked, or null when it isn't on GitHub. */
export function evidenceUrl(repo: string, evidence: Evidence): string | null {
  const { source } = evidence.anchor;
  if (source.kind === "commit") return commitUrl(repo, source.oid);
  if (source.kind === "pr") return prUrl(repo, source.number);
  return null;
}
