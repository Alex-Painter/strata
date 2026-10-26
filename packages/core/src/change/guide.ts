/**
 * The Guide's starting point: Strata's own groups of the whole-stack diff, in
 * reading order. Files go by layer (LAYERS order), then mechanical files by
 * kind (lockfiles, renames, and the generated and vendored code .gitattributes
 * marks), then the rest by directory. Claude may merge, order and label the
 * groups (the engine's summaries step); `assembleGuide` applies its plan so
 * that every file and hunk still lands in exactly one section.
 *
 * Groups come from the whole-stack diff alone, so they are the same however
 * the work was split.
 */
import type { MechanicalKind } from "../model/change.js";
import { stableId } from "../model/ids.js";
import { compareLayers, LAYERS, type LayerId } from "../model/layers.js";
import { type Claim, evidenced, type Guide, type GuideSection } from "../model/report.js";
import { compareStrings, type DiffModel } from "./build.js";

export interface GuideGroup {
  id: string;
  title: string;
  layer: LayerId;
  /** The kind every file in a mechanical group shares; null for meaningful files. */
  mechanical: MechanicalKind | null;
  /** The directory of a meaningful group, "" for the repo root; null for a mechanical one. */
  directory: string | null;
  /** By path. */
  paths: string[];
  /** In file order, then hunk order. */
  hunkIds: string[];
}

/** Within a layer, mechanical groups follow the meaningful ones, in this order. */
const MECHANICAL_ORDER: MechanicalKind[] = [
  "rename",
  "whitespace",
  "snapshot",
  "generated",
  "vendored",
  "lockfile",
  "binary",
];

const MECHANICAL_TITLES: Record<MechanicalKind, string> = {
  rename: "renames",
  whitespace: "whitespace changes",
  snapshot: "snapshots",
  generated: "generated files",
  vendored: "vendored code",
  lockfile: "lockfiles",
  binary: "binary files",
};

export function guideGroups(model: Pick<DiffModel, "files">): GuideGroup[] {
  const groups = new Map<string, GuideGroup>();
  for (const file of model.files) {
    const layer = file.layer.layer;
    const mechanical = file.mechanical?.kind ?? null;
    const directory = mechanical ? null : dirname(file.path);
    const key = [layer, mechanical ?? "", directory ?? ""];
    const id = stableId("guide", ...key);
    let group = groups.get(id);
    if (!group) {
      const what = mechanical
        ? MECHANICAL_TITLES[mechanical]
        : directory
          ? `${directory}/`
          : "top level";
      group = {
        id,
        title: `${LAYERS[layer].title}: ${what}`,
        layer,
        mechanical,
        directory,
        paths: [],
        hunkIds: [],
      };
      groups.set(id, group);
    }
    group.paths.push(file.path);
    group.hunkIds.push(...file.hunkIds);
  }
  return [...groups.values()].sort(
    (a, b) =>
      compareLayers(a.layer, b.layer) ||
      mechanicalRank(a.mechanical) - mechanicalRank(b.mechanical) ||
      compareStrings(a.directory ?? "", b.directory ?? ""),
  );
}

/** Strata's groups as they are, for when Claude isn't asked. */
export function ruleGuide(groups: GuideGroup[]): Guide {
  return { by: "rule", sections: groups.map((group) => section(group, group.title, [])) };
}

/** One section of Claude's plan: groups to read together, by id, with a title. */
export interface GuidePlanSection {
  title: string;
  groupIds: string[];
  about: Claim[];
}

/**
 * Applies Claude's plan. Unknown groups are ignored, a group named twice stays
 * where it was first named, a section left with no groups is dropped, and the
 * groups the plan leaves out follow in Strata's order, as they were.
 */
export function assembleGuide(groups: GuideGroup[], plan: GuidePlanSection[]): Guide {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const used = new Set<string>();
  const sections: GuideSection[] = [];
  for (const planned of plan) {
    const members: GuideGroup[] = [];
    for (const id of planned.groupIds) {
      const group = byId.get(id);
      if (!group || used.has(id)) continue;
      used.add(id);
      members.push(group);
    }
    const [first] = members;
    if (!first) continue;
    const title = planned.title.trim() || members.map((group) => group.title).join(", ");
    sections.push({
      ...section(first, title, evidenced(planned.about)),
      paths: members.flatMap((group) => group.paths),
      hunkIds: members.flatMap((group) => group.hunkIds),
    });
  }
  const planned = sections.length;
  for (const group of groups) {
    if (!used.has(group.id)) sections.push(section(group, group.title, []));
  }
  return { by: planned > 0 ? "llm" : "rule", sections };
}

function section(group: GuideGroup, title: string, about: Claim[]): GuideSection {
  return { id: group.id, title, about, paths: group.paths, hunkIds: group.hunkIds };
}

function mechanicalRank(kind: MechanicalKind | null): number {
  return kind === null ? -1 : MECHANICAL_ORDER.indexOf(kind);
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}
