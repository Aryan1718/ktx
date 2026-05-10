import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ChunkResult,
  DiffSet,
  FetchContext,
  IngestTrigger,
  ScopeDescriptor,
  SourceAdapter,
  TriageSignals,
} from '../../types.js';
import { chunkHistoricSqlStagedDir, describeHistoricSqlScope } from './chunk.js';
import { detectHistoricSqlStagedDir } from './detect.js';
import { stageHistoricSqlTemplates } from './stage.js';
import {
  pgssBaselinePath,
  stagePgStatStatementsTemplates,
  writePgssBaselineAtomic,
  type StagePgStatStatementsTemplatesResult,
} from './stage-pgss.js';
import {
  historicSqlManifestSchema,
  historicSqlMetadataSchema,
  historicSqlPullConfigSchema,
  historicSqlUsageSchema,
  type HistoricSqlSourceAdapterDeps,
} from './types.js';

export class HistoricSqlSourceAdapter implements SourceAdapter {
  readonly source = 'historic-sql';
  readonly skillNames = ['historic_sql_ingest'];
  readonly reconcileSkillNames = ['historic_sql_curator'];
  readonly evidenceIndexing = 'documents' as const;
  readonly triageSupported = true;

  private readonly pendingPgssBaselines = new Map<string, StagePgStatStatementsTemplatesResult>();

  constructor(private readonly deps: HistoricSqlSourceAdapterDeps) {}

  detect(stagedDir: string): Promise<boolean> {
    return detectHistoricSqlStagedDir(stagedDir);
  }

  async fetch(pullConfig: unknown, stagedDir: string, ctx: FetchContext): Promise<void> {
    const config = historicSqlPullConfigSchema.parse(pullConfig);
    if (config.dialect === 'postgres') {
      if (!this.deps.postgresReader) {
        throw new Error('Historic SQL Postgres fetch requires deps.postgresReader');
      }
      const postgresQueryClient = this.deps.postgresQueryClient ?? this.deps.queryClient;
      if (
        !postgresQueryClient ||
        typeof postgresQueryClient !== 'object' ||
        !('executeQuery' in postgresQueryClient) ||
        typeof (postgresQueryClient as { executeQuery?: unknown }).executeQuery !== 'function'
      ) {
        throw new Error('Historic SQL Postgres fetch requires deps.postgresQueryClient with executeQuery(sql, params?)');
      }
      const result = await stagePgStatStatementsTemplates({
        stagedDir,
        connectionId: ctx.connectionId,
        queryClient: postgresQueryClient as NonNullable<HistoricSqlSourceAdapterDeps['postgresQueryClient']>,
        reader: this.deps.postgresReader,
        sqlAnalysis: this.deps.sqlAnalysis,
        pullConfig: config,
        baselinePath: pgssBaselinePath(this.deps.postgresBaselineRootDir, ctx.connectionId),
        now: this.deps.now?.(),
      });
      this.pendingPgssBaselines.set(stagedDir, result);
      return;
    }

    await stageHistoricSqlTemplates({
      stagedDir,
      connectionId: ctx.connectionId,
      queryClient: this.deps.queryClient,
      reader: this.deps.reader,
      sqlAnalysis: this.deps.sqlAnalysis,
      pullConfig: config,
      now: this.deps.now?.(),
    });
  }

  chunk(stagedDir: string, diffSet?: DiffSet): Promise<ChunkResult> {
    return chunkHistoricSqlStagedDir(stagedDir, diffSet);
  }

  describeScope(stagedDir: string): Promise<ScopeDescriptor> {
    return describeHistoricSqlScope(stagedDir);
  }

  async getTriageSignals(stagedDir: string, externalId: string): Promise<TriageSignals> {
    const manifest = historicSqlManifestSchema.parse(
      JSON.parse(await readFile(join(stagedDir, 'manifest.json'), 'utf-8')),
    );
    const template = manifest.templates.find((entry) => entry.id === externalId);
    if (!template) {
      return {};
    }
    const templateDir = template.path.replace(/\/page\.md$/, '');
    const metadata = historicSqlMetadataSchema.parse(
      JSON.parse(await readFile(join(stagedDir, templateDir, 'metadata.json'), 'utf-8')),
    );
    const usage = historicSqlUsageSchema.parse(
      JSON.parse(await readFile(join(stagedDir, templateDir, 'usage.json'), 'utf-8')),
    );

    return {
      objectType: metadata.objectType,
      lastEditedAt: usage.stats.last_seen,
      propertyHints: metadata.properties.triage_signals,
    };
  }

  async onPullSucceeded(ctx: {
    connectionId: string;
    sourceKey: string;
    syncId: string;
    trigger: IngestTrigger;
    completedAt: Date;
    stagedDir: string;
  }): Promise<void> {
    const manifest = historicSqlManifestSchema.parse(
      JSON.parse(await readFile(join(ctx.stagedDir, 'manifest.json'), 'utf-8')),
    );
    if (manifest.dialect === 'postgres') {
      const pending = this.pendingPgssBaselines.get(ctx.stagedDir);
      if (pending) {
        await writePgssBaselineAtomic(pending.baselinePath, pending.baseline);
        this.pendingPgssBaselines.delete(ctx.stagedDir);
      }
    }
    await this.deps.onPullSucceeded?.({ ...ctx, nextSuccessfulCursor: manifest.nextSuccessfulCursor });
  }
}
