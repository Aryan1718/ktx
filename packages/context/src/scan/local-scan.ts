import type { createKloEmbeddingProvider, createKloLlmProvider } from '@klo/llm';
import {
  createDefaultLocalIngestAdapters,
  getLocalStageOnlyIngestStatus,
  type LocalIngestRunRecord,
  runLocalStageOnlyIngest,
  type SourceAdapter,
} from '../ingest/index.js';
import {
  createLocalKloEmbeddingProviderFromConfig,
  createLocalKloLlmProviderFromConfig,
  KloScanEmbeddingPortAdapter,
} from '../llm/index.js';
import type { KloProjectLlmConfig, KloScanEnrichmentConfig, KloScanRelationshipConfig } from '../project/config.js';
import type { KloLocalProject } from '../project/index.js';
import { kloLocalStateDbPath } from '../project/local-state-db.js';
import { redactKloScanReport } from './credentials.js';
import { completedKloScanEnrichmentStateSummary } from './enrichment-state.js';
import { failedKloScanEnrichmentSummary, kloScanErrorMessage } from './enrichment-summary.js';
import {
  createDeterministicLocalScanEnrichmentProviders,
  type KloLocalScanEnrichmentProviders,
  runLocalScanEnrichment,
} from './local-enrichment.js';
import { writeLocalScanEnrichmentArtifacts, writeLocalScanManifestShards } from './local-enrichment-artifacts.js';
import { readLocalScanStructuralSnapshot } from './local-structural-artifacts.js';
import { SqliteLocalScanEnrichmentStateStore } from './sqlite-local-enrichment-state-store.js';
import type {
  KloConnectionDriver,
  KloProgressPort,
  KloScanConnector,
  KloScanEnrichmentStateSummary,
  KloScanMode,
  KloScanReport,
  KloScanTrigger,
} from './types.js';

export interface RunLocalScanOptions {
  project: KloLocalProject;
  connectionId: string;
  mode?: KloScanMode;
  detectRelationships?: boolean;
  dryRun?: boolean;
  trigger?: KloScanTrigger;
  databaseIntrospectionUrl?: string;
  adapters?: SourceAdapter[];
  jobId?: string;
  now?: () => Date;
  connector?: KloScanConnector;
  createConnector?: (connectionId: string) => KloScanConnector | Promise<KloScanConnector>;
  enrichmentProviders?: KloLocalScanEnrichmentProviders | null;
  enrichmentStateStore?: SqliteLocalScanEnrichmentStateStore | null;
  progress?: KloProgressPort;
}

export interface LocalScanRunResult {
  runId: string;
  status: 'done';
  done: true;
  connectionId: string;
  mode: KloScanMode;
  dryRun: boolean;
  syncId: string;
  report: KloScanReport;
}

export interface LocalScanStatusResponse {
  runId: string;
  status: LocalIngestRunRecord['status'];
  done: boolean;
  connectionId: string;
  mode: KloScanMode;
  dryRun: boolean;
  syncId: string;
  progress: number;
  startedAt: string;
  completedAt: string;
  reportPath: string | null;
  warnings: KloScanReport['warnings'];
}

export interface LocalScanMcpOptions {
  adapters?: SourceAdapter[];
  databaseIntrospectionUrl?: string;
  jobIdFactory?: () => string;
  now?: () => Date;
  createConnector?: (connectionId: string) => KloScanConnector | Promise<KloScanConnector>;
}

const LIVE_DATABASE_ADAPTER = 'live-database';
const SCAN_REPORT_FILE = 'scan-report.json';
const LOCAL_AUTHOR = 'klo';
const LOCAL_AUTHOR_EMAIL = 'klo@example.com';

function normalizeDriver(driver: string | undefined): KloConnectionDriver {
  const normalized = (driver ?? '').toLowerCase();
  if (
    normalized === 'postgres' ||
    normalized === 'postgresql' ||
    normalized === 'sqlite' ||
    normalized === 'sqlite3' ||
    normalized === 'mysql' ||
    normalized === 'clickhouse' ||
    normalized === 'sqlserver' ||
    normalized === 'bigquery' ||
    normalized === 'snowflake' ||
    normalized === 'posthog'
  ) {
    return normalized === 'sqlite3' ? 'sqlite' : normalized;
  }
  throw new Error(
    `Standalone klo scan supports postgres/postgresql/sqlite/mysql/clickhouse/sqlserver/bigquery/snowflake/posthog in this phase, received "${driver ?? 'unknown'}"`,
  );
}

function tablePathCount(paths: string[]): number {
  return paths.filter((path) => path.startsWith('tables/') && path.endsWith('.json')).length;
}

function rawSourcesDir(connectionId: string, syncId: string): string {
  return `raw-sources/${connectionId}/${LIVE_DATABASE_ADAPTER}/${syncId}`;
}

function scanReportPath(connectionId: string, syncId: string): string {
  return `${rawSourcesDir(connectionId, syncId)}/${SCAN_REPORT_FILE}`;
}

function assertSupportedMode(mode: KloScanMode): void {
  if (mode !== 'structural' && mode !== 'relationships' && mode !== 'enriched') {
    throw new Error(`Unsupported KLO scan mode: ${mode}`);
  }
}

async function resolveScanConnector(options: RunLocalScanOptions, mode: KloScanMode): Promise<KloScanConnector | null> {
  if (mode === 'structural' && !options.detectRelationships) {
    return null;
  }
  if (options.connector) {
    return options.connector;
  }
  if (options.createConnector) {
    return options.createConnector(options.connectionId);
  }
  throw new Error('klo scan --enrich and --detect-relationships require a native standalone scan connector');
}

interface LocalScanEnrichmentProviderDeps {
  createKloLlmProvider?: typeof createKloLlmProvider;
  createKloEmbeddingProvider?: typeof createKloEmbeddingProvider;
  env?: NodeJS.ProcessEnv;
}

export function createLocalScanEnrichmentProvidersFromConfig(
  config: KloScanEnrichmentConfig,
  llmConfig: KloProjectLlmConfig,
  deps: LocalScanEnrichmentProviderDeps = {},
): KloLocalScanEnrichmentProviders | null {
  if (config.mode === 'deterministic') {
    return createDeterministicLocalScanEnrichmentProviders();
  }

  if (config.mode !== 'llm' || !config.embeddings) {
    return null;
  }

  const llm = createLocalKloLlmProviderFromConfig(llmConfig, deps);
  const embeddingProvider = createLocalKloEmbeddingProviderFromConfig(config.embeddings, deps);
  if (!llm || !embeddingProvider) {
    return null;
  }

  return {
    llm,
    embedding: new KloScanEmbeddingPortAdapter(embeddingProvider),
  };
}

function createLocalScanEnrichmentStateStore(options: RunLocalScanOptions): SqliteLocalScanEnrichmentStateStore | null {
  if (options.dryRun) {
    return null;
  }
  if (options.enrichmentStateStore !== undefined) {
    return options.enrichmentStateStore;
  }
  return new SqliteLocalScanEnrichmentStateStore({ dbPath: kloLocalStateDbPath(options.project) });
}

function localScanProviderIdentity(
  config: KloScanEnrichmentConfig,
  llmConfig: KloProjectLlmConfig,
  relationships: KloScanRelationshipConfig,
): Record<string, unknown> {
  return {
    mode: config.mode,
    embeddingDimensions: config.embeddings?.dimensions ?? null,
    llmModel: llmConfig.models.default ?? null,
    embeddingModel: config.embeddings?.model ?? null,
    batchSize: config.embeddings?.batchSize ?? null,
    baseUrlConfigured: Boolean(llmConfig.provider.gateway?.base_url),
    relationships,
  };
}

function reportFromIngest(input: {
  record: LocalIngestRunRecord;
  driver: KloConnectionDriver;
  mode: KloScanMode;
  dryRun: boolean;
  trigger: KloScanTrigger;
  createdAt: string;
}): KloScanReport {
  const reportPath = input.dryRun ? null : scanReportPath(input.record.connectionId, input.record.syncId);
  return {
    connectionId: input.record.connectionId,
    driver: input.driver,
    syncId: input.record.syncId,
    runId: input.record.runId,
    trigger: input.trigger,
    mode: input.mode,
    dryRun: input.dryRun,
    artifactPaths: {
      rawSourcesDir: input.dryRun ? null : rawSourcesDir(input.record.connectionId, input.record.syncId),
      reportPath,
      manifestShards: [],
      enrichmentArtifacts: [],
    },
    diffSummary: {
      tablesAdded: tablePathCount(input.record.diffPaths.added),
      tablesModified: tablePathCount(input.record.diffPaths.modified),
      tablesDeleted: tablePathCount(input.record.diffPaths.deleted),
      tablesUnchanged: tablePathCount(input.record.diffPaths.unchanged),
      columnsAdded: 0,
      columnsModified: 0,
      columnsDeleted: 0,
    },
    manifestShardsWritten: 0,
    structuralSyncStats: {
      tablesCreated: 0,
      tablesUpdated: 0,
      tablesDeleted: 0,
      columnsCreated: 0,
      columnsUpdated: 0,
      columnsDeleted: 0,
    },
    enrichment: {
      dataDictionary: 'skipped',
      tableDescriptions: 'skipped',
      columnDescriptions: 'skipped',
      embeddings: 'skipped',
      deterministicRelationships: 'skipped',
      llmRelationshipValidation: 'skipped',
      statisticalValidation: 'skipped',
    },
    capabilityGaps: [],
    warnings: [],
    relationships: { accepted: 0, review: 0, rejected: 0, skipped: 0 },
    enrichmentState: completedKloScanEnrichmentStateSummary(),
    createdAt: input.createdAt,
  };
}

async function writeScanReport(project: KloLocalProject, report: KloScanReport): Promise<void> {
  if (!report.artifactPaths.reportPath) {
    return;
  }
  await project.fileStore.writeFile(
    report.artifactPaths.reportPath,
    `${JSON.stringify(report, null, 2)}\n`,
    LOCAL_AUTHOR,
    LOCAL_AUTHOR_EMAIL,
    `scan(${LIVE_DATABASE_ADAPTER}): ${report.runId} syncId=${report.syncId}`,
  );
}

function scanDiffSummaryFromRecord(record: LocalIngestRunRecord): KloScanReport['diffSummary'] {
  return {
    tablesAdded: tablePathCount(record.diffPaths.added),
    tablesModified: tablePathCount(record.diffPaths.modified),
    tablesDeleted: tablePathCount(record.diffPaths.deleted),
    tablesUnchanged: tablePathCount(record.diffPaths.unchanged),
    columnsAdded: 0,
    columnsModified: 0,
    columnsDeleted: 0,
  };
}

function hasNoContentChanges(record: LocalIngestRunRecord): boolean {
  return (
    record.previousRunId !== null &&
    record.diffSummary.added === 0 &&
    record.diffSummary.modified === 0 &&
    record.diffSummary.deleted === 0
  );
}

function scanChangeSummary(diffSummary: KloScanReport['diffSummary']): string {
  const changedTables = diffSummary.tablesAdded + diffSummary.tablesModified + diffSummary.tablesDeleted;
  const totalTables = changedTables + diffSummary.tablesUnchanged;
  const changeNoun = changedTables === 1 ? 'change' : 'changes';
  const tableNoun = totalTables === 1 ? 'table' : 'tables';
  return `Semantic layer comparison found ${changedTables} ${changeNoun} across ${totalTables} ${tableNoun}`;
}

async function readScanReport(
  project: KloLocalProject,
  connectionId: string,
  syncId: string,
): Promise<KloScanReport | null> {
  try {
    const raw = await project.fileStore.readFile(scanReportPath(connectionId, syncId));
    return JSON.parse(raw.content) as KloScanReport;
  } catch {
    return null;
  }
}

export async function runLocalScan(options: RunLocalScanOptions): Promise<LocalScanRunResult> {
  const mode = options.mode ?? 'structural';
  assertSupportedMode(mode);
  await options.progress?.update(0.05, 'Preparing scan');
  const connector = await resolveScanConnector(options, mode);

  const connection = options.project.config.connections[options.connectionId];
  if (!connection) {
    throw new Error(`Connection "${options.connectionId}" is not configured in klo.yaml`);
  }
  const driver = normalizeDriver(connection.driver);
  const adapters =
    options.adapters ??
    createDefaultLocalIngestAdapters(options.project, { databaseIntrospectionUrl: options.databaseIntrospectionUrl });
  const enrichmentProviders =
    connector && (mode !== 'structural' || options.detectRelationships)
      ? options.enrichmentProviders !== undefined
        ? options.enrichmentProviders
        : createLocalScanEnrichmentProvidersFromConfig(options.project.config.scan.enrichment, options.project.config.llm)
      : null;

  await options.progress?.update(0.15, 'Inspecting database schema');
  const record = await runLocalStageOnlyIngest({
    project: options.project,
    adapters,
    adapter: LIVE_DATABASE_ADAPTER,
    connectionId: options.connectionId,
    trigger: 'manual_resync',
    jobId: options.jobId,
    now: options.now,
    dryRun: options.dryRun,
  });
  await options.progress?.update(0.55, scanChangeSummary(scanDiffSummaryFromRecord(record)));
  let report = reportFromIngest({
    record,
    driver,
    mode,
    dryRun: options.dryRun ?? false,
    trigger: options.trigger ?? 'cli',
    createdAt: (options.now?.() ?? new Date()).toISOString(),
  });
  let reusedExistingScanArtifacts = false;
  const existingReport =
    !report.dryRun && !connector && hasNoContentChanges(record)
      ? await readScanReport(options.project, record.connectionId, record.syncId)
      : null;
  if (existingReport && existingReport.mode === mode && existingReport.dryRun === report.dryRun) {
    report.artifactPaths = existingReport.artifactPaths;
    report.capabilityGaps = existingReport.capabilityGaps;
    report.warnings = existingReport.warnings;
    report.relationships = existingReport.relationships;
    report.enrichment = existingReport.enrichment;
    report.enrichmentState = existingReport.enrichmentState;
    reusedExistingScanArtifacts = true;
  }
  const enrichmentStateStore = connector ? createLocalScanEnrichmentStateStore(options) : null;
  let enrichmentState: KloScanEnrichmentStateSummary = completedKloScanEnrichmentStateSummary();
  if (!reusedExistingScanArtifacts && !report.dryRun && report.artifactPaths.rawSourcesDir) {
    await options.progress?.update(0.7, 'Writing schema artifacts');
    const structuralSnapshot = await readLocalScanStructuralSnapshot({
      project: options.project,
      connectionId: options.connectionId,
      driver,
      rawSourcesDir: report.artifactPaths.rawSourcesDir,
      extractedAtFallback: report.createdAt,
    });
    const manifestArtifacts = await writeLocalScanManifestShards({
      project: options.project,
      connectionId: options.connectionId,
      syncId: record.syncId,
      driver,
      snapshot: structuralSnapshot,
      dryRun: false,
    });
    report.artifactPaths.manifestShards = manifestArtifacts.manifestShards;
    report.manifestShardsWritten = manifestArtifacts.manifestShardsWritten;
  }
  if (connector) {
    try {
      await options.progress?.update(
        0.82,
        mode === 'relationships' || options.detectRelationships
          ? 'Detecting relationships'
          : 'Enriching schema metadata',
      );
      const enrichment = await runLocalScanEnrichment({
        connectionId: options.connectionId,
        mode,
        detectRelationships: options.detectRelationships,
        connector,
        context: { runId: record.runId, progress: options.progress?.startPhase(0.18) },
        providers: enrichmentProviders,
        stateStore: enrichmentStateStore,
        syncId: record.syncId,
        providerIdentity: localScanProviderIdentity(
          options.project.config.scan.enrichment,
          options.project.config.llm,
          options.project.config.scan.relationships,
        ),
        relationshipSettings: options.project.config.scan.relationships,
        now: options.now,
      });
      const artifacts = await writeLocalScanEnrichmentArtifacts({
        project: options.project,
        connectionId: options.connectionId,
        syncId: record.syncId,
        driver,
        enrichment,
        dryRun: options.dryRun ?? false,
        relationshipSettings: options.project.config.scan.relationships,
      });
      report.enrichment = enrichment.summary;
      report.relationships = enrichment.relationships;
      enrichmentState = enrichment.state;
      report.enrichmentState = enrichmentState;
      report.warnings.push(...enrichment.warnings);
      report.artifactPaths.enrichmentArtifacts = artifacts.enrichmentArtifacts;
      report.artifactPaths.manifestShards = artifacts.manifestShards;
      report.manifestShardsWritten = artifacts.manifestShardsWritten;
    } catch (error) {
      const message = kloScanErrorMessage(error);
      report.enrichment = failedKloScanEnrichmentSummary(mode, options.detectRelationships ?? false);
      const stages = await enrichmentStateStore?.listRunStages(record.runId);
      if (stages) {
        enrichmentState = completedKloScanEnrichmentStateSummary();
        for (const stage of stages) {
          if (stage.status === 'completed') {
            enrichmentState.completedStages.push(stage.stage);
          } else {
            enrichmentState.failedStages.push(stage.stage);
          }
        }
        report.enrichmentState = enrichmentState;
      }
      report.warnings.push({
        code: 'enrichment_failed',
        message: `KLO scan enrichment failed after structural scan completed: ${message}`,
        recoverable: true,
        metadata: { mode, detectRelationships: options.detectRelationships ?? false },
      });
    }
  }
  report = redactKloScanReport(report);
  if (!reusedExistingScanArtifacts) {
    await writeScanReport(options.project, report);
  }
  await options.progress?.update(1, 'Scan completed');
  return {
    runId: record.runId,
    status: 'done',
    done: true,
    connectionId: record.connectionId,
    mode,
    dryRun: options.dryRun ?? false,
    syncId: record.syncId,
    report,
  };
}

export async function getLocalScanReport(project: KloLocalProject, runId: string): Promise<KloScanReport | null> {
  const status = await getLocalStageOnlyIngestStatus(project, runId);
  if (!status || status.adapter !== LIVE_DATABASE_ADAPTER) {
    return null;
  }
  const report = await readScanReport(project, status.connectionId, status.syncId);
  if (!report) {
    return null;
  }
  return {
    ...report,
    runId: status.runId,
    syncId: status.syncId,
    diffSummary: scanDiffSummaryFromRecord(status),
  };
}

export async function getLocalScanStatus(
  project: KloLocalProject,
  runId: string,
): Promise<LocalScanStatusResponse | null> {
  const status = await getLocalStageOnlyIngestStatus(project, runId);
  if (!status || status.adapter !== LIVE_DATABASE_ADAPTER) {
    return null;
  }
  const report = await getLocalScanReport(project, runId);
  return {
    runId: status.runId,
    status: status.status,
    done: status.done,
    connectionId: status.connectionId,
    mode: report?.mode ?? 'structural',
    dryRun: report?.dryRun ?? false,
    syncId: status.syncId,
    progress: status.progress,
    startedAt: status.startedAt,
    completedAt: status.completedAt,
    reportPath: report?.artifactPaths.reportPath ?? null,
    warnings: report?.warnings ?? [],
  };
}
