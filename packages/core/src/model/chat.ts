/**
 * Chat about a Change. A message carries the anchors the reviewer highlighted,
 * so "why is this nullable?" arrives with the exact field, hunk or spec
 * sentence it is about.
 */
import type { Anchor } from "./anchors.js";
import type { ReviewComment } from "./review.js";

export type ChatRole = "user" | "assistant";

export interface ChatThread {
  id: string;
  changeId: string;
  title: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: ChatRole;
  text: string;
  /** What the user highlighted. Empty for assistant messages. */
  anchors: Anchor[];
  /**
   * The analysis the message was about (its report's `analysis.startedAt`).
   * A newer run makes the thread's earlier messages refer to an older diff.
   */
  analysedAt: string | null;
  createdAt: string;
  /** What the assistant read for this answer. Empty for user messages. */
  reads: ChatRead[];
}

/** One tool read behind an answer. */
export interface ChatRead {
  tool: "read_hunk" | "read_file" | "read_pr" | "search";
  /** The hunk id, the path, the PR number or the search text. */
  target: string;
  /** The PR whose own diff it was read in. */
  pr?: number;
  /** For read_file: the side of the diff. */
  side?: "base" | "head";
  /** The path of a read hunk. */
  path?: string;
}

export interface PostChatMessageRequest {
  text: string;
  anchors: Anchor[];
}

/** Server-sent events on `POST /api/threads/:id/messages`. */
export type ChatStreamEvent =
  | { type: "delta"; text: string }
  /** What the agent is doing between text, e.g. "Reading src/models/user.py". */
  | { type: "status"; text: string }
  /** A comment Ask drafted, now in the PR's pending review. */
  | { type: "draft"; comment: ReviewComment }
  | { type: "done"; message: ChatMessage }
  | { type: "error"; message: string };

/**
 * The assistant cites evidence by writing an id in square brackets, e.g.
 * `[hunk_1a2b3c4d5e6f7a8b]`. The UI turns these into links.
 */
export const CITATION_PATTERN = /\[((?:hunk|ctx|finding|req|int|ent)_[0-9a-f]{16})\]/g;
