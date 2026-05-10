import { join } from 'node:path';
import type { ChunkResult, DiffSet, FetchContext, SourceAdapter } from '../../types.js';
import { chunkMetricFlowProject } from './chunk.js';
import { detectMetricFlowStagedDir } from './detect.js';
import { parseMetricflowFiles, type MetricFlowParseResult } from './deep-parse.js';
import { fetchMetricflowRepo } from './fetch.js';
import { parseMetricFlowStagedDir, type ParsedMetricFlowProject } from './parse.js';
import { parseMetricflowPullConfig } from './pull-config.js';

export interface MetricflowSourceAdapterDeps {
  homeDir: string;
}

export class MetricflowSourceAdapter implements SourceAdapter {
  readonly source = 'metricflow';
  readonly skillNames: string[] = ['metricflow_ingest'];

  constructor(private readonly deps: MetricflowSourceAdapterDeps) {}

  detect(stagedDir: string): Promise<boolean> {
    return detectMetricFlowStagedDir(stagedDir);
  }

  async fetch(pullConfig: unknown, stagedDir: string, ctx: FetchContext): Promise<void> {
    const config = parseMetricflowPullConfig(pullConfig);
    await fetchMetricflowRepo({
      config,
      cacheDir: this.resolveCacheDir(ctx.connectionId),
      stagedDir,
    });
  }

  async chunk(stagedDir: string, diffSet?: DiffSet): Promise<ChunkResult> {
    const project = await parseMetricFlowStagedDir(stagedDir);
    const chunk = await chunkMetricFlowProject(project, { diffSet });
    const parseArtifacts = parseMetricflowStagedDirForImport(project);
    return { ...chunk, parseArtifacts };
  }

  private resolveCacheDir(connectionId: string): string {
    return join(this.deps.homeDir, 'ingest-metricflow-repos', connectionId);
  }
}

function parseMetricflowStagedDirForImport(project: ParsedMetricFlowProject): MetricFlowParseResult {
  return parseMetricflowFiles(project.files);
}
