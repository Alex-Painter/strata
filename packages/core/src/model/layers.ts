/**
 * Semantic layers. A layer is a slice of the system a reviewer reasons about
 * as one thing, independent of how the code was split into PRs.
 *
 * Order matters: lower layers must qualify before upper layers matter
 * (SPEC.md, "Semantic layers"), so the UI and the verdict walk them in this
 * order. Intent (PRD, ticket, design) is not a code layer; it lives in the
 * Change's context sources and the intent ledger.
 */
export const LAYER_IDS = [
  "data-model",
  "api",
  "logic",
  "ui",
  "tests",
  "config",
  "docs",
  "other",
] as const;

export type LayerId = (typeof LAYER_IDS)[number];

export interface LayerDefinition {
  id: LayerId;
  title: string;
  description: string;
  /** Lower numbers qualify first. */
  order: number;
  /**
   * Changes here must be right first time, so the whole layer is surfaced for
   * mandatory human inspection (SPEC.md, "Inspection by design"). Files in
   * other layers can still be flagged one by one (InspectRule).
   */
  inspect: boolean;
}

export const LAYERS: Record<LayerId, LayerDefinition> = {
  "data-model": {
    id: "data-model",
    title: "Data model",
    description: "Persisted models, schemas, migrations, indexes and constraints.",
    order: 10,
    inspect: true,
  },
  api: {
    id: "api",
    title: "API",
    description: "Public and internal contracts: routes, handlers, request/response schemas.",
    order: 20,
    inspect: true,
  },
  logic: {
    id: "logic",
    title: "Logic",
    description: "Services, domain logic, jobs and integrations.",
    order: 30,
    inspect: false,
  },
  ui: {
    id: "ui",
    title: "UI",
    description: "Pages, components, styles and client state.",
    order: 40,
    inspect: false,
  },
  tests: {
    id: "tests",
    title: "Tests",
    description: "Unit, integration and end-to-end tests, fixtures and snapshots.",
    order: 50,
    inspect: false,
  },
  config: {
    id: "config",
    title: "Config & infra",
    description: "Build, dependencies, CI, deployment and runtime configuration.",
    order: 60,
    inspect: true,
  },
  docs: {
    id: "docs",
    title: "Docs",
    description: "Documentation and comments-only files.",
    order: 70,
    inspect: false,
  },
  other: {
    id: "other",
    title: "Other",
    description: "Files that no rule recognised. Each file shows a gap in the layer rules.",
    order: 80,
    inspect: false,
  },
};

export function compareLayers(a: LayerId, b: LayerId): number {
  return LAYERS[a].order - LAYERS[b].order;
}

/**
 * A path rule that assigns files to a layer. Rules run in order and the first
 * match wins; a repo's own rules run before Strata's defaults, so a team can
 * say "anything under billing/ is data-model".
 */
export interface LayerRule {
  id: string;
  layer: LayerId;
  /** Globs matched against the repo-relative path. */
  paths: string[];
  /** Shown to the reviewer as the reason for the assignment. */
  reason: string;
}

/**
 * A path rule that flags files for close inspection in whatever layer they
 * land, such as anything to do with access or deletion (SPEC.md, "Inspection
 * by design"). Unlike layer rules, every rule that matches gives a flag.
 */
export interface InspectRule {
  id: string;
  /** What the flag is about, shown on the file: "Access and permissions". */
  title: string;
  /**
   * Words looked for in the path's folder and file names, ignoring case:
   * `login`, `permission*` (a word starting so), `*password*` (a word with it
   * anywhere), `sign in` (words in a row), `file:role` or `file:*archiv*` (in
   * the file's name only), `name:policy` (a whole name).
   */
  words: string[];
  /** Words that never count on their own, though a word above would find them: `author` for `auth*`. */
  except: string[];
  /** Globs matched against the repo-relative path, ignoring case. */
  paths: string[];
}

/** A file an inspect rule matched. */
export interface InspectFlag {
  /** The rule's id. */
  rule: string;
  title: string;
  /** The rule, then the word found and the name it was in, or the glob that matched, so a reviewer can check it. */
  reason: string;
}
