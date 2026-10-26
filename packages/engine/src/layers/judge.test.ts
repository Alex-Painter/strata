import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { buildDiff, createClassifier, LAYER_IDS } from "@strata/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeError } from "../llm.js";
import { createLlmLayerJudge, judgeLayers, type LayerJudge, type LayerRequest } from "./judge.js";

let cacheDir: string;
beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "strata-judge-"));
});
afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

/** A stand-in for the Anthropic client that answers with `reply` and records each request. */
function fakeClaude(reply: (body: Record<string, unknown>) => Partial<Anthropic.Message>) {
  const calls: Array<{ body: Record<string, unknown>; options: unknown }> = [];
  const client = {
    messages: {
      create: async (body: Record<string, unknown>, options: unknown) => {
        calls.push({ body, options });
        return { stop_reason: "end_turn", content: [], ...reply(body) };
      },
    },
  } as unknown as Anthropic;
  return { llm: { client, model: "claude-test" }, calls };
}

const text = (value: unknown): Partial<Anthropic.Message> => ({
  content: [{ type: "text" as const, text: JSON.stringify(value), citations: null }],
});

const REQUEST: LayerRequest = {
  known: [{ path: "app/models/account.py", layer: "data-model" }],
  files: [
    { path: "app/billing.py", status: "added", lines: ["+class Invoice: ..."] },
    { path: "scripts/run.xyz", status: "modified", lines: ["-old", "+new"] },
  ],
};

describe("the Anthropic layer judge", () => {
  it("asks for a layer per file with a schema, and keeps only answers it can use", async () => {
    const { llm, calls } = fakeClaude(() =>
      text({
        files: [
          { path: "app/billing.py", layer: "data-model", reason: " Defines invoices " },
          { path: "scripts/run.xyz", layer: "frontend", reason: "Not a layer" },
          { path: "never/asked.py", layer: "logic", reason: "Not asked" },
        ],
      }),
    );
    const judge = createLlmLayerJudge(llm, cacheDir);
    const signal = new AbortController().signal;

    expect(await judge(REQUEST, signal)).toEqual([
      { path: "app/billing.py", layer: "data-model", reason: "Defines invoices" },
    ]);
    const [call] = calls;
    expect(call?.options).toEqual({ signal });
    expect(call?.body).toMatchObject({
      model: "claude-test",
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: { required: ["files"] } },
      },
    });
    const schema = JSON.stringify(call?.body.output_config);
    expect(schema).toContain(JSON.stringify([...LAYER_IDS]));
    expect(call?.body.system).toContain("data-model: Persisted models");
    const [message] = (call?.body.messages ?? []) as Array<{ content: string }>;
    expect(message?.content).toBe(
      [
        "Files in this change that Strata's rules placed:",
        "app/models/account.py: data-model",
        "",
        "Files to sort:",
        "",
        "### app/billing.py (added)",
        "+class Invoice: ...",
        "",
        "### scripts/run.xyz (modified)",
        "-old",
        "+new",
      ].join("\n"),
    );
  });

  it("answers the same request from its cache, and asks again when the request changes", async () => {
    const { llm, calls } = fakeClaude(() =>
      text({ files: [{ path: "app/billing.py", layer: "logic", reason: "Billing rules" }] }),
    );
    const judge = createLlmLayerJudge(llm, cacheDir);
    const first = await judge(REQUEST);
    expect(await judge(REQUEST)).toEqual(first);
    expect(calls).toHaveLength(1);
    expect(await readdir(cacheDir)).toHaveLength(1);

    await createLlmLayerJudge(llm, cacheDir)({ ...REQUEST, known: [] });
    expect(calls).toHaveLength(2);
    await createLlmLayerJudge({ ...llm, model: "claude-other" }, cacheDir)(REQUEST);
    expect(calls).toHaveLength(3);
  });

  it("fails clearly on a refusal, a cut-off answer or bad JSON, and caches none of them", async () => {
    const cases: Array<[Partial<Anthropic.Message>, string]> = [
      [{ stop_reason: "refusal" }, "Claude declined to answer."],
      [{ stop_reason: "max_tokens" }, "Claude's answer was cut off."],
      [{ content: [{ type: "text", text: "{", citations: null }] }, "wasn't valid JSON"],
    ];
    for (const [reply, message] of cases) {
      const judge = createLlmLayerJudge(fakeClaude(() => reply).llm, cacheDir);
      await expect(judge(REQUEST)).rejects.toThrow(ClaudeError);
      await expect(judge(REQUEST)).rejects.toThrow(message);
    }
    expect(await readdir(cacheDir)).toEqual([]);
  });
});

const adding = (path: string, ...lines: string[]) =>
  `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`;

describe("judgeLayers", () => {
  const model = (...diffs: string[]) =>
    buildDiff(diffs.join(""), { classifier: createClassifier() });

  it("asks only about guessed text files, with the placed files as context", async () => {
    const requests: LayerRequest[] = [];
    const judge: LayerJudge = async (request) => {
      requests.push(request);
      return [{ path: "app/billing.py", layer: "data-model", reason: "Defines invoices" }];
    };
    const { judged, notes } = await judgeLayers(
      model(
        adding("app/billing.py", "class Invoice:", "    total = 0"),
        adding("app/models/user.py", "class User: ..."),
        "diff --git a/logo.png b/logo.png\nnew file mode 100644\nindex 0000000..1111111\nBinary files /dev/null and b/logo.png differ\n",
      ),
      judge,
    );
    expect(requests).toEqual([
      {
        known: [{ path: "app/models/user.py", layer: "data-model" }],
        files: [
          { path: "app/billing.py", status: "added", lines: ["+class Invoice:", "+    total = 0"] },
        ],
      },
    ]);
    expect(judged.get("app/billing.py")).toEqual({
      layer: "data-model",
      by: "llm",
      reason: "Defines invoices",
      confidence: "medium",
    });
    expect(notes).toEqual([]);
  });

  it("doesn't ask when every file has a rule", async () => {
    let asked = false;
    const { judged } = await judgeLayers(model(adding("app/models/user.py", "x")), async () => {
      asked = true;
      return [];
    });
    expect(asked).toBe(false);
    expect(judged.size).toBe(0);
  });

  it("cuts long changes, splits many files into requests, and keeps going when one fails", async () => {
    const many = Array.from({ length: 45 }, (_, i) =>
      adding(
        `misc/s${String(i).padStart(2, "0")}.xyz`,
        ...Array.from({ length: 40 }, (_, j) => `echo ${j} ${"x".repeat(200)}`),
      ),
    );
    const sizes: number[] = [];
    const judge: LayerJudge = async (request) => {
      sizes.push(request.files.length);
      for (const file of request.files) {
        expect(file.lines).toHaveLength(30);
        expect(file.lines[0]?.length).toBe(161);
      }
      if (request.files.length === 5) throw new Error("Overloaded");
      return request.files.map((file) => ({
        path: file.path,
        layer: "config",
        reason: "A script",
      }));
    };
    const { judged, notes } = await judgeLayers(model(...many), judge);
    expect(sizes).toEqual([40, 5]);
    expect(judged.size).toBe(40);
    expect(notes).toEqual([
      "Strata couldn't ask Claude about 5 files, so their layers are still guesses: Overloaded",
    ]);
  });

  it("stops when the run is cancelled", async () => {
    const controller = new AbortController();
    const judge: LayerJudge = async () => {
      controller.abort();
      throw new Error("aborted");
    };
    await expect(
      judgeLayers(model(adding("app/billing.py", "x")), judge, controller.signal),
    ).rejects.toThrow();
  });
});
