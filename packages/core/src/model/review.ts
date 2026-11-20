/**
 * Reviews written in Strata: comments waiting to go to GitHub, and the review
 * that sends them. Ask can draft a comment; only a person's click on the
 * review box posts it, as one GitHub review with a summary and an event.
 */
import type { ApprovalState, ApprovalsResponse } from "./approval.js";
import type { Hunk } from "./change.js";
import type { ChangeReport } from "./report.js";

export type ReviewEvent = "COMMENT" | "REQUEST_CHANGES" | "APPROVE";

/** The side of the diff a line comment is on, as GitHub names it. */
export type CommentSide = "RIGHT" | "LEFT";

/** A comment waiting in a PR's pending review, kept by Strata until the review goes. */
export interface ReviewComment {
  id: string;
  changeId: string;
  pr: number;
  /** Null for a comment on the PR as a whole. */
  path: string | null;
  line: number | null;
  side: CommentSide;
  body: string;
  /** The Ask answer that drafted it; null when a person wrote it. */
  messageId: string | null;
  /** The head commit the line refers to. */
  commitOid: string | null;
  state: "pending" | "posted";
  /** The review it went out in. */
  url: string | null;
  createdAt: string;
}

/** What the review box can send for one PR, and why the rest is closed. */
export interface ReviewActions {
  comment: boolean;
  requestChanges: boolean;
  approve: boolean;
  /** Shown when an action is closed. */
  note: string | null;
}

export function reviewActions(state: ApprovalState): ReviewActions {
  switch (state.kind) {
    case "can-approve":
    case "approved-earlier":
      return { comment: true, requestChanges: true, approve: true, note: null };
    case "approved":
      return {
        comment: true,
        requestChanges: true,
        approve: false,
        note: "You approved this head.",
      };
    case "own":
      return {
        comment: true,
        requestChanges: false,
        approve: false,
        note: "GitHub does not let you approve or request changes on your own PR.",
      };
    case "draft":
      return {
        comment: true,
        requestChanges: false,
        approve: false,
        note: "This PR is a draft.",
      };
    case "closed":
      return {
        comment: true,
        requestChanges: false,
        approve: false,
        note: `This PR is ${state.state}.`,
      };
    case "head-moved":
      return {
        comment: false,
        requestChanges: false,
        approve: false,
        note: "New commits since the run. Run Strata again to review this PR.",
      };
  }
}

/** Ask the server to send the pending review of one PR. */
export interface SubmitReviewRequest {
  pr: number;
  /** The head the page shows; Strata refuses if the report has moved on. */
  headOid: string;
  event: ReviewEvent;
  body: string;
  /** The pending comments to send with it. */
  commentIds: string[];
}

export interface SubmitReviewResponse {
  url: string;
  event: ReviewEvent;
  posted: ReviewComment[];
  /** The path's PRs as GitHub shows them after the review. */
  approvals: ApprovalsResponse;
}

/** Ask the server to add a comment to a PR's pending review, or change one. */
export interface SaveCommentRequest {
  pr: number;
  body: string;
  path?: string | null;
  line?: number | null;
  side?: CommentSide;
}

/**
 * Where a line comment can go. GitHub takes one only on a line in the PR's
 * own diff, so the line must be in a hunk of that diff, on the side named.
 * A replayed PR's diff is not GitHub's, and neither is one GitHub reports as
 * different; those take only comments on the PR as a whole.
 */
export function commentTarget(
  report: ChangeReport,
  pr: number,
  path: string,
  line: number,
  side: CommentSide,
): { ok: true; commitOid: string } | { ok: false; reason: string } {
  const part = report.parts.find((p) => p.pr === pr);
  if (!part) return { ok: false, reason: `#${pr} is not on this path.` };
  if (part.how !== "direct" && part.how !== "apart") {
    return {
      ok: false,
      reason: `Strata's diff of #${pr} is not GitHub's diff, so a comment cannot go on a line. Write a comment on the PR as a whole, and name the file and line in it.`,
    };
  }
  if (part.github && !part.github.same && part.github.onlyHere.includes(path)) {
    return {
      ok: false,
      reason: `GitHub's diff of #${pr} does not have ${path}. Write a comment on the PR as a whole.`,
    };
  }
  // GitHub's head of the PR. A direct part ends on a commit Strata made with the same tree.
  const head = report.stack?.nodes.find((n) => n.pr.number === pr)?.pr.headOid ?? null;
  if (!head) return { ok: false, reason: `Strata does not know the head of #${pr}.` };
  const hunks = part.hunks.filter((h) => h.path === path);
  if (hunks.length === 0) {
    return {
      ok: false,
      reason: `#${pr}'s own diff does not change ${path}. Pick a file in its diff, or write a comment on the PR as a whole.`,
    };
  }
  if (!hunks.some((h) => hasLine(h, line, side))) {
    const ranges = hunks
      .map((h) =>
        side === "RIGHT"
          ? `${h.newStart}-${h.newStart + Math.max(h.newLines, 1) - 1}`
          : `${h.oldStart}-${h.oldStart + Math.max(h.oldLines, 1) - 1}`,
      )
      .join(", ");
    return {
      ok: false,
      reason: `Line ${line} (${side === "RIGHT" ? "head" : "base"} side) of ${path} is not in #${pr}'s diff. Lines in its diff: ${ranges}.`,
    };
  }
  return { ok: true, commitOid: head };
}

function hasLine(hunk: Hunk, line: number, side: CommentSide): boolean {
  return hunk.lines.some((l) =>
    side === "RIGHT"
      ? l.kind !== "del" && l.newLine === line
      : l.kind !== "add" && l.oldLine === line,
  );
}
