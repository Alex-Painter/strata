/**
 * Puts each file of a diff in a layer, says what's mechanical and flags what
 * to inspect. Layers come, in order, from the repo's own rules, the repo's
 * .gitattributes, Strata's default rules, Claude's judgement for files no rule
 * matched (when the repo allows it), then a low-confidence fallback by
 * extension. Everything here depends only on paths, diff lines, the repo's
 * settings and those judgements, never on how the work was split.
 */
import type { ParsedFile, ParsedHunk } from "../diff/parse.js";
import type { LayerAssignment, MechanicalVerdict } from "../model/change.js";
import type { InspectFlag, LayerRule } from "../model/layers.js";
import { type LinguistAttributes, parseGitAttributes } from "./gitattributes.js";
import { createInspector } from "./inspect.js";
import { mechanicalFile, mechanicalHunk } from "./mechanical.js";
import { createPathClassifier } from "./rules.js";

export interface Classifier {
  layer(file: ParsedFile): LayerAssignment;
  mechanicalFile(file: ParsedFile): MechanicalVerdict | null;
  mechanicalHunk(hunk: ParsedHunk): MechanicalVerdict | null;
  /**
   * The inspect rules a file matches, given the layer it landed in and its
   * mechanical verdict. A mechanical file has nothing to inspect.
   */
  inspect(
    file: ParsedFile,
    layer: LayerAssignment,
    mechanical: MechanicalVerdict | null,
  ): InspectFlag[];
}

export interface ClassifierOptions {
  /** The repo's own rules, from Strata's data folder. They run first. */
  repoRules?: readonly LayerRule[];
  /** The text of the repo's root .gitattributes, if it has one. */
  gitattributes?: string | null;
  /**
   * Layers Claude gave for files no rule matched, by path. They're only used
   * where the rules have nothing better than a guess.
   */
  judged?: ReadonlyMap<string, LayerAssignment>;
}

export function createClassifier(options: ClassifierOptions = {}): Classifier {
  const byRepoRule = createPathClassifier(options.repoRules ?? [], []);
  const byDefault = createPathClassifier();
  const inspector = createInspector();
  const attributes: (path: string) => LinguistAttributes = options.gitattributes
    ? parseGitAttributes(options.gitattributes)
    : () => ({ generated: false, vendored: false, documentation: false });

  return {
    layer(file) {
      const repo = byRepoRule(file.path);
      if (repo.by === "rule") return repo;
      if (attributes(file.path).documentation) {
        return {
          layer: "docs",
          by: "rule",
          reason: "Marked linguist-documentation in .gitattributes",
          confidence: "high",
        };
      }
      const assigned = byDefault(file.path);
      if (assigned.by === "default") return options.judged?.get(file.path) ?? assigned;
      return assigned;
    },
    mechanicalFile: (file) => mechanicalFile(file, attributes(file.path)),
    mechanicalHunk,
    inspect: (file, layer, mechanical) => (mechanical ? [] : inspector(file, layer.layer)),
  };
}
