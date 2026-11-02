/**
 * Verification: the proof that a PR works, as its PR carries it. CI check
 * runs, deployments, bot and human reviews, and what the author wrote under
 * the PR's Verification or Testing headings (commands, screenshots,
 * recordings, end-to-end verdicts, and what they could not verify).
 *
 * Like the rest of the stack, verification describes how the work arrived. It
 * never decides layers or the whole-stack view. The one exception is the
 * whole-stack row of the matrix, which reads only evidence at the Change's
 * head commit, so it does not depend on how the work was split.
 */

export type VerificationKind =
  /** A CI check run or commit status. */
  | "check"
  /** A test command, or a test the author listed. */
  | "test"
  /** A scripted walk through the app, with a verdict such as `shots=28 failures=0`. */
  | "walk"
  | "screenshot"
  | "recording"
  /** A deployment of the PR's head, such as a branch preview. */
  | "preview"
  | "bot-review"
  | "human-review"
  /** Manual steps or another sentence about what the author checked. */
  | "note"
  /** Something the author says they did not verify. */
  | "not-run";

export type VerificationSource = "check" | "deployment" | "review" | "comment" | "pr-body";

export type VerificationResult = "pass" | "fail" | "pending" | "skipped" | "not-run" | "claimed";

/**
 * - `observed`: a system ran it and recorded the result (CI, a deployment, a bot).
 * - `attached`: there is an artifact a reviewer can open (a screenshot, a recording).
 * - `claimed`: only words in the PR body say it happened.
 */
export type VerificationStrength = "observed" | "attached" | "claimed";

export interface VerificationMedia {
  type: "image" | "video";
  url: string;
}

export interface VerificationItem {
  /** Stable within the report: derived from the PR, the kind and the content. */
  id: string;
  pr: number;
  kind: VerificationKind;
  source: VerificationSource;
  /** One line: a check's name, a command, a caption. */
  title: string;
  /** More text, such as a bot's risk reason or the steps of a manual test. */
  detail?: string;
  result: VerificationResult;
  strength: VerificationStrength;
  /** The commit it ran on. Null when its source does not say (PR body, comments). */
  commit: string | null;
  /** Who made it: a login, a bot or an app. */
  by?: string;
  /** When it happened or was written. */
  at?: string;
  /** Where to open it: a check's page, a review, the PR body. */
  url?: string;
  media?: VerificationMedia;
  /** Set on a screenshot captioned as the before or after view. */
  pairing?: "before" | "after";
  /** The heading it sits under in the PR body. */
  section?: string;
}

export type VerificationFlagKind =
  /** CI says a test fails, and the PR body says the tests pass. */
  | "contradiction"
  /** The author names something they did not verify. */
  | "named-gap"
  /** The PR changes UI files, and has no screenshot, recording or walk. */
  | "ui-without-proof"
  /** The PR's evidence is words only: no check, artifact or bot ran on its head. */
  | "claimed-only"
  /** Evidence on an older commit than the PR's head. */
  | "stale"
  /** The PR has no CI checks on its head. */
  | "no-checks";

export interface VerificationFlag {
  kind: VerificationFlagKind;
  pr: number;
  /** One STE sentence. */
  message: string;
  /** The items the flag is about. Empty when the flag is about something missing. */
  itemIds: string[];
}

/** What Strata read about one PR's verification. */
export interface PrVerification {
  pr: number;
  /** The PR's head when Strata read it: evidence on another commit is stale. */
  head: string;
  /** When the PR body was last written, and when its head commit was made. */
  bodyAt: string | null;
  headAt: string | null;
  items: VerificationItem[];
  flags: VerificationFlag[];
}

export interface Verification {
  /** One per PR on the selected path, bottom first. */
  prs: PrVerification[];
  /** Caveats, such as a PR that Strata could not read. */
  notes: string[];
}
