/**
 * Chat about a Change: a tool-use loop with Claude, streamed.
 *
 * Claude gets a digest of the report in the system prompt (cached, since it is
 * the same for every message about this report), the thread so far, and the
 * reviewer's question with each highlight resolved to its lines. It reads
 * hunks, files and search results with read-only tools, inside this Change's
 * repo only. It cites hunks by id; `checkCitations` drops ids the report does
 * not hold, so every link in an answer goes to real evidence (AGENTS.md).
 */
import type Anthropic from "@anthropic-ai/sdk";
import { type ChangeReport, type ChatMessage, CITATION_PATTERN } from "@strata/core";
import type { ChatChunk, ResolvedAnchor } from "../api.js";
import { ClaudeError, STE_RULE } from "../llm.js";
import { digest, findHunk, hunkIds, hunkText, type ReadFile } from "./context.js";

/** Increase when the prompt or the tools change. */
export const CHAT_PROMPT_VERSION = 1;
/** Tool calls for one question. Past it, Claude is told to answer with what it has. */
const MAX_TOOL_CALLS = 8;
/** Lines of a file returned by one read. */
const READ_LINES = 400;
/** Characters of one tool result. */
const RESULT_CHARS = 40_000;
const MAX_TOKENS = 16_000;

export interface ChatTools {
  readFile: ReadFile;
  /** `git grep` at the head revision: "path:line:text" lines. */
  search: (text: string) => Promise<string>;
}

export interface ChatRun {
  client: Anthropic;
  model: string;
  report: ChangeReport;
  /** Earlier messages, oldest first, with each user message's highlights resolved. */
  history: Array<{ message: ChatMessage; anchors: ResolvedAnchor[] }>;
  text: string;
  anchors: ResolvedAnchor[];
  tools: ChatTools;
  signal?: AbortSignal;
}

const SYSTEM = `You help a person review a code change in Strata. A Change is one feature that can span a stack of pull requests. The person reads the whole-stack diff (all the PRs together) and each PR's own diff.

Answer the person's question about the Change. When they highlight text, the question is about that text first.

Use the tools to read hunks, files and search results before you make a claim about code that you have not seen. Do not guess. When the code does not show the answer, say so.

Cite the evidence for each claim: write the hunk id in square brackets after the sentence, for example [hunk_0123456789abcdef]. Cite only hunk ids from the digest, from a highlight or from a tool result. Do not cite files by a made-up id; name them by path.

Keep answers short: a few sentences or a short list. Use Markdown. Put code symbols and paths in backticks.

${STE_RULE}`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "read_hunk",
    description:
      "Returns one hunk of the whole-stack diff as diff text. With `pr`, returns the hunk from that PR's own diff instead.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "A hunk id, such as hunk_0123456789abcdef." },
        pr: { type: "integer", description: "A PR number on this path." },
      },
      required: ["id"],
    },
  },
  {
    name: "read_file",
    description: `Returns a file of the repo at the base or the head of the Change, with line numbers, ${READ_LINES} lines at most. Any file in the repo can be read, not only changed files.`,
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "The path from the repo root." },
        side: { type: "string", enum: ["base", "head"] },
        start_line: { type: "integer", description: "The first line to return, from 1." },
      },
      required: ["path", "side"],
    },
  },
  {
    name: "search",
    description:
      "Searches every file of the repo at the head of the Change for a fixed string. Returns path:line:text lines.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string", description: "The exact text to find." } },
      required: ["text"],
    },
  },
];

export async function* runChat(run: ChatRun): AsyncIterable<ChatChunk> {
  const { client, model, report, tools, signal } = run;
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: SYSTEM },
    {
      type: "text",
      text: `The Change, as Strata analysed it:\n\n${digest(report)}`,
      cache_control: { type: "ephemeral" },
    },
  ];
  const messages: Anthropic.MessageParam[] = [
    ...run.history.map(
      ({ message, anchors }): Anthropic.MessageParam => ({
        role: message.role,
        content: message.role === "user" ? userTurn(message.text, anchors) : message.text,
      }),
    ),
    { role: "user", content: userTurn(run.text, run.anchors) },
  ];

  let calls = 0;
  let wrote = false;
  for (;;) {
    signal?.throwIfAborted();
    const stream = client.messages.stream(
      {
        model,
        max_tokens: MAX_TOKENS,
        system,
        tools: TOOLS,
        messages,
        output_config: { effort: "medium" },
      },
      signal ? { signal } : undefined,
    );
    let first = true;
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        // Text from an earlier round ends without a break; start a new paragraph.
        if (first && wrote) yield { type: "text", text: "\n\n" };
        first = false;
        wrote = true;
        yield { type: "text", text: event.delta.text };
      }
    }
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") throw new ClaudeError("Claude did not answer.");
    if (message.stop_reason !== "tool_use") return;

    messages.push({ role: "assistant", content: message.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of message.content) {
      if (block.type !== "tool_use") continue;
      calls += 1;
      if (calls > MAX_TOOL_CALLS) {
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          is_error: true,
          content: "The tool limit for this question is reached. Answer with what you have.",
        });
        continue;
      }
      const input = (block.input ?? {}) as Record<string, unknown>;
      yield { type: "status", text: statusOf(block.name, input) };
      try {
        const content = await runTool(block.name, input, report, tools);
        results.push({ type: "tool_result", tool_use_id: block.id, content: clip(content) });
      } catch (error) {
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          is_error: true,
          content: error instanceof Error ? error.message : String(error),
        });
      }
    }
    messages.push({ role: "user", content: results });
  }
}

/** The question, after the highlights it is about. */
function userTurn(text: string, anchors: ResolvedAnchor[]): string {
  if (anchors.length === 0) return text;
  const highlights = anchors.map((resolved) => {
    const quote = resolved.anchor.quote?.exact;
    const lines = [`<highlight source="${resolved.label}">`];
    if (resolved.orphaned) lines.push("(Strata cannot find this text in the current analysis.)");
    if (quote) lines.push(`Highlighted text:\n${quote}`);
    if (resolved.text && resolved.text !== quote)
      lines.push(`With the lines around it:\n${resolved.text}`);
    lines.push("</highlight>");
    return lines.join("\n");
  });
  return `${highlights.join("\n\n")}\n\n${text}`;
}

function statusOf(name: string, input: Record<string, unknown>): string {
  if (name === "read_hunk") return `Claude reads ${String(input.id)}`;
  if (name === "read_file")
    return `Claude reads ${String(input.path)} at the ${input.side === "base" ? "base" : "head"}`;
  if (name === "search") return `Claude searches the code for "${String(input.text)}"`;
  return `Claude uses ${name}`;
}

async function runTool(
  name: string,
  input: Record<string, unknown>,
  report: ChangeReport,
  tools: ChatTools,
): Promise<string> {
  switch (name) {
    case "read_hunk": {
      if (typeof input.id !== "string") throw new Error("Give the hunk id as `id`.");
      const pr = typeof input.pr === "number" ? input.pr : undefined;
      const found = findHunk(report, input.id, pr);
      if (!found) throw new Error(`This Change has no hunk ${input.id}${pr ? ` in #${pr}` : ""}.`);
      return hunkText(found.hunk);
    }
    case "read_file": {
      if (typeof input.path !== "string") throw new Error("Give the file as `path`.");
      const side = input.side === "base" ? "base" : "head";
      const content = await tools.readFile(input.path, side);
      if (content === null) throw new Error(`There is no ${input.path} at the ${side}.`);
      const lines = content.split("\n");
      const start = Math.max(1, typeof input.start_line === "number" ? input.start_line : 1);
      const shown = lines.slice(start - 1, start - 1 + READ_LINES);
      const body = shown.map((line, i) => `${String(start + i).padStart(5)}  ${line}`).join("\n");
      const end = start - 1 + shown.length;
      return `${input.path} at the ${side}, lines ${start}-${end} of ${lines.length}:\n${body}`;
    }
    case "search": {
      if (typeof input.text !== "string" || input.text.trim() === "") {
        throw new Error("Give the text to find as `text`.");
      }
      const found = await tools.search(input.text);
      return found.trim() === "" ? "No file at the head has this text." : found;
    }
    default:
      throw new Error(`There is no tool ${name}.`);
  }
}

function clip(text: string): string {
  return text.length <= RESULT_CHARS
    ? text
    : `${text.slice(0, RESULT_CHARS)}\n(The result is cut here. It has ${text.length} characters.)`;
}

/**
 * Removes citations of hunk ids the report does not hold. Claude can write an
 * id that looks right but points at nothing; such a link would be a claim
 * without evidence.
 */
export function checkCitations(report: ChangeReport, text: string): string {
  const known = hunkIds(report);
  return text.replace(new RegExp(CITATION_PATTERN.source, "g"), (match, id: string) =>
    known.has(id) ? match : "",
  );
}
