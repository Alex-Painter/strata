import type {
  ChangeReport,
  PrVerification,
  VerificationFlag,
  VerificationItem,
  VerificationResult,
} from "@strata/core/model";
import {
  VERIFY_COLUMNS,
  type VerifyCell,
  type VerifyColumn,
  type VerifyMatrix,
  type VerifyStatus,
  verifyMatrix,
} from "@strata/core/stack";
import { useMemo, useState } from "react";
import { shortOid } from "../lib/github";
import { Info } from "./Info";

const STATUS_WORD: Record<VerifyStatus, string> = {
  fail: "Fails",
  stale: "Old commit",
  pending: "Running",
  claimed: "Claimed",
  pass: "Passes",
  none: "None",
};

/** How the weakest cell reads in a sentence. */
const WEAK_PHRASE: Record<VerifyStatus, string> = {
  fail: "fails",
  stale: "is on an old commit",
  pending: "still runs",
  claimed: "has only claims in the PR body",
  none: "has no proof",
  pass: "passes",
};

/** Column names in a sentence. */
const WEAK_COLUMN: Record<VerifyColumn, string> = {
  ci: "CI",
  tests: "The test proof",
  ui: "The UI proof",
  preview: "The preview",
  bot: "The bot review",
  human: "The human review",
};

const RESULT_WORD: Record<VerificationResult, string> = {
  pass: "Passes",
  fail: "Fails",
  pending: "Running",
  skipped: "Skipped",
  "not-run": "Not run",
  claimed: "Claimed",
};

const MATRIX_INFO =
  "UI counts screenshots, recordings and walks. Bot and Human are reviews. " +
  "Each cell shows the proof that a PR carries on GitHub. Claimed means that only the PR body says it. " +
  "Old commit means that the proof is not on the PR's head. " +
  "The whole-stack row uses only the checks, previews and bot reviews on the head of the top PR. " +
  "That head holds the code of all the PRs below it, unless one of them needs a restack.";

/** The stack's verification: a PR by kind matrix, led by its weakest cell, and every flag. */
export function StackVerification({
  report,
  titles,
  onScope,
}: {
  report: ChangeReport;
  titles: Map<number, string>;
  onScope: (pr: number | null) => void;
}) {
  const matrix = useMemo(() => verifyMatrix(report), [report]);
  const notes = report.verification?.notes ?? [];
  if (!report.verification) return null;
  const flags = report.verification.prs.flatMap((pr) => pr.flags);
  return (
    <section aria-labelledby="verify-heading" className="grid gap-2">
      <h2 id="verify-heading" className="h2">
        Verification
        <Info text={MATRIX_INFO} />
      </h2>
      {matrix?.weakest && <Weakest weakest={matrix.weakest} />}
      {matrix && <MatrixTable matrix={matrix} report={report} titles={titles} onScope={onScope} />}
      {flags.length > 0 && (
        <ul aria-label="Verification flags" className="grid gap-1">
          {flags.map((flag) => (
            <li key={`${flag.pr} ${flag.kind} ${flag.itemIds.join()}`}>
              <button
                type="button"
                className="text-left hover:underline"
                title={`Show #${flag.pr}`}
                onClick={() => onScope(flag.pr)}
              >
                {flag.message}
              </button>
            </li>
          ))}
        </ul>
      )}
      {notes.map((note) => (
        <p key={note} className="text-muted">
          {note}
        </p>
      ))}
    </section>
  );
}

function Weakest({ weakest }: { weakest: NonNullable<VerifyMatrix["weakest"]> }) {
  const column = WEAK_COLUMN[weakest.column];
  return (
    <p>
      <span className="text-muted">Weakest: </span>
      {column} of <span className="font-mono">#{weakest.pr}</span> {WEAK_PHRASE[weakest.status]}.
    </p>
  );
}

function MatrixTable({
  matrix,
  report,
  titles,
  onScope,
}: {
  matrix: VerifyMatrix;
  report: ChangeReport;
  titles: Map<number, string>;
  onScope: (pr: number | null) => void;
}) {
  const items = new Map(
    (report.verification?.prs ?? []).flatMap((pr) => pr.items.map((item) => [item.id, item])),
  );
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table aria-labelledby="verify-heading" className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-faint">
            <th scope="col" className="px-3 py-1.5 text-left font-normal">
              <span className="sr-only">PR</span>
            </th>
            {VERIFY_COLUMNS.map((column) => (
              <th key={column.id} scope="col" className="px-1.5 py-1.5 text-left font-normal">
                {column.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row) => (
            <tr
              key={row.pr ?? "whole"}
              data-pr={row.pr ?? "whole"}
              className={row.pr === null ? "border-t border-line" : ""}
            >
              <th scope="row" className="px-3 py-1 text-left font-normal whitespace-nowrap">
                {row.pr === null ? (
                  <span className="font-medium">Whole stack</span>
                ) : (
                  <button
                    type="button"
                    className="lnk font-mono"
                    title={titles.get(row.pr)}
                    onClick={() => onScope(row.pr)}
                  >
                    #{row.pr}
                  </button>
                )}
              </th>
              {row.cells.map((cell) => (
                <td key={cell.column} className="px-1.5 py-1 whitespace-nowrap">
                  <CellText cell={cell} items={items} whole={row.pr === null} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CellText({
  cell,
  items,
  whole,
}: {
  cell: VerifyCell;
  items: Map<string, VerificationItem>;
  whole: boolean;
}) {
  if (cell.status === "none") {
    const blank = whole && !["ci", "preview", "bot"].includes(cell.column);
    return blank ? null : (
      <span className="text-faint" title="None">
        –
      </span>
    );
  }
  const titles = cell.itemIds
    .map((id) => items.get(id))
    .filter((item) => item && item.result !== "skipped")
    .map(
      (item) =>
        `${RESULT_WORD[(item as VerificationItem).result]}: ${(item as VerificationItem).title}`,
    )
    .join("\n");
  const strong = cell.status === "fail" || cell.status === "stale";
  return (
    <span
      data-status={cell.status}
      title={titles}
      className={
        strong ? "font-medium text-text" : cell.status === "pass" ? "text-text" : "text-muted"
      }
    >
      {cell.status === "pass" || cell.status === "fail" || cell.status === "stale"
        ? cell.label || STATUS_WORD[cell.status]
        : STATUS_WORD[cell.status]}
    </span>
  );
}

/** One PR's verification: its flags, then its proof grouped by kind. */
export function PrVerificationView({ verification }: { verification: PrVerification }) {
  const { items, flags, head } = verification;
  const of = (...kinds: VerificationItem["kind"][]) =>
    items.filter((item) => kinds.includes(item.kind));
  const checks = of("check");
  const media = of("screenshot", "recording");
  const groups: { title: string; items: VerificationItem[] }[] = [
    { title: "Tests", items: of("test", "walk") },
    { title: "Previews", items: of("preview") },
    { title: "Reviews", items: of("bot-review", "human-review") },
    { title: "Notes", items: of("note") },
    { title: "Not verified", items: of("not-run") },
  ];
  return (
    <section aria-labelledby="pr-verify-heading" className="grid gap-3">
      <h2 id="pr-verify-heading" className="h2">
        Verification
        <Info text="The proof that this PR carries on GitHub: its checks, previews and reviews, and the Verification section of its PR body. Claimed means that only the PR body says it." />
      </h2>
      {flags.length > 0 && <Flags flags={flags} />}
      <Checks checks={checks} />
      {media.length > 0 && <Media items={media} head={head} />}
      {groups.map(
        (group) =>
          group.items.length > 0 && (
            <ItemGroup key={group.title} title={group.title} items={group.items} head={head} />
          ),
      )}
    </section>
  );
}

function Flags({ flags }: { flags: VerificationFlag[] }) {
  return (
    <ul aria-label="Verification flags" className="grid gap-1.5">
      {flags.map((flag) => (
        <li key={`${flag.kind} ${flag.itemIds.join()}`} className="note text-text">
          {flag.message}
        </li>
      ))}
    </ul>
  );
}

function Checks({ checks }: { checks: VerificationItem[] }) {
  const counted = checks.filter((item) => item.result !== "skipped");
  const count = (result: VerificationResult) =>
    checks.filter((item) => item.result === result).length;
  const words = [
    count("fail") && `${count("fail")} fail`,
    count("pending") && `${count("pending")} running`,
    count("pass") && `${count("pass")} pass`,
    count("skipped") && `${count("skipped")} skipped`,
  ].filter(Boolean);
  if (checks.length === 0) return null;
  return (
    <details open={count("fail") > 0} className="grid gap-1">
      <summary className="cursor-pointer">
        <span className="font-medium">Checks</span>{" "}
        <span className="text-muted">{words.join(", ")}</span>
      </summary>
      <ul aria-label="Checks" className="mt-1 grid gap-0.5">
        {[...counted, ...checks.filter((item) => item.result === "skipped")].map((item) => (
          <ItemRow key={item.id} item={item} head={null} />
        ))}
      </ul>
    </details>
  );
}

function ItemGroup({
  title,
  items,
  head,
}: {
  title: string;
  items: VerificationItem[];
  head: string;
}) {
  return (
    <div className="grid gap-1">
      <h3 className="font-medium">{title}</h3>
      <ul aria-label={title} className="grid gap-0.5">
        {items.map((item) => (
          <ItemRow key={item.id} item={item} head={head} />
        ))}
      </ul>
    </div>
  );
}

function ItemRow({ item, head }: { item: VerificationItem; head: string | null }) {
  const old = head !== null && item.commit !== null && item.commit !== head;
  const word =
    item.kind === "not-run"
      ? null
      : item.strength === "claimed"
        ? "Claimed"
        : RESULT_WORD[item.result];
  return (
    <li className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 text-[13px]">
      <span
        className={
          item.result === "fail"
            ? "font-medium text-text"
            : item.result === "pass"
              ? "text-text"
              : "text-muted"
        }
      >
        {word}
      </span>
      <span className="min-w-0">
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer" className="lnk">
            <Code text={item.title} />
          </a>
        ) : (
          <Code text={item.title} />
        )}
        {old && item.commit && (
          <span className="text-muted"> · on old commit {shortOid(item.commit)}</span>
        )}
        {item.by && item.kind !== "human-review" && item.kind !== "check" && (
          <span className="text-faint"> · {item.by}</span>
        )}
        {item.detail && (
          <details>
            <summary className="cursor-pointer text-muted hover:text-text">More</summary>
            <p className="whitespace-pre-wrap text-muted">{item.detail}</p>
          </details>
        )}
      </span>
    </li>
  );
}

/** Text with `inline code` shown as code. */
function Code({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("`") && part.endsWith("`") && part.length > 1 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts never move.
          <code key={i} className="font-mono text-[12.5px]">
            {part.slice(1, -1)}
          </code>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts never move.
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function Media({ items }: { items: VerificationItem[]; head: string }) {
  return (
    <div className="grid gap-1">
      <h3 className="font-medium">Screenshots and recordings</h3>
      <ul
        aria-label="Screenshots and recordings"
        className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3"
      >
        {items.map((item) => (
          <MediaTile key={item.id} item={item} />
        ))}
      </ul>
    </div>
  );
}

function MediaTile({ item }: { item: VerificationItem }) {
  const [broken, setBroken] = useState(false);
  const media = item.media;
  if (!media) return null;
  const label = item.pairing === "before" ? "Before" : item.pairing === "after" ? "After" : null;
  return (
    <li className="grid content-start gap-1">
      {broken ? (
        <a
          href={media.url}
          target="_blank"
          rel="noreferrer"
          className="lnk grid h-28 place-items-center rounded-md border border-dashed border-line px-2 text-center text-[13px]"
        >
          Strata cannot show this file. Open it on its site.
        </a>
      ) : media.type === "video" ? (
        // biome-ignore lint/a11y/useMediaCaption: PR recordings come with no captions.
        <video
          src={media.url}
          controls
          preload="metadata"
          className="max-h-60 w-full rounded-md border border-line bg-hover"
          onError={() => setBroken(true)}
        />
      ) : (
        <a href={media.url} target="_blank" rel="noreferrer" title="Open the full image">
          <img
            src={media.url}
            alt={item.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="max-h-60 w-full rounded-md border border-line bg-hover object-contain"
            onError={() => setBroken(true)}
          />
        </a>
      )}
      <p className="text-[13px]">
        {label && <span className="font-medium">{label}: </span>}
        <span className="text-muted">
          {label ? item.title.replace(/^\s*(before|after)\s*:?\s*/i, "") : item.title}
        </span>
      </p>
    </li>
  );
}

/** The stack rail's word for each PR whose CI fails or still runs. */
export function railMarks(report: ChangeReport | null): Map<number, string> {
  const marks = new Map<number, string>();
  const matrix = report ? verifyMatrix(report) : null;
  for (const row of matrix?.rows ?? []) {
    const ci = row.cells.find((cell) => cell.column === "ci");
    if (row.pr === null || !ci) continue;
    if (ci.status === "fail") marks.set(row.pr, "CI fails");
    else if (ci.status === "pending") marks.set(row.pr, "CI runs");
  }
  return marks;
}
