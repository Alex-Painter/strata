/**
 * A stand-in for the Anthropic Messages API, served by the fixture GitHub at
 * POST /v1/messages, so the summaries and the Guide can be driven with no key,
 * cost or network. It reads Strata's own prompts and answers from them, the
 * same way every time:
 *
 * - Layer questions: every file is logic.
 * - The whole stack: one sentence per group (four at most), plus one citing a
 *   hunk that doesn't exist, which Strata must drop. The Guide reads the logic
 *   groups first, then the data model; the other groups are left for Strata
 *   to place.
 * - One PR: a sentence per file, three at most.
 * - Chat (a streamed request with tools): first it reads the first hunk the
 *   system prompt lists, then it answers in one sentence that cites that hunk
 *   and a hunk that does not exist, which Strata must drop.
 */

interface MessageBody {
  model: string;
  system: string;
  messages: Array<{ content: string }>;
}

interface Group {
  label: string;
  title: string;
  paths: string[];
  hunks: string[];
}

export function fixtureClaude(body: MessageBody): unknown {
  const prompt = body.messages[0]?.content ?? "";
  const answer = body.system.includes("sort the files of a code change")
    ? { files: sorted(prompt) }
    : body.system.includes("one pull request")
      ? { summary: partSummary(prompt) }
      : wholeStack(prompt);
  return {
    id: "msg_fixture",
    type: "message",
    role: "assistant",
    model: body.model,
    content: [{ type: "text", text: JSON.stringify(answer), citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

function sorted(prompt: string) {
  return [...prompt.matchAll(/^### (\S+) \(/gm)].map((match) => ({
    path: match[1],
    layer: "logic",
    reason: "The fixture Claude calls every file logic",
  }));
}

function wholeStack(prompt: string) {
  const groups = parseGroups(prompt.slice(0, prompt.indexOf("\n\nThe hunks:")));
  const cited = groups.filter((group) => group.hunks.length > 0);
  const summary = [
    ...cited.slice(0, 4).map((group) => ({
      text: `${group.title} changes ${group.paths.join(", ")}.`,
      hunks: group.hunks,
    })),
    { text: "This sentence cites a hunk that doesn't exist.", hunks: ["h999"] },
  ];
  const named = (prefix: string) => cited.filter((group) => group.title.startsWith(prefix));
  const sections = [
    { title: "Read first: the logic", groups: named("Logic") },
    { title: "Then the storage", groups: named("Data model") },
  ]
    .filter((section) => section.groups.length > 0)
    .map((section) => ({
      title: section.title,
      groups: section.groups.map((group) => group.label),
      about: [
        {
          text: `Covers ${section.groups.flatMap((group) => group.paths).join(", ")}.`,
          hunks: section.groups.flatMap((group) => group.hunks.slice(0, 1)),
        },
      ],
    }));
  return { summary, sections };
}

function partSummary(prompt: string) {
  const files = [...prompt.matchAll(/^ {2}(\S+) \(.*\): (h\d+(?: h\d+)*)$/gm)];
  return files.slice(0, 3).map((match) => ({
    text: `Changes ${match[1]}.`,
    hunks: (match[2] as string).split(" "),
  }));
}

/** Strata's groups as its prompt lists them: `g1 Title`, then a line per file ending in hunk labels. */
function parseGroups(text: string): Group[] {
  const groups: Group[] = [];
  for (const line of text.split("\n")) {
    const group = /^(g\d+) (.+)$/.exec(line);
    if (group) {
      groups.push({ label: group[1] as string, title: group[2] as string, paths: [], hunks: [] });
      continue;
    }
    const file = /^ {2}(\S+) \(.*\): (.+)$/.exec(line);
    const current = groups[groups.length - 1];
    if (!file || !current) continue;
    current.paths.push(file[1] as string);
    current.hunks.push(...(file[2] as string).split(" ").filter((label) => /^h\d+$/.test(label)));
  }
  return groups;
}

interface ChatBody {
  model: string;
  system: Array<{ text: string }>;
  messages: Array<{ role: string; content: unknown }>;
}

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

/** One chat turn: a tool call first, then the answer once a tool result came back. */
export function fixtureChat(body: ChatBody): { model: string; content: Block[]; stop: string } {
  // The digest is the last system block; the first holds an example id.
  const digest = body.system.at(-1)?.text ?? "";
  const hunk = /hunk_[0-9a-f]{16}/.exec(digest)?.[0] ?? "hunk_0000000000000000";
  const last = body.messages.at(-1)?.content;
  const answered = Array.isArray(last) && last.some((b) => b?.type === "tool_result");
  if (!answered) {
    return {
      model: body.model,
      stop: "tool_use",
      content: [{ type: "tool_use", id: "toolu_fixture", name: "read_hunk", input: { id: hunk } }],
    };
  }
  return {
    model: body.model,
    stop: "end_turn",
    content: [
      {
        type: "text",
        text: `The fixture Claude read one hunk. It cites it [${hunk}]. It also cites a hunk that does not exist [hunk_ffffffffffffffff].`,
      },
    ],
  };
}

/** A turn as the Messages API streams it: server-sent events. */
export function sseOf(turn: { model: string; content: Block[]; stop: string }): string {
  const event = (type: string, data: unknown) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...(data as object) })}\n\n`;
  const usage = { input_tokens: 0, output_tokens: 0 };
  const out = [
    event("message_start", {
      message: {
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        model: turn.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage,
      },
    }),
  ];
  turn.content.forEach((block, index) => {
    if (block.type === "text") {
      out.push(event("content_block_start", { index, content_block: { type: "text", text: "" } }));
      // Two pieces, so the stream is seen to arrive in parts.
      const half = Math.ceil(block.text.length / 2);
      for (const piece of [block.text.slice(0, half), block.text.slice(half)]) {
        out.push(
          event("content_block_delta", { index, delta: { type: "text_delta", text: piece } }),
        );
      }
    } else {
      out.push(
        event("content_block_start", {
          index,
          content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
        }),
      );
      out.push(
        event("content_block_delta", {
          index,
          delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
        }),
      );
    }
    out.push(event("content_block_stop", { index }));
  });
  out.push(
    event("message_delta", { delta: { stop_reason: turn.stop, stop_sequence: null }, usage }),
  );
  out.push(event("message_stop", {}));
  return out.join("");
}
