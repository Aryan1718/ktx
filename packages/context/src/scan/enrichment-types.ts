import type { KloSchemaDimensionType, KloTableRef } from './types.js';

export type KloDescriptionSource = 'ai' | 'db' | 'dbt' | 'user' | (string & {});

export type KloRelationshipSource = 'formal' | 'inferred' | 'manual';

export type KloRelationshipType = 'many_to_one' | 'one_to_many' | 'one_to_one';

export interface KloEnrichedColumn {
  id: string;
  tableId: string;
  tableRef: KloTableRef;
  name: string;
  nativeType: string;
  normalizedType: string;
  dimensionType: KloSchemaDimensionType;
  nullable: boolean;
  primaryKey: boolean;
  parentColumnId: string | null;
  descriptions: Partial<Record<KloDescriptionSource, string>>;
  embedding: number[] | null;
  sampleValues: string[] | null;
  cardinality: number | null;
}

export interface KloEnrichedTable {
  id: string;
  ref: KloTableRef;
  enabled: boolean;
  descriptions: Partial<Record<KloDescriptionSource, string>>;
  columns: KloEnrichedColumn[];
}

export interface KloRelationshipEndpoint {
  tableId: string;
  columnIds: string[];
  table: KloTableRef;
  columns: string[];
}

export interface KloEnrichedRelationship {
  id: string;
  source: KloRelationshipSource;
  from: KloRelationshipEndpoint;
  to: KloRelationshipEndpoint;
  relationshipType: KloRelationshipType;
  confidence: number;
  isPrimaryKeyReference: boolean;
}

export interface KloEnrichedSchema {
  connectionId: string;
  tables: KloEnrichedTable[];
  relationships: KloEnrichedRelationship[];
}

export interface KloStructuralSyncPlan {
  connectionId: string;
  snapshotId: string;
  operations: Array<Record<string, unknown>>;
}

export interface KloDescriptionUpdate {
  connectionId: string;
  table: KloTableRef;
  source: KloDescriptionSource;
  tableDescription?: string;
  columnDescriptions?: Record<string, string | null>;
}

const PREFERRED_METADATA_FIELD_NAMES = [
  'tags',
  'constraints',
  'enum_values',
  'freshness',
  'tests',
  'lineage',
] as const;

export interface KloMetadataUpdate {
  connectionId: string;
  table: KloTableRef;
  source: KloDescriptionSource;
  tableFields?: Record<string, unknown>;
  columnFields?: Record<string, Record<string, unknown>>;
}

export interface KloJoinUpdate {
  connectionId: string;
  fromTable: string;
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
  relationship: KloRelationshipType;
  author: string;
  authorEmail: string;
}

export interface KloColumnSampleUpdate {
  columnId: string;
  sampleValues: string[] | null;
  cardinality: number | null;
}

export interface KloEmbeddingUpdate {
  columnId: string;
  text: string;
  embedding: number[];
}

export interface KloSkippedRelationship {
  relationshipId: string;
  reason: string;
}

export interface KloRelationshipUpdate {
  connectionId: string;
  accepted: KloEnrichedRelationship[];
  rejected: KloEnrichedRelationship[];
  skipped: KloSkippedRelationship[];
}

export interface KloScanMetadataStore {
  loadSchema(connectionId: string): Promise<KloEnrichedSchema | null>;
  applyStructuralPlan(plan: KloStructuralSyncPlan): Promise<KloEnrichedSchema>;
  updateDescriptions(input: KloDescriptionUpdate): Promise<void>;
  updateColumnSamples(input: KloColumnSampleUpdate[]): Promise<void>;
  updateColumnEmbeddings(input: KloEmbeddingUpdate[]): Promise<void>;
  updateInferredRelationships(input: KloRelationshipUpdate): Promise<void>;
}
