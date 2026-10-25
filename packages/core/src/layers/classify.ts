/**
 * Puts each file of a diff in a layer and says what's mechanical. In order:
 * the repo's own rules, the repo's .gitattributes, Strata's default rules,
 * then a low-confidence fallback by extension. Everything here depends only on
 * paths, diff lines and the repo's settings, never on how the work was split.
 */
import type { ParsedFile, ParsedHunk } from "../diff/parse.js";
import type { LayerAssignment, MechanicalVerdict } from "../model/change.js";
import type { LayerRule } from "../model/layers.js";
import { type LinguistAttributes, parseGitAttributes } from "./gitattributes.js";
import { mechanicalFile, mechanicalHunk } from "./mechanical.js";
import { createPathClassifier } from "./rules.js";

export interface Classifier {
  layer(file: ParsedFile): LayerAssignment;
  mechanicalFile(file: ParsedFile): MechanicalVerdict | null;
  mechanicalHunk(hunk: ParsedHunk): MechanicalVerdict | null;
}

export interface ClassifierOptions {
  /** The repo's own rules, from Strata's data folder. They run first. */
  repoRules?: readonly LayerRule[];
  /** The text of the repo's root .gitattributes, if it has one. */
  gitattributes?: string | null;
}

export function createClassifier(options: ClassifierOptions = {}): Classifier {
  const byRepoRule = createPathClassifier(options.repoRules ?? [], []);
  const byDefault = createPathClassifier();
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
      return byDefault(file.path);
    },
    mechanicalFile: (file) => mechanicalFile(file, attributes(file.path)),
    mechanicalHunk,
  };
}
