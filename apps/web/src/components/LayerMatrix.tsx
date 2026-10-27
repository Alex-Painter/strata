import type { LayerId } from "@strata/core/model";
import { LAYERS } from "@strata/core/model";
import type { LayerMatrix, MatrixCell } from "@strata/core/stack";
import { useState } from "react";
import { fileAnchor } from "./Diff";

/** Shading steps for meaningful lines, against the busiest PR cell. */
const STEPS = 5;
/** How much of the text colour each step mixes in: one grey ramp, no hue. */
const HEAT = [0, 6, 11, 18, 27, 38];

/**
 * The layer by PR matrix: which PR touches which layer, and how much. A cell
 * opens to its files, each linking to its diff. Net is the whole stack.
 */
export function LayerMatrixView({
  matrix,
  titles,
  onOpen,
}: {
  matrix: LayerMatrix;
  titles: Map<number, string>;
  /** Shows a file's diff: in the whole stack for Net, or in that PR's scope. */
  onOpen: (pr: number | null, path: string) => void;
}) {
  const [open, setOpen] = useState<{ layer: LayerId; pr: number | null } | null>(null);
  const selected = open
    ? matrix.rows.find((row) => row.layer === open.layer)?.cells.find((cell) => cell.pr === open.pr)
    : undefined;
  const revised = matrix.rows.some((row) => row.cells.some((cell) => cell.revised > 0));
  if (matrix.rows.length === 0) return null;

  return (
    <section aria-labelledby="matrix-heading" className="grid gap-2">
      <h2 id="matrix-heading" className="h2">
        Layers by PR
      </h2>
      <div className="overflow-x-auto rounded-md border border-line">
        <table aria-labelledby="matrix-heading" className="border-collapse text-[12px]">
          <thead>
            <tr className="text-faint">
              <th scope="col" className="px-3 py-1.5 text-left font-normal">
                <span className="sr-only">Layer</span>
              </th>
              {matrix.prs.map((pr) => (
                <th
                  key={pr}
                  scope="col"
                  title={titles.get(pr)}
                  className="px-1 py-1.5 font-mono font-normal"
                >
                  #{pr}
                </th>
              ))}
              <th scope="col" className="border-l border-line px-2 py-1.5 font-medium text-muted">
                Net
              </th>
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row.layer} data-layer={row.layer}>
                <th scope="row" className="px-3 py-0.5 text-left font-normal whitespace-nowrap">
                  <span className="flex items-center gap-1.5">
                    {LAYERS[row.layer].title}
                    {LAYERS[row.layer].inspect && (
                      <span
                        className="text-[11px] text-faint"
                        title="Inspect these changes closely."
                      >
                        Inspect
                      </span>
                    )}
                  </span>
                </th>
                {row.cells.map((cell) => (
                  <td
                    key={cell.pr ?? "net"}
                    className={`p-0.5 ${cell.pr === null ? "border-l border-line" : ""}`}
                  >
                    <Cell
                      cell={cell}
                      max={matrix.max}
                      pressed={open?.layer === cell.layer && open.pr === cell.pr}
                      onToggle={() =>
                        setOpen((current) =>
                          current?.layer === cell.layer && current.pr === cell.pr
                            ? null
                            : { layer: cell.layer, pr: cell.pr },
                        )
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sub">
        Lines in meaningful hunks; +Nm counts mechanical lines apart.
        {revised &&
          " ↻ marks lines a later PR changed again, which is why the PR columns don't add up to Net."}
      </p>
      {selected && selected.files.length > 0 && (
        <CellFiles cell={selected} title={titles.get(selected.pr ?? -1)} onOpen={onOpen} />
      )}
    </section>
  );
}

function Cell({
  cell,
  max,
  pressed,
  onToggle,
}: {
  cell: MatrixCell;
  max: number;
  pressed: boolean;
  onToggle: () => void;
}) {
  if (cell.files.length === 0) return <span className="block h-8 w-14" />;
  const step =
    cell.meaningful === 0
      ? 0
      : Math.max(1, Math.ceil((cell.meaningful / Math.max(max, cell.meaningful)) * STEPS));
  const where = cell.pr === null ? "the whole stack" : `#${cell.pr}`;
  const label = [
    `${LAYERS[cell.layer].title} in ${where}: ${lines(cell.meaningful)}`,
    cell.mechanical > 0 ? `${lines(cell.mechanical)} mechanical` : null,
    cell.revised > 0 ? `${lines(cell.revised)} changed again later` : null,
    files(cell.files.length),
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={onToggle}
      data-step={step}
      className={`flex h-8 w-14 flex-col items-center justify-center rounded leading-tight ${
        pressed ? "ring-2 ring-accent" : "hover:ring-1 hover:ring-line-2"
      } ${step === 0 ? "border border-dashed border-line text-muted" : ""}`}
      style={
        step > 0
          ? { background: `color-mix(in srgb, var(--fg) ${HEAT[step]}%, transparent)` }
          : undefined
      }
    >
      <span className="font-mono">{cell.meaningful}</span>
      {(cell.mechanical > 0 || cell.revised > 0) && (
        <span className="text-[10px] opacity-80">
          {cell.revised > 0 && `↻${cell.revised}`}
          {cell.revised > 0 && cell.mechanical > 0 && " "}
          {cell.mechanical > 0 && `+${cell.mechanical}m`}
        </span>
      )}
    </button>
  );
}

function CellFiles({
  cell,
  title,
  onOpen,
}: {
  cell: MatrixCell;
  title: string | undefined;
  onOpen: (pr: number | null, path: string) => void;
}) {
  const where = cell.pr === null ? "the whole stack" : `#${cell.pr}${title ? ` ${title}` : ""}`;
  return (
    <section
      aria-label={`${LAYERS[cell.layer].title} in ${cell.pr === null ? "the whole stack" : `#${cell.pr}`}`}
      className="rounded-md border border-line"
    >
      <p className="border-b border-line px-3 py-1.5">
        <span className="font-medium">{LAYERS[cell.layer].title}</span>{" "}
        <span className="text-muted">in {where}</span>
      </p>
      <ul className="py-1">
        {cell.files.map((file) => (
          <li key={file.path}>
            <a
              href={`#${fileAnchor(file.path)}`}
              onClick={(event) => {
                event.preventDefault();
                onOpen(cell.pr, file.path);
              }}
              className="flex items-baseline gap-2 px-3 py-1 hover:bg-hover"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{file.path}</span>
              <span className="shrink-0 text-[12px] text-faint">
                {[
                  lines(file.meaningful),
                  file.mechanical > 0 ? `${file.mechanical} mechanical` : null,
                  file.hunkIds.length === 1 ? "1 hunk" : `${file.hunkIds.length} hunks`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

const lines = (n: number) => (n === 1 ? "1 line" : `${n} lines`);
const files = (n: number) => (n === 1 ? "1 file" : `${n} files`);
