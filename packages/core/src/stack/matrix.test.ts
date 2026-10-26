import { describe, expect, it } from "vitest";
import { buildDiff } from "../change/build.js";
import { createClassifier } from "../layers/classify.js";
import type { ChangeReport } from "../model/report.js";
import type { PrPart } from "../model/stack.js";
import { layerMatrix, prLayerBars } from "./matrix.js";

const adding = (path: string, ...lines: string[]) =>
  `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`;

const classifier = createClassifier();

function part(pr: number, diff: string, revisedLater: PrPart["provenance"] = null): PrPart {
  const { files, hunks } = buildDiff(diff, { classifier });
  return {
    pr,
    how: "direct",
    from: "a",
    to: "b",
    files,
    hunks,
    github: null,
    provenance: revisedLater,
    summary: [],
  };
}

/** #1 adds a model and a lockfile; #2 adds a service and a binary. */
function report(): Pick<ChangeReport, "change" | "parts"> {
  const one = [
    adding("app/models/user.py", "class User:", "    name: str"),
    adding("uv.lock", "v = 1"),
  ];
  const two = [
    adding("app/billing.py", "TOTAL = 0"),
    "diff --git a/logo.png b/logo.png\nnew file mode 100644\nindex 0000000..1111111\nBinary files /dev/null and b/logo.png differ\n",
  ];
  const whole = buildDiff([...one, ...two].join(""), { classifier });
  const first = part(1, one.join(""));
  const model = first.hunks.find((hunk) => hunk.path === "app/models/user.py");
  first.provenance = { inWhole: [], revisedLater: [{ hunkId: model?.id ?? "", by: 2, lines: 1 }] };
  return {
    change: {
      ...whole,
      id: "c",
      title: "t",
      repo: { kind: "github", owner: "acme", name: "app" },
      revisions: null,
      hints: [],
    },
    parts: [first, part(2, two.join(""))],
  };
}

describe("layerMatrix", () => {
  it("counts meaningful, mechanical and revised lines per layer and PR, then Net", () => {
    const matrix = layerMatrix(report());
    expect(matrix.prs).toEqual([1, 2]);
    expect(
      matrix.rows.map((row) => [
        row.layer,
        ...row.cells.map((c) => [
          c.files.map((f) => f.path),
          c.meaningful,
          c.mechanical,
          c.revised,
        ]),
      ]),
    ).toEqual([
      [
        "data-model",
        [["app/models/user.py"], 2, 0, 1],
        [[], 0, 0, 0],
        [["app/models/user.py"], 2, 0, 0],
      ],
      ["logic", [[], 0, 0, 0], [["app/billing.py"], 1, 0, 0], [["app/billing.py"], 1, 0, 0]],
      ["config", [["uv.lock"], 0, 1, 0], [[], 0, 0, 0], [["uv.lock"], 0, 1, 0]],
      ["other", [[], 0, 0, 0], [["logo.png"], 0, 0, 0], [["logo.png"], 0, 0, 0]],
    ]);
    expect(matrix.max).toBe(2);
  });

  it("backs each cell with its hunks, or the file when it has none", () => {
    const [model, , , other] = layerMatrix(report()).rows;
    expect(model?.cells[0]?.evidence).toEqual([
      {
        anchor: { source: { kind: "pr-hunk", pr: 1, hunkId: expect.any(String) } },
        label: "app/models/user.py:1",
      },
    ]);
    expect(model?.cells[2]?.evidence[0]?.anchor.source.kind).toBe("hunk");
    expect(other?.cells[1]?.evidence).toEqual([
      { anchor: { source: { kind: "pr", number: 2 } }, label: "logo.png" },
    ]);
    expect(other?.cells[2]?.evidence).toEqual([
      { anchor: { source: { kind: "file", path: "logo.png", side: "head" } }, label: "logo.png" },
    ]);
    expect(model?.cells[1]?.evidence).toEqual([]);
  });

  it("turns each PR column into a bar", () => {
    expect(prLayerBars(layerMatrix(report()))).toEqual(
      new Map([
        [
          1,
          { segments: [{ layer: "data-model", lines: 2 }], meaningful: 2, mechanical: 1, files: 2 },
        ],
        [2, { segments: [{ layer: "logic", lines: 1 }], meaningful: 1, mechanical: 0, files: 2 }],
      ]),
    );
  });
});
