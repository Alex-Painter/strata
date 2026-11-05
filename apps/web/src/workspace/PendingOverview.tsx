import type { PathPr } from "@strata/core/model";
import { ReviewMarks, StateBadge } from "../components/PrStatus";
import { ago, countPrs } from "../lib/format";
import { prUrl } from "../lib/github";

/**
 * What GitHub says about the Change's PRs, before Strata has a report: no
 * analysis, only the facts Strata read when it found the path. The tip comes
 * first and the trunk last, as in the stack rail.
 */
export function PendingOverview({
  title,
  repo,
  prs,
}: {
  title: string | undefined;
  repo: string | undefined;
  /** The path's PRs, bottom first. */
  prs: PathPr[];
}) {
  if (prs.length === 0) return null;
  const trunk = prs[0]?.baseRef;
  return (
    <section aria-label="Pull requests on GitHub" className="grid gap-4">
      <header className="grid gap-1">
        {title && <h1 className="h1">{title}</h1>}
        <p className="text-muted">
          {countPrs(prs)}
          {repo && (
            <>
              {" "}
              · <span className="font-mono">{repo}</span>
            </>
          )}
          {trunk && (
            <>
              {" "}
              · on <span className="font-mono">{trunk}</span>
            </>
          )}
        </p>
      </header>
      <ul aria-label="Pull requests" className="grid grid-cols-[minmax(0,1fr)] gap-px">
        {[...prs].reverse().map((pr) => {
          const url = pr.url ?? (repo ? prUrl(repo, pr.number) : null);
          const row = <PrRow pr={pr} />;
          return (
            <li key={pr.number} data-pr={pr.number}>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  title={`Open #${pr.number} on GitHub`}
                  className="block rounded-md px-2 py-1.5 no-underline hover:bg-hover"
                >
                  {row}
                </a>
              ) : (
                <div className="px-2 py-1.5">{row}</div>
              )}
            </li>
          );
        })}
        {trunk && (
          <li className="px-2 py-1.5 font-mono text-[12.5px] text-faint" data-trunk={trunk}>
            {trunk}
          </li>
        )}
      </ul>
    </section>
  );
}

function PrRow({ pr }: { pr: PathPr }) {
  const facts = [pr.author, `opened ${ago(pr.createdAt)}`].filter(Boolean).join(" · ");
  return (
    <span className="grid gap-0.5">
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 font-mono text-[12.5px] text-faint">{pr.number}</span>
        <span className="min-w-0 flex-1 truncate text-[14px] text-text">
          {pr.title ?? `#${pr.number}`}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[12px] text-muted">
          <ReviewMarks pr={pr} />
          <StateBadge pr={pr} />
        </span>
      </span>
      <span className="flex min-w-0 items-baseline gap-2 text-[12px] text-faint">
        {pr.headRef && (
          <span className="min-w-0 truncate font-mono" title={`${pr.headRef} → ${pr.baseRef}`}>
            {pr.headRef} → {pr.baseRef}
          </span>
        )}
        <span className="ml-auto shrink-0">{facts}</span>
      </span>
    </span>
  );
}
