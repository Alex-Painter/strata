import type { ChangeReport, Claim, LayerId, PrPart } from "@strata/core/model";
import { LAYERS } from "@strata/core/model";
import { ClaimList } from "../components/Claims";
import { FileList } from "../components/Diff";
import { GuideView } from "../components/Guide";
import { citedIds, type Display, filesIn, hunksOf, type ScopedDiff, type Selection } from "./model";

/**
 * One layer of the diff in scope. The canvas has a slot at the top for the
 * layer's diagram; nothing fills it yet, since the engine has no extractor for
 * one (core's model/diagram.ts). Under it: what the Guide says about the
 * layer, then its files, each with its hunks.
 */
export function LayerView({
  report,
  diff,
  part,
  layer,
  display,
  selection,
  onSelect,
  onFile,
  onScope,
}: {
  report: ChangeReport;
  diff: ScopedDiff;
  part: PrPart | null;
  layer: LayerId;
  display: Display;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  /** Opens a file, which may be in another layer. */
  onFile: (path: string) => void;
  onScope: (pr: number | null) => void;
}) {
  const files = filesIn(diff, layer);
  const paths = new Set(files.map((file) => file.path));
  const selected =
    selection?.kind === "file" ? selection.path : selection?.kind === "hunk" ? selection.id : null;
  const claim = selection?.kind === "claim" ? selection.claim : null;
  const onClaim = (by: string) => (picked: Claim) => onSelect({ kind: "claim", claim: picked, by });

  if (files.length === 0) {
    return (
      <p className="text-muted">
        {diff.pr === null
          ? `No ${LAYERS[layer].title} changes.`
          : `#${diff.pr} has no ${LAYERS[layer].title} changes.`}
      </p>
    );
  }
  // The Guide is about the whole stack; a PR's scope has its own summary.
  const sections = part
    ? []
    : report.guide.sections.filter((section) => section.paths.some((path) => paths.has(path)));
  const prClaims = part
    ? part.summary.filter((item) =>
        citedIds(item).some((id) => paths.has(diff.byId.get(id)?.path ?? "")),
      )
    : [];
  return (
    <>
      <LayerDiagram layer={layer} />
      <GuideView
        guide={report.guide}
        files={diff.files}
        hunks={diff.byId}
        onFile={onFile}
        selected={claim}
        onClaim={(picked) => {
          const section = sections.find((s) => s.about.includes(picked));
          onClaim(`the Guide's “${section?.title ?? "section"}”`)(picked);
        }}
        of={report.stack ? "the whole stack" : "the range"}
        sections={sections}
        heading="In the Guide"
      />
      {prClaims.length > 0 && (
        <section aria-labelledby="layer-claims-heading" className="grid gap-2">
          <h2 id="layer-claims-heading" className="h2">
            What #{part?.pr} does here
          </h2>
          <ClaimList
            claims={prClaims}
            hunks={diff.byId}
            selected={claim}
            onSelect={onClaim(`#${part?.pr}'s own diff`)}
          />
        </section>
      )}
      <section aria-label={`${LAYERS[layer].title} files`} className="grid gap-3">
        <h2 className="h2">Files</h2>
        <FileList
          files={files}
          hunksOf={(file) => hunksOf(file, diff)}
          chips={display.seams ? diff.chips : null}
          fold={display.fold}
          selected={selected}
          onFile={(path) => onSelect({ kind: "file", path })}
          onHunk={(id) => onSelect({ kind: "hunk", id })}
          onPr={(pr) => onScope(pr)}
        />
      </section>
    </>
  );
}

/**
 * Where a layer's diagram goes once the engine draws one: the data model's
 * entities and fields first (SPEC.md), from report.diagrams. Until then it
 * shows nothing rather than a guess.
 */
function LayerDiagram(_: { layer: LayerId }) {
  return null;
}
