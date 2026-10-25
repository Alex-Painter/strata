/**
 * Context sources: everything that says what the Change is *for*.
 *
 * Specs, tickets, PR descriptions and agent transcripts are stored as plain
 * text so they can be shown side by side with the code, highlighted, quoted
 * into chat and cited as evidence through the same anchor model.
 */
export type ContextKind = "spec" | "ticket" | "pr-description" | "transcript" | "design" | "note";

export interface ContextSource {
  /** Content-derived, so re-importing the same text keeps anchors valid. */
  id: string;
  kind: ContextKind;
  title: string;
  /** Where it came from, when it has an address (Linear, Notion, GitHub). */
  url?: string;
  /** Plain text or Markdown, with secrets redacted before storage. */
  content: string;
}
