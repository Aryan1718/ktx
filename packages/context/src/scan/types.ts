export type KloConnectionDriver =
  | 'sqlite'
  | 'postgres'
  | 'postgresql'
  | 'sqlserver'
  | 'bigquery'
  | 'snowflake'
  | 'posthog'
  | 'mysql'
  | 'clickhouse';

export type KloScanMode = 'structural' | 'relationships' | 'enriched';

export type KloScanTrigger = 'cli' | 'mcp' | 'schema_scan' | 'scheduled' | 'manual';

export interface KloConnectorCapabilities {
  structuralIntrospection: true;
  tableSampling: boolean;
  columnSampling: boolean;
  columnStats: boolean;
  readOnlySql: boolean;
  nestedAnalysis: boolean;
  eventStreamDiscovery: boolean;
  formalForeignKeys: boolean;
  estimatedRowCounts: boolean;
}

export type KloOptionalConnectorCapabilities = Partial<Omit<KloConnectorCapabilities, 'structuralIntrospection'>>;

export function createKloConnectorCapabilities(
  capabilities: KloOptionalConnectorCapabilities = {},
): KloConnectorCapabilities {
  return {
    structuralIntrospection: true,
    tableSampling: capabilities.tableSampling ?? false,
    columnSampling: capabilities.columnSampling ?? false,
    columnStats: capabilities.columnStats ?? false,
    readOnlySql: capabilities.readOnlySql ?? false,
    nestedAnalysis: capabilities.nestedAnalysis ?? false,
    eventStreamDiscovery: capabilities.eventStreamDiscovery ?? false,
    formalForeignKeys: capabilities.formalForeignKeys ?? false,
    estimatedRowCounts: capabilities.estimatedRowCounts ?? false,
  };
}

export interface KloSchemaScope {
  catalogs?: string[];
  schemas?: string[];
  datasets?: string[];
}

export type KloSchemaTableKind = 'table' | 'view' | 'external' | 'event_stream';

export type KloSchemaDimensionType = 'time' | 'string' | 'number' | 'boolean';

export interface KloSchemaColumn {
  name: string;
  nativeType: string;
  normalizedType: string;
  dimensionType: KloSchemaDimensionType;
  nullable: boolean;
  primaryKey: boolean;
  comment: string | null;
}

export interface KloSchemaForeignKey {
  fromColumn: string;
  toCatalog: string | null;
  toDb: string | null;
  toTable: string;
  toColumn: string;
  constraintName: string | null;
}

export interface KloSchemaTable {
  catalog: string | null;
  db: string | null;
  name: string;
  kind: KloSchemaTableKind;
  comment: string | null;
  estimatedRows: number | null;
  columns: KloSchemaColumn[];
  foreignKeys: KloSchemaForeignKey[];
}

export interface KloSchemaSnapshot {
  connectionId: string;
  driver: KloConnectionDriver;
  extractedAt: string;
  scope: KloSchemaScope;
  tables: KloSchemaTable[];
  metadata: Record<string, unknown>;
}

export interface KloCredentialEnvReference {
  kind: 'env';
  name: string;
}

export interface KloCredentialFileReference {
  kind: 'file';
  path: string;
}

export interface KloResolvedCredentialEnvelope {
  kind: 'resolved';
  source: 'standalone' | 'host';
  values: Record<string, unknown>;
  redacted?: boolean;
}

export type KloCredentialEnvelope =
  | KloCredentialEnvReference
  | KloCredentialFileReference
  | KloResolvedCredentialEnvelope;

export interface KloNetworkEndpoint {
  host: string;
  port: number;
  close?: () => Promise<void>;
}

export interface KloNetworkTunnelRequest<TConnection = Record<string, unknown>> {
  connectionId: string;
  driver: KloConnectionDriver;
  host: string;
  port: number;
  connection: TConnection;
}

export interface KloNetworkTunnelPort<TConnection = Record<string, unknown>> {
  resolveEndpoint(input: KloNetworkTunnelRequest<TConnection>): Promise<KloNetworkEndpoint | null>;
}

export interface KloScanInput {
  connectionId: string;
  driver: KloConnectionDriver;
  scope?: KloSchemaScope;
  mode?: KloScanMode;
  dryRun?: boolean;
  detectRelationships?: boolean;
  credentials?: KloCredentialEnvelope;
  metadata?: Record<string, unknown>;
}

export interface KloProgressUpdateOptions {
  transient?: boolean;
}

export interface KloProgressPort {
  update(progress: number, message?: string, options?: KloProgressUpdateOptions): Promise<void>;
  startPhase(weight: number): KloProgressPort;
}

export interface KloScanLoggerPort {
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

export interface KloScanContext {
  runId: string;
  signal?: AbortSignal;
  progress?: KloProgressPort;
  logger?: KloScanLoggerPort;
}

export interface KloTableRef {
  catalog: string | null;
  db: string | null;
  name: string;
}

export interface KloTableSampleInput {
  connectionId: string;
  table: KloTableRef;
  columns?: string[];
  limit: number;
}

export interface KloTableSampleResult {
  headers: string[];
  rows: unknown[][];
  totalRows: number;
}

export interface KloColumnSampleInput {
  connectionId: string;
  table: KloTableRef;
  column: string;
  limit: number;
}

export interface KloColumnSampleResult {
  values: unknown[];
  nullCount: number | null;
  distinctCount: number | null;
}

export interface KloColumnStatsInput {
  connectionId: string;
  table: KloTableRef;
  column: string;
}

export interface KloColumnStatsResult {
  min: unknown;
  max: unknown;
  average: number | null;
  nullCount: number | null;
  distinctCount: number | null;
}

export interface KloEventTypeDiscoveryInput {
  connectionId: string;
  table: KloTableRef;
  eventColumn: string;
  limit: number;
  minCount?: number;
  lookbackDays?: number;
}

export interface KloEventTypeDiscovery {
  value: string;
  count: number;
}

export interface KloEventPropertyDiscoveryInput {
  connectionId: string;
  table: KloTableRef;
  jsonColumn: string;
  sampleSize: number;
  limit: number;
  lookbackDays?: number;
}

export interface KloEventPropertyDiscovery {
  key: string;
  count: number;
}

export interface KloEventPropertyValuesInput {
  connectionId: string;
  table: KloTableRef;
  jsonColumn: string;
  propertyKey: string;
  limit: number;
  maxCardinality?: number;
  lookbackDays?: number;
}

export interface KloEventPropertyValuesResult {
  values: string[];
  cardinality: number;
}

export interface KloEventStreamDiscoveryPort {
  listEventTypes(input: KloEventTypeDiscoveryInput, ctx: KloScanContext): Promise<KloEventTypeDiscovery[]>;
  listPropertyKeys(input: KloEventPropertyDiscoveryInput, ctx: KloScanContext): Promise<KloEventPropertyDiscovery[]>;
  listPropertyValues(
    input: KloEventPropertyValuesInput,
    ctx: KloScanContext,
  ): Promise<KloEventPropertyValuesResult | null>;
}

export interface KloReadOnlyQueryInput {
  connectionId: string;
  sql: string;
  maxRows?: number;
}

export interface KloQueryResult {
  headers: string[];
  headerTypes?: string[];
  rows: unknown[][];
  totalRows: number;
  rowCount: number | null;
}

export interface KloScanConnector {
  id: string;
  driver: KloConnectionDriver;
  capabilities: KloConnectorCapabilities;
  eventStreamDiscovery?: KloEventStreamDiscoveryPort;
  introspect(input: KloScanInput, ctx: KloScanContext): Promise<KloSchemaSnapshot>;
  sampleColumn?(input: KloColumnSampleInput, ctx: KloScanContext): Promise<KloColumnSampleResult>;
  sampleTable?(input: KloTableSampleInput, ctx: KloScanContext): Promise<KloTableSampleResult>;
  columnStats?(input: KloColumnStatsInput, ctx: KloScanContext): Promise<KloColumnStatsResult | null>;
  executeReadOnly?(input: KloReadOnlyQueryInput, ctx: KloScanContext): Promise<KloQueryResult>;
  cleanup?(): Promise<void>;
}

export interface KloEmbeddingPort {
  dimensions: number;
  maxBatchSize: number;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export interface KloStructuralSyncStats {
  tablesCreated: number;
  tablesUpdated: number;
  tablesDeleted: number;
  columnsCreated: number;
  columnsUpdated: number;
  columnsDeleted: number;
}

export interface KloScanDiffSummary {
  tablesAdded: number;
  tablesModified: number;
  tablesDeleted: number;
  tablesUnchanged: number;
  columnsAdded: number;
  columnsModified: number;
  columnsDeleted: number;
}

export interface KloScanArtifactPaths {
  rawSourcesDir: string | null;
  reportPath: string | null;
  manifestShards: string[];
  enrichmentArtifacts: string[];
}

export type KloScanWarningCode =
  | 'connector_capability_missing'
  | 'sampling_failed'
  | 'statistics_failed'
  | 'llm_unavailable'
  | 'embedding_unavailable'
  | 'scan_enrichment_backend_not_configured'
  | 'relationship_validation_failed'
  | 'relationship_llm_invalid_reference'
  | 'relationship_llm_proposal_failed'
  | 'credential_redacted'
  | 'enrichment_failed';

export interface KloScanWarning {
  code: KloScanWarningCode;
  message: string;
  table?: string;
  column?: string;
  recoverable: boolean;
  metadata?: Record<string, unknown>;
}

export interface KloScanEnrichmentSummary {
  dataDictionary: 'skipped' | 'completed' | 'failed';
  tableDescriptions: 'skipped' | 'completed' | 'failed';
  columnDescriptions: 'skipped' | 'completed' | 'failed';
  embeddings: 'skipped' | 'completed' | 'failed';
  deterministicRelationships: 'skipped' | 'completed' | 'failed';
  llmRelationshipValidation: 'skipped' | 'completed' | 'failed';
  statisticalValidation: 'skipped' | 'completed' | 'failed';
}

export interface KloScanRelationshipSummary {
  accepted: number;
  review: number;
  rejected: number;
  skipped: number;
}

export type KloScanEnrichmentStage = 'descriptions' | 'embeddings' | 'relationships';

export interface KloScanEnrichmentStateSummary {
  resumedStages: KloScanEnrichmentStage[];
  completedStages: KloScanEnrichmentStage[];
  failedStages: KloScanEnrichmentStage[];
}

export interface KloScanReport {
  connectionId: string;
  driver: KloConnectionDriver;
  syncId: string;
  runId: string;
  trigger: KloScanTrigger;
  mode: KloScanMode;
  dryRun: boolean;
  artifactPaths: KloScanArtifactPaths;
  diffSummary: KloScanDiffSummary;
  manifestShardsWritten: number;
  structuralSyncStats: KloStructuralSyncStats;
  enrichment: KloScanEnrichmentSummary;
  capabilityGaps: Array<keyof Omit<KloConnectorCapabilities, 'structuralIntrospection'>>;
  warnings: KloScanWarning[];
  relationships: KloScanRelationshipSummary;
  enrichmentState: KloScanEnrichmentStateSummary;
  createdAt: string;
}
