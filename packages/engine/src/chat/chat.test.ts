import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import {
  anchorForRange,
  type ChangeReport,
  type ChatMessage,
  hunkSurface,
  parseChangeInput,
  surfaceText,
} from "@strata/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatChunk, EngineConfig } from "../api.js";
import { ChatUnavailableError, createEngine } from "../engine.js";
import { settingsPath } from "../settings.js";
import { type DemoRepo, demoRepo } from "../testing/demo-repo.js";
import { StackRepo } from "../testing/stack-repo.js";
import { checkCitations } from "./chat.js";

let remote: StackRepo;
let dataDir: string;
let demo: DemoRepo;
beforeEach(async () => {
  remote = await StackRepo.create();
  dataDir = await mkdtemp(join(tmpdir(), "strata-data-"));
  demo = await demoRepo(remote);
});
afterEach(async () => {
  await remote.remove();
  await rm(dataDir, { recursive: true, force: true });
});

const engine = (config: Partial<EngineConfig> = {}) =>
  createEngine({
    dataDir,
    githubPort: demo.github,
    gitRemote: () => remote.dir,
    now: () => new Date(Date.UTC(2026, 9, 2)),
    ...config,
  });

async function allowClaude() {
  const path = settingsPath(dataDir, "acme/app");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ sendCodeToAnthropic: true }));
}

type Turn = Pick<Anthropic.Message, "content" | "stop_reason">;

/** A stand-in for messages.stream: plays one scripted turn per request, as stream events. */
function scripted(turns: Turn[]) {
  const requests: Anthropic.MessageStreamParams[] = [];
  const client = {
    messages: {
      stream: (params: Anthropic.MessageStreamParams) => {
        // Later turns change the array the loop sent; keep a copy of what was sent.
        requests.push(structuredClone(params));
        const turn = turns[requests.length - 1];
        if (!turn) throw new Error("No more scripted turns.");
        const events = turn.content.flatMap((block, index) =>
          block.type === "text"
            ? [
                {
                  type: "content_block_delta",
                  index,
                  delta: { type: "text_delta", text: block.text },
                },
              ]
            : [],
        );
        return {
          async *[Symbol.asyncIterator]() {
            yield* events;
          },
          finalMessage: async () => turn,
        };
      },
    },
  } as unknown as Anthropic;
  return { client, requests };
}

const text = (value: string): Anthropic.TextBlock => ({
  type: "text",
  text: value,
  citations: null,
});
const toolUse = (id: string, name: string, input: unknown): Anthropic.ToolUseBlock =>
  ({ type: "tool_use", id, name, input }) as Anthropic.ToolUseBlock;

async function collect(chunks: AsyncIterable<ChatChunk>): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const chunk of chunks) out.push(chunk);
  return out;
}

describe("chat", () => {
  async function report(): Promise<ChangeReport> {
    return engine().analyzeChange(parseChangeInput("acme/app#3"));
  }

  it("answers with tools, about a highlight, and keeps only real citations", async () => {
    await allowClaude();
    const analysed = await report();
    const hunk = analysed.change.hunks[0];
    if (!hunk) throw new Error("The demo stack has no hunks.");
    const file = analysed.change.files[0]?.path ?? "";
    const lines = hunkSurface(hunk);
    const highlight = anchorForRange({ kind: "hunk", hunkId: hunk.id }, surfaceText(lines), {
      start: 0,
      end: lines[0]?.length ?? 0,
    });
    const { client, requests } = scripted([
      {
        stop_reason: "tool_use",
        content: [
          text("I read the hunk first."),
          toolUse("t1", "read_hunk", { id: hunk.id }),
          toolUse("t2", "read_file", { path: file, side: "head" }),
          toolUse("t3", "search", { text: "nothing matches this" }),
        ],
      },
      {
        stop_reason: "end_turn",
        content: [text(`It adds a line [${hunk.id}]. It also does more [hunk_0000000000000000].`)],
      },
    ]);
    const history: ChatMessage[] = [
      {
        id: "m1",
        threadId: "t",
        role: "user",
        text: "What is this?",
        anchors: [],
        analysedAt: null,
        createdAt: "2026-10-02T00:00:00Z",
      },
      {
        id: "m2",
        threadId: "t",
        role: "assistant",
        text: "A stack.",
        anchors: [],
        analysedAt: null,
        createdAt: "2026-10-02T00:00:00Z",
      },
    ];

    const chunks = await collect(
      engine({ anthropicClient: client }).chat({
        report: analysed,
        history,
        text: "Why this line?",
        anchors: [highlight],
      }),
    );

    expect(chunks.filter((c) => c.type === "status").map((c) => c.text)).toEqual([
      `Claude reads ${hunk.id}`,
      `Claude reads ${file} at the head`,
      'Claude searches the code for "nothing matches this"',
    ]);
    const answer = chunks
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    expect(answer).toContain("I read the hunk first.\n\nIt adds a line");
    expect(checkCitations(analysed, answer)).toContain(`[${hunk.id}]`);
    expect(checkCitations(analysed, answer)).not.toContain("hunk_0000000000000000");

    const [first, second] = requests;
    const system = ((first?.system ?? []) as Anthropic.TextBlockParam[])
      .map((b) => b.text)
      .join("\n");
    expect(system).toContain(hunk.id);
    expect(system).toContain("ASD-STE100");
    expect(first?.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    const question = first?.messages[2]?.content as string;
    expect(question).toContain(`<highlight source="${hunk.path}`);
    expect(question).toContain(`Highlighted text:\n${lines[0]}`);
    expect(question.endsWith("Why this line?")).toBe(true);

    const results = second?.messages.at(-1)?.content as Anthropic.ToolResultBlockParam[];
    expect(results.map((r) => r.tool_use_id)).toEqual(["t1", "t2", "t3"]);
    expect(results[0]?.content).toContain(`${hunk.path} @@`);
    expect(results[1]?.content).toContain(`${file} at the head, lines 1-`);
    expect(results[2]?.content).toBe("No file at the head has this text.");
  });

  it("does not ask Claude about a repo whose settings do not allow it", async () => {
    const { client, requests } = scripted([]);
    const analysed = await report();
    await expect(
      collect(
        engine({ anthropicClient: client }).chat({
          report: analysed,
          history: [],
          text: "Hi",
          anchors: [],
        }),
      ),
    ).rejects.toBeInstanceOf(ChatUnavailableError);
    expect(requests).toHaveLength(0);
  });

  it("resolves a highlight that no longer matches as orphaned", async () => {
    const analysed = await report();
    const hunk = analysed.change.hunks[0];
    if (!hunk) throw new Error("The demo stack has no hunks.");
    const [resolved] = await engine().resolveAnchors(analysed, [
      {
        source: { kind: "hunk", hunkId: hunk.id },
        quote: { exact: "text that is not there", prefix: "", suffix: "" },
      },
    ]);
    expect(resolved?.orphaned).toBe(true);
    expect(resolved?.label).toContain(hunk.path);
  });

  it("reads a file at a revision, and nothing outside the repo", async () => {
    const analysed = await report();
    const path = analysed.change.files[0]?.path ?? "";
    const repo = { kind: "github", owner: "acme", name: "app" } as const;
    const head = analysed.change.revisions?.head ?? "";
    expect(await engine().readFile(repo, head, path)).not.toBeNull();
    expect(await engine().readFile(repo, head, "../outside")).toBeNull();
    expect(await engine().readFile(repo, head, "no/such/file")).toBeNull();
  });
});
