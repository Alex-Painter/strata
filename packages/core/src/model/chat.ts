/**
 * Chat about a Change. A message carries the anchors the reviewer highlighted,
 * so "why is this nullable?" arrives with the exact field, hunk or spec
 * sentence it is about.
 */
import type { Anchor } from "./anchors.js";

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
  createdAt: string;
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
  | { type: "done"; message: ChatMessage }
  | { type: "error"; message: string };

/**
 * The assistant cites evidence by writing an id in square brackets, e.g.
 * `[hunk_1a2b3c4d5e6f7a8b]`. The UI turns these into links.
 */
export const CITATION_PATTERN = /\[((?:hunk|ctx|finding|req|int|ent)_[0-9a-f]{16})\]/g;
