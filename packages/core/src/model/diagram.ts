/**
 * Data-model diagrams, generated from schema files and migrations rather than
 * from an LLM reading code, and always shown as a diff against the base.
 */
import type { Evidence } from "./change.js";

export type DiffStatus = "added" | "removed" | "changed" | "unchanged";

export interface DataModelField {
  name: string;
  type: string;
  nullable: boolean;
  /** Primary key, unique, indexed, default, etc. */
  attributes: string[];
}

export interface DataModelEntity {
  /** Stable across revisions: the entity's qualified name. */
  id: string;
  name: string;
  /** e.g. "beanie.Document", "prisma model", "sql table". */
  kind: string;
  fields: DataModelField[];
  /** Where the entity is defined at this revision. */
  definedAt?: { path: string; line: number };
}

export interface DataModelRelation {
  from: string;
  to: string;
  label: string;
  cardinality: "one-to-one" | "one-to-many" | "many-to-many" | "unknown";
}

export interface DataModel {
  entities: DataModelEntity[];
  relations: DataModelRelation[];
}

export interface FieldDiff {
  name: string;
  status: DiffStatus;
  before?: DataModelField;
  after?: DataModelField;
}

export interface EntityDiff {
  id: string;
  name: string;
  status: DiffStatus;
  fields: FieldDiff[];
  before?: DataModelEntity;
  after?: DataModelEntity;
}

export interface DataModelDiagram {
  id: string;
  title: string;
  /** Which extractor read the schema, so a reviewer can judge coverage. */
  extractor: string;
  entities: EntityDiff[];
  relations: Array<DataModelRelation & { status: DiffStatus }>;
  /** Mermaid `erDiagram` source, rendered client-side. */
  mermaid: string;
  /** The schema/migration hunks the diagram was built from. */
  evidence: Evidence[];
}
