import type { Evidence } from "@strata/core/model";
import { evidenceUrl, shortOid } from "../lib/github";

/** The commits and PRs a statement rests on, each opening on GitHub. */
export function EvidenceList({ repo, evidence }: { repo: string; evidence: Evidence[] }) {
  if (evidence.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-[12px] text-muted" aria-label="Evidence">
      {evidence.map((item) => {
        const url = evidenceUrl(repo, item);
        const { source } = item.anchor;
        const ref =
          source.kind === "commit"
            ? shortOid(source.oid)
            : source.kind === "pr"
              ? `#${source.number}`
              : "";
        // A label that already names its PR ("#10 targets b9") is the link itself.
        const named = ref !== "" && item.label.startsWith(`${ref} `);
        return (
          <li key={`${ref} ${item.label}`} className="flex gap-2">
            {named ? (
              <Ref url={url}>{item.label}</Ref>
            ) : (
              <>
                <Ref url={url} mono>
                  {ref}
                </Ref>
                <span>{item.label}</span>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Ref({
  url,
  mono = false,
  children,
}: {
  url: string | null;
  mono?: boolean;
  children: string;
}) {
  const font = mono ? "font-mono" : "";
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className={`${font} lnk`}>
      {children}
    </a>
  ) : (
    <span className={font}>{children}</span>
  );
}
