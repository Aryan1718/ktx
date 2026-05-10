import type { KloLlmProvider } from '@klo/llm';
import { buildDefaultKloProjectConfig, type KloScanRelationshipConfig } from '../project/config.js';
import { type KloDescriptionColumnTable, KloDescriptionGenerator } from './description-generation.js';
import { buildKloColumnEmbeddingText } from './embedding-text.js';
import {
  completedKloScanEnrichmentStateSummary,
  computeKloScanEnrichmentInputHash,
  type KloScanEnrichmentStateStore,
  summarizeKloScanEnrichmentState,
} from './enrichment-state.js';
import { skippedKloScanEnrichmentSummary } from './enrichment-summary.js';
import type {
  KloEmbeddingUpdate,
  KloEnrichedColumn,
  KloEnrichedRelationship,
  KloEnrichedSchema,
  KloEnrichedTable,
  KloRelationshipEndpoint,
  KloRelationshipUpdate,
} from './enrichment-types.js';
import type { KloCompositeRelationshipCandidate } from './relationship-composite-candidates.js';
import type { KloResolvedRelationshipDiscoveryCandidate } from './relationship-graph-resolver.js';
import { discoverKloRelationships } from './relationship-discovery.js';
import type { KloRelationshipProfileArtifact } from './relationship-profiling.js';
import type {
  KloEmbeddingPort,
  KloProgressPort,
  KloScanConnector,
  KloScanContext,
  KloScanEnrichmentStage,
  KloScanEnrichmentStateSummary,
  KloScanEnrichmentSummary,
  KloScanMode,
  KloScanRelationshipSummary,
  KloScanWarning,
  KloSchemaColumn,
  KloSchemaForeignKey,
  KloSchemaSnapshot,
  KloSchemaTable,
  KloTableRef,
} from './types.js';

export interface DeterministicLocalScanEnrichmentProviderOptions {
  embeddingDimensions?: number;
  maxBatchSize?: number;
}

export interface KloLocalScanEnrichmentProviders {
  llm: KloLlmProvider;
  embedding: KloEmbeddingPort;
}

export interface KloLocalScanEnrichmentInput {
  connectionId: string;
  mode: KloScanMode;
  detectRelationships?: boolean;
  connector: KloScanConnector;
  context: KloScanContext;
  providers: KloLocalScanEnrichmentProviders | null;
  stateStore?: KloScanEnrichmentStateStore | null;
  syncId?: string;
  providerIdentity?: Record<string, unknown>;
  relationshipSettings?: KloScanRelationshipConfig;
  now?: () => Date;
}

export interface KloLocalScanEnrichmentResult {
  snapshot: KloSchemaSnapshot;
  summary: KloScanEnrichmentSummary;
  relationships: KloScanRelationshipSummary;
  state: KloScanEnrichmentStateSummary;
  warnings: KloScanWarning[];
  descriptionUpdates: Array<{
    table: KloTableRef;
    tableDescription: string | null;
    columnDescriptions: Record<string, string | null>;
  }>;
  embeddingUpdates: KloEmbeddingUpdate[];
  relationshipUpdate: KloRelationshipUpdate | null;
  relationshipProfile: KloRelationshipProfileArtifact | null;
  resolvedRelationships: KloResolvedRelationshipDiscoveryCandidate[] | null;
  compositeRelationships: KloCompositeRelationshipCandidate[] | null;
}

function tableId(table: KloSchemaTable): string {
  return [table.catalog, table.db, table.name].filter((value): value is string => Boolean(value)).join('.');
}

function columnId(table: KloSchemaTable, column: KloSchemaColumn): string {
  return `${tableId(table)}.${column.name}`;
}

function tableRef(table: KloSchemaTable): KloTableRef {
  return {
    catalog: table.catalog,
    db: table.db,
    name: table.name,
  };
}

function endpoint(table: KloEnrichedTable, column: KloEnrichedColumn): KloRelationshipEndpoint {
  return {
    tableId: table.id,
    columnIds: [column.id],
    table: table.ref,
    columns: [column.name],
  };
}

function relationshipId(from: KloRelationshipEndpoint, to: KloRelationshipEndpoint): string {
  return `${from.tableId}:(${from.columnIds.join(',')})->${to.tableId}:(${to.columnIds.join(',')})`;
}

function targetMatchesForeignKey(table: KloEnrichedTable, foreignKey: KloSchemaForeignKey): boolean {
  return (
    table.ref.name === foreignKey.toTable &&
    (foreignKey.toCatalog === null || table.ref.catalog === foreignKey.toCatalog) &&
    (foreignKey.toDb === null || table.ref.db === foreignKey.toDb)
  );
}

function formalRelationshipsFromSnapshot(
  snapshot: KloSchemaSnapshot,
  tables: readonly KloEnrichedTable[],
): KloEnrichedRelationship[] {
  const tableById = new Map(tables.map((table) => [table.id, table]));
  const relationships: KloEnrichedRelationship[] = [];

  for (const sourceTableSnapshot of snapshot.tables) {
    const sourceTable = tableById.get(tableId(sourceTableSnapshot));
    if (!sourceTable) {
      continue;
    }

    for (const foreignKey of sourceTableSnapshot.foreignKeys) {
      const sourceColumn = sourceTable.columns.find((column) => column.name === foreignKey.fromColumn);
      const targetTable = tables.find((table) => targetMatchesForeignKey(table, foreignKey));
      const targetColumn = targetTable?.columns.find((column) => column.name === foreignKey.toColumn);
      if (!sourceColumn || !targetTable || !targetColumn) {
        continue;
      }

      const from = endpoint(sourceTable, sourceColumn);
      const to = endpoint(targetTable, targetColumn);
      relationships.push({
        id: relationshipId(from, to),
        source: 'formal',
        from,
        to,
        relationshipType: 'many_to_one',
        confidence: 1,
        isPrimaryKeyReference: true,
      });
    }
  }

  return relationships.sort((left, right) => left.id.localeCompare(right.id));
}

function providerlessEnrichedWarning(relationshipDetection: boolean): KloScanWarning {
  return {
    code: 'scan_enrichment_backend_not_configured',
    message:
      'Skipping description and embedding enrichment because scan.enrichment.mode is not configured; relationship discovery still ran.',
    recoverable: true,
    metadata: {
      skippedStages: ['descriptions', 'embeddings'],
      relationshipDetection,
    },
  };
}

function hashEmbedding(text: string, dimensions: number): number[] {
  const values = Array.from({ length: dimensions }, (_, index) => {
    let hash = index + 17;
    for (const char of text) {
      hash = (hash * 31 + char.charCodeAt(0) + index) % 1009;
    }
    return Number(((hash % 200) / 100 - 1).toFixed(4));
  });
  return values;
}

export function createDeterministicLocalScanEnrichmentProviders(
  options: DeterministicLocalScanEnrichmentProviderOptions = {},
): KloLocalScanEnrichmentProviders {
  const dimensions = options.embeddingDimensions ?? 8;
  const maxBatchSize = options.maxBatchSize ?? 64;
  return {
    llm: deterministicLlmProvider(),
    embedding: {
      dimensions,
      maxBatchSize,
      async embedBatch(texts) {
        return texts.map((text) => hashEmbedding(text, dimensions));
      },
    },
  };
}

function deterministicLlmProvider(): KloLlmProvider {
  const model = { modelId: 'deterministic-scan', provider: 'deterministic' };
  return {
    getModel() {
      return model as ReturnType<KloLlmProvider['getModel']>;
    },
    getModelByName() {
      return model as ReturnType<KloLlmProvider['getModelByName']>;
    },
    cacheMarker() {
      return undefined;
    },
    repairToolCallHandler() {
      throw new Error('deterministic scan provider does not support tool-call repair');
    },
    thinkingProviderOptions() {
      return {};
    },
    telemetryConfig() {
      return undefined;
    },
    promptCachingConfig() {
      return {
        enabled: false,
        systemTtl: '1h',
        toolsTtl: '1h',
        historyTtl: '5m',
        cacheSystem: true,
        cacheTools: true,
        cacheHistory: true,
        vertexFallbackTo5m: false,
      };
    },
    activeBackend() {
      return 'gateway';
    },
  };
}

export function snapshotToKloEnrichedSchema(
  snapshot: KloSchemaSnapshot,
  embeddingsByColumnId: ReadonlyMap<string, number[]> = new Map(),
): KloEnrichedSchema {
  const tables: KloEnrichedTable[] = snapshot.tables.map((table) => {
    const id = tableId(table);
    const ref = tableRef(table);
    const columns: KloEnrichedColumn[] = table.columns.map((column) => {
      const idForColumn = columnId(table, column);
      return {
        id: idForColumn,
        tableId: id,
        tableRef: ref,
        name: column.name,
        nativeType: column.nativeType,
        normalizedType: column.normalizedType,
        dimensionType: column.dimensionType,
        nullable: column.nullable,
        primaryKey: column.primaryKey,
        parentColumnId: null,
        descriptions: {
          ...(column.comment ? { db: column.comment } : {}),
        },
        embedding: embeddingsByColumnId.get(idForColumn) ?? null,
        sampleValues: null,
        cardinality: null,
      };
    });
    return {
      id,
      ref,
      enabled: true,
      descriptions: {
        ...(table.comment ? { db: table.comment } : {}),
      },
      columns,
    };
  });

  return {
    connectionId: snapshot.connectionId,
    tables,
    relationships: formalRelationshipsFromSnapshot(snapshot, tables),
  };
}

function descriptionTable(table: KloSchemaTable): KloDescriptionColumnTable {
  return {
    catalog: table.catalog,
    db: table.db,
    name: table.name,
    columns: table.columns.map((column) => ({
      name: column.name,
      ...(column.comment ? { sampleValues: [column.comment], rawDescriptions: { db: column.comment } } : {}),
    })),
  };
}

function embeddingBatchSize(maxBatchSize: number): number {
  return Number.isInteger(maxBatchSize) && maxBatchSize > 0 ? maxBatchSize : 100;
}

async function generateDescriptions(input: {
  snapshot: KloSchemaSnapshot;
  connector: KloScanConnector;
  context: KloScanContext;
  providers: KloLocalScanEnrichmentProviders;
  progress?: KloProgressPort;
}): Promise<KloLocalScanEnrichmentResult['descriptionUpdates']> {
  const generator = new KloDescriptionGenerator({
    llmProvider: input.providers.llm,
    settings: {
      columnMaxWords: 16,
      tableMaxWords: 24,
      dataSourceMaxWords: 32,
      concurrencyLimit: 4,
    },
  });

  const updates: KloLocalScanEnrichmentResult['descriptionUpdates'] = [];
  const totalTables = input.snapshot.tables.length;
  if (totalTables === 0) {
    await input.progress?.update(1, 'No tables to describe');
    return updates;
  }
  for (const [index, table] of input.snapshot.tables.entries()) {
    await input.progress?.update(
      (index + 1) / totalTables,
      `Generating descriptions ${index + 1}/${totalTables} tables`,
      {
        transient: true,
      },
    );
    const tableInput = descriptionTable(table);
    const columnResult = await generator.generateColumnDescriptions({
      connectionId: input.snapshot.connectionId,
      connector: input.connector,
      context: input.context,
      dataSourceType: input.snapshot.driver,
      supportsNestedAnalysis: input.connector.capabilities.nestedAnalysis,
      table: tableInput,
    });
    const tableDescription = await generator.generateTableDescription({
      connectionId: input.snapshot.connectionId,
      connector: input.connector,
      context: input.context,
      dataSourceType: input.snapshot.driver,
      table: {
        catalog: table.catalog,
        db: table.db,
        name: table.name,
        rawDescriptions: table.comment ? { db: table.comment } : {},
      },
    });
    updates.push({
      table: tableRef(table),
      tableDescription,
      columnDescriptions: Object.fromEntries(columnResult.columnDescriptions),
    });
  }
  await input.progress?.update(1, `Generated descriptions for ${totalTables} tables`);
  return updates;
}

async function buildEmbeddings(input: {
  snapshot: KloSchemaSnapshot;
  providers: KloLocalScanEnrichmentProviders;
  descriptions: KloLocalScanEnrichmentResult['descriptionUpdates'];
  progress?: KloProgressPort;
}): Promise<{ updates: KloEmbeddingUpdate[]; byColumnId: Map<string, number[]> }> {
  const descriptionByTable = new Map(input.descriptions.map((item) => [item.table.name, item]));
  const texts: Array<{ columnId: string; text: string }> = [];

  for (const table of input.snapshot.tables) {
    const tableDescriptions = descriptionByTable.get(table.name);
    for (const column of table.columns) {
      const id = columnId(table, column);
      const text = buildKloColumnEmbeddingText({
        tableName: table.name,
        columnName: column.name,
        columnType: column.nativeType,
        resolvedDescription: tableDescriptions?.columnDescriptions[column.name] ?? column.comment,
        resolvedTableDescription: tableDescriptions?.tableDescription ?? table.comment,
        sampleValues: column.comment ? [column.comment] : null,
        foreignKeys: {
          outgoing: (table.foreignKeys ?? [])
            .filter((foreignKey) => foreignKey.fromColumn === column.name)
            .map((foreignKey) => ({ toTable: foreignKey.toTable, toColumn: foreignKey.toColumn })),
          incoming: [],
        },
      });
      texts.push({ columnId: id, text });
    }
  }

  const embeddings: number[][] = [];
  const maxBatchSize = embeddingBatchSize(input.providers.embedding.maxBatchSize);
  const embeddingTexts = texts.map((item) => item.text);
  const batchCount = Math.ceil(embeddingTexts.length / maxBatchSize);
  if (batchCount === 0) {
    await input.progress?.update(1, 'No embeddings to build');
  }
  for (let offset = 0; offset < embeddingTexts.length; offset += maxBatchSize) {
    const batchIndex = Math.floor(offset / maxBatchSize) + 1;
    await input.progress?.update(batchIndex / batchCount, `Building embeddings ${batchIndex}/${batchCount} batches`, {
      transient: true,
    });
    const batch = embeddingTexts.slice(offset, offset + maxBatchSize);
    const batchEmbeddings = await input.providers.embedding.embedBatch(batch);
    if (batchEmbeddings.length !== batch.length) {
      throw new Error(`expected ${batch.length} embeddings, received ${batchEmbeddings.length}`);
    }
    embeddings.push(...batchEmbeddings);
  }

  const byColumnId = new Map<string, number[]>();
  const updates = texts.map((item, index) => {
    const embedding = embeddings[index] ?? [];
    byColumnId.set(item.columnId, embedding);
    return {
      columnId: item.columnId,
      text: item.text,
      embedding,
    };
  });
  if (batchCount > 0) {
    await input.progress?.update(1, `Built embeddings for ${updates.length} columns`);
  }
  return { updates, byColumnId };
}

async function runEnrichmentStage<TOutput>(input: {
  stateStore: KloScanEnrichmentStateStore | null | undefined;
  runId: string;
  connectionId: string;
  syncId: string;
  mode: KloScanMode;
  stage: KloScanEnrichmentStage;
  inputHash: string;
  now: () => Date;
  resumedStages: KloScanEnrichmentStage[];
  completedStages: KloScanEnrichmentStage[];
  failedStages: KloScanEnrichmentStage[];
  compute: () => Promise<TOutput>;
}): Promise<TOutput> {
  const existing = await input.stateStore?.findCompletedStage<TOutput>({
    runId: input.runId,
    stage: input.stage,
    inputHash: input.inputHash,
  });
  if (existing) {
    input.resumedStages.push(input.stage);
    input.completedStages.push(input.stage);
    return existing.output;
  }

  try {
    const output = await input.compute();
    input.completedStages.push(input.stage);
    await input.stateStore?.saveCompletedStage({
      runId: input.runId,
      connectionId: input.connectionId,
      syncId: input.syncId,
      mode: input.mode,
      stage: input.stage,
      inputHash: input.inputHash,
      output,
      updatedAt: input.now().toISOString(),
    });
    return output;
  } catch (error) {
    input.failedStages.push(input.stage);
    await input.stateStore?.saveFailedStage({
      runId: input.runId,
      connectionId: input.connectionId,
      syncId: input.syncId,
      mode: input.mode,
      stage: input.stage,
      inputHash: input.inputHash,
      errorMessage: error instanceof Error ? error.message : String(error),
      updatedAt: input.now().toISOString(),
    });
    throw error;
  }
}

function embeddingsByColumnId(updates: KloEmbeddingUpdate[]): Map<string, number[]> {
  return new Map(updates.map((update) => [update.columnId, update.embedding]));
}

export async function runLocalScanEnrichment(
  input: KloLocalScanEnrichmentInput,
): Promise<KloLocalScanEnrichmentResult> {
  const progress = input.context.progress;
  await progress?.update(0, 'Loading enrichment schema snapshot');
  const snapshot = await input.connector.introspect(
    {
      connectionId: input.connectionId,
      driver: input.connector.driver,
      mode: input.mode,
      detectRelationships: input.detectRelationships,
    },
    input.context,
  );
  await progress?.update(0.05, `Loaded schema snapshot with ${snapshot.tables.length} tables`);

  const now = input.now ?? (() => new Date());
  const state = completedKloScanEnrichmentStateSummary();
  const syncId = input.syncId ?? input.context.runId;
  const relationshipSettings =
    input.relationshipSettings ?? buildDefaultKloProjectConfig(input.connectionId).scan.relationships;
  const inputHash = computeKloScanEnrichmentInputHash({
    snapshot,
    mode: input.mode,
    detectRelationships: input.detectRelationships ?? false,
    providerIdentity: input.providerIdentity ?? {},
    relationshipSettings,
  });
  const warnings: KloScanWarning[] = [];
  let descriptions: KloLocalScanEnrichmentResult['descriptionUpdates'] = [];
  let embeddingUpdates: KloEmbeddingUpdate[] = [];
  let schema = snapshotToKloEnrichedSchema(snapshot);
  const summary: KloScanEnrichmentSummary = { ...skippedKloScanEnrichmentSummary };
  const relationshipDetectionEnabled = relationshipSettings.enabled;
  const shouldDetectRelationships =
    relationshipDetectionEnabled &&
    (input.mode === 'relationships' || input.mode === 'enriched' || (input.detectRelationships ?? false));

  if (input.mode === 'enriched' && !input.providers) {
    warnings.push(providerlessEnrichedWarning(shouldDetectRelationships));
  }

  if (input.mode === 'enriched' && input.providers) {
    const providers = input.providers;
    const descriptionProgress = progress?.startPhase(0.45);
    descriptions = await runEnrichmentStage({
      stateStore: input.stateStore,
      runId: input.context.runId,
      connectionId: input.connectionId,
      syncId,
      mode: input.mode,
      stage: 'descriptions',
      inputHash,
      now,
      resumedStages: state.resumedStages,
      completedStages: state.completedStages,
      failedStages: state.failedStages,
      compute: () =>
        generateDescriptions({
          snapshot,
          connector: input.connector,
          context: input.context,
          providers,
          progress: descriptionProgress,
        }),
    });
    const embeddingProgress = progress?.startPhase(0.2);
    embeddingUpdates = await runEnrichmentStage({
      stateStore: input.stateStore,
      runId: input.context.runId,
      connectionId: input.connectionId,
      syncId,
      mode: input.mode,
      stage: 'embeddings',
      inputHash,
      now,
      resumedStages: state.resumedStages,
      completedStages: state.completedStages,
      failedStages: state.failedStages,
      compute: async () => {
        const embeddings = await buildEmbeddings({
          snapshot,
          providers,
          descriptions,
          progress: embeddingProgress,
        });
        return embeddings.updates;
      },
    });
    schema = snapshotToKloEnrichedSchema(snapshot, embeddingsByColumnId(embeddingUpdates));
    summary.dataDictionary = input.connector.sampleColumn ? 'completed' : 'skipped';
    summary.tableDescriptions = 'completed';
    summary.columnDescriptions = 'completed';
    summary.embeddings = 'completed';
  }

  let relationshipUpdate: KloRelationshipUpdate | null = null;
  let relationshipProfile: KloRelationshipProfileArtifact | null = null;
  let resolvedRelationships: KloResolvedRelationshipDiscoveryCandidate[] | null = null;
  let compositeRelationships: KloCompositeRelationshipCandidate[] | null = null;
  let relationships: KloScanRelationshipSummary = { accepted: 0, review: 0, rejected: 0, skipped: 0 };
  if (shouldDetectRelationships) {
    const relationshipProgress = progress?.startPhase(0.25);
    const relationshipStage = await runEnrichmentStage({
      stateStore: input.stateStore,
      runId: input.context.runId,
      connectionId: input.connectionId,
      syncId,
      mode: input.mode,
      stage: 'relationships',
      inputHash,
      now,
      resumedStages: state.resumedStages,
      completedStages: state.completedStages,
      failedStages: state.failedStages,
      compute: async () => {
        await relationshipProgress?.update(0, 'Detecting relationships');
        const detection = await discoverKloRelationships({
          connectionId: input.connectionId,
          driver: snapshot.driver,
          connector: input.connector,
          schema,
          context: input.context,
          settings: relationshipSettings,
          llmProvider: input.providers?.llm ?? null,
        });

        await relationshipProgress?.update(
          1,
          `Relationship detection found ${detection.relationships.accepted} accepted, ${detection.relationships.review} review`,
        );
        return {
          relationshipUpdate: detection.relationshipUpdate,
          relationshipProfile: detection.profile,
          resolvedRelationships: detection.resolvedRelationships,
          compositeRelationships: detection.compositeRelationships,
          relationships: detection.relationships,
          statisticalValidation: detection.statisticalValidation,
          llmRelationshipValidation: detection.llmRelationshipValidation,
          warnings: detection.warnings,
        };
      },
    });

    summary.deterministicRelationships = 'completed';
    summary.llmRelationshipValidation = relationshipStage.llmRelationshipValidation;
    summary.statisticalValidation = relationshipStage.statisticalValidation;
    relationshipUpdate = relationshipStage.relationshipUpdate;
    relationshipProfile = relationshipStage.relationshipProfile;
    resolvedRelationships = relationshipStage.resolvedRelationships;
    compositeRelationships = relationshipStage.compositeRelationships;
    relationships = relationshipStage.relationships;
    warnings.push(...relationshipStage.warnings);
  }

  await progress?.update(1, 'Enrichment complete');
  return {
    snapshot,
    summary,
    relationships,
    state: summarizeKloScanEnrichmentState(state),
    warnings,
    descriptionUpdates: descriptions,
    embeddingUpdates,
    relationshipUpdate,
    relationshipProfile,
    resolvedRelationships,
    compositeRelationships,
  };
}
