import type { IngestReportSnapshot, MemoryFlowReplayInput } from '../ingest/index.js';
import type { MemoryCaptureService } from '../memory/index.js';
import type { KloScanMode, KloScanReport } from '../scan/index.js';
import type {
  SemanticLayerQueryInput,
  SlDictionaryMatch,
  SlSearchLaneSummary,
  SlSearchMatchReason,
} from '../sl/index.js';
import type { WikiSearchLaneSummary, WikiSearchMatchReason } from '../wiki/index.js';

export interface KloMcpTextContent {
  type: 'text';
  text: string;
}

export interface KloMcpToolResult<T extends object = object> {
  content: KloMcpTextContent[];
  structuredContent?: T;
  isError?: true;
}

export interface MemoryCapturePort {
  capture: MemoryCaptureService['capture'];
  status: MemoryCaptureService['status'];
}

export interface KloMcpUserContext {
  userId: string;
}

export interface KloMcpServerLike {
  registerTool(
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema: unknown;
    },
    handler: (input: Record<string, unknown>) => Promise<unknown>,
  ): void;
}

export interface KloConnectionSummary {
  id: string;
  name: string;
  connectionType: string;
}

export interface KloConnectionTestResponse {
  id: string;
  connectionType: string;
  ok: boolean;
  tableCount: number | null;
  message: string;
  warnings: string[];
}

export interface KloConnectionsMcpPort {
  list(): Promise<KloConnectionSummary[]>;
  test?(input: { connectionId: string }): Promise<KloConnectionTestResponse | null>;
}

export interface KloKnowledgeSearchResult {
  key: string;
  path: string;
  scope: 'GLOBAL' | 'USER';
  summary: string;
  score: number;
  matchReasons?: WikiSearchMatchReason[];
  lanes?: WikiSearchLaneSummary[];
}

export interface KloKnowledgeSearchResponse {
  results: KloKnowledgeSearchResult[];
  totalFound: number;
}

export interface KloKnowledgePage {
  key: string;
  summary: string;
  content: string;
  scope: 'GLOBAL' | 'USER';
  tags?: string[];
  refs?: string[];
  slRefs?: string[];
}

interface KloHistoricSqlKnowledgeUsage {
  executions: number;
  distinct_users: number;
  first_seen: string;
  last_seen: string;
  p50_runtime_ms: number | null;
  p95_runtime_ms: number | null;
  error_rate: number;
  rows_produced?: number;
}

export interface KloKnowledgeWriteResponse {
  success: boolean;
  key: string;
  action: 'created' | 'updated';
}

export interface KloKnowledgeMcpPort {
  search(input: { userId: string; query: string; limit: number }): Promise<KloKnowledgeSearchResponse>;
  read(input: { userId: string; key: string }): Promise<KloKnowledgePage | null>;
  write(input: {
    userId: string;
    key: string;
    summary: string;
    content: string;
    tags?: string[];
    refs?: string[];
    slRefs?: string[];
    source?: string;
    intent?: string;
    tables?: string[];
    representativeSql?: string;
    usage?: KloHistoricSqlKnowledgeUsage;
    fingerprints?: string[];
  }): Promise<KloKnowledgeWriteResponse>;
}

export interface KloSemanticLayerSourceSummary {
  connectionId: string;
  connectionName: string;
  name: string;
  description?: string;
  columnCount: number;
  measureCount: number;
  joinCount: number;
  score?: number;
  matchReasons?: SlSearchMatchReason[];
  dictionaryMatches?: SlDictionaryMatch[];
  lanes?: SlSearchLaneSummary[];
}

export interface KloSemanticLayerListResponse {
  sources: KloSemanticLayerSourceSummary[];
  totalSources: number;
}

export interface KloSemanticLayerReadResponse {
  sourceName: string;
  yaml: string;
}

export interface KloSemanticLayerWriteResponse {
  success: boolean;
  sourceName: string;
  yaml?: string;
  errors?: string[];
  warnings?: string[];
  commitHash?: string;
}

export interface KloSemanticLayerValidationResponse {
  success: boolean;
  errors: string[];
  warnings: string[];
}

export interface KloSemanticLayerQueryResponse {
  sql: string;
  headers: string[];
  rows: unknown[][];
  totalRows: number;
  plan?: Record<string, unknown>;
}

export interface KloSemanticLayerMcpPort {
  listSources(input: { connectionId?: string; query?: string }): Promise<KloSemanticLayerListResponse>;
  readSource(input: { connectionId: string; sourceName: string }): Promise<KloSemanticLayerReadResponse | null>;
  writeSource(input: {
    connectionId: string;
    sourceName: string;
    yaml?: string;
    source?: Record<string, unknown>;
    delete?: boolean;
  }): Promise<KloSemanticLayerWriteResponse>;
  validate(input: { connectionId: string; names?: string[] }): Promise<KloSemanticLayerValidationResponse>;
  query(input: { connectionId?: string; query: SemanticLayerQueryInput }): Promise<KloSemanticLayerQueryResponse>;
}

export type KloIngestTriggerKind = 'upload' | 'scheduled_pull' | 'manual_resync';

interface KloIngestTriggerFanoutChild {
  runId: string;
  jobId: string;
  reportId: string;
  targetConnectionId: string;
  metabaseDatabaseId: number;
}

export interface KloIngestTriggerResponse {
  runId: string;
  jobId?: string;
  reportId?: string;
  fanout?: {
    status: 'all_succeeded' | 'partial_failure' | 'all_failed';
    children: KloIngestTriggerFanoutChild[];
  };
}

export interface KloIngestDiffSummary {
  added: number;
  modified: number;
  deleted: number;
  unchanged: number;
}

export interface KloIngestWorkUnitSummary {
  unitKey: string;
  rawFiles: string[];
  peerFileIndex: string[];
  dependencyPaths: string[];
}

export interface KloIngestStatusResponse {
  runId: string;
  jobId?: string;
  reportId?: string;
  status: string;
  stage?: string;
  progress?: number;
  errors?: string[];
  done: boolean;
  adapter?: string;
  connectionId?: string;
  sourceDir?: string | null;
  syncId?: string;
  startedAt?: string;
  completedAt?: string;
  previousRunId?: string | null;
  diffSummary?: KloIngestDiffSummary;
  workUnitCount?: number;
  rawFileCount?: number;
  workUnits?: KloIngestWorkUnitSummary[];
  evictionDeletedRawPaths?: string[];
}

export interface KloIngestMcpPort {
  trigger(input: {
    adapter: string;
    connectionId: string;
    config?: unknown;
    trigger: KloIngestTriggerKind;
  }): Promise<KloIngestTriggerResponse>;
  status(input: { runId: string }): Promise<KloIngestStatusResponse | null>;
  report?(input: { runId: string }): Promise<IngestReportSnapshot | null>;
  replay?(input: { runId: string }): Promise<MemoryFlowReplayInput | null>;
}

interface KloScanTriggerResponse {
  runId: string;
  status: 'done';
  done: true;
  connectionId: string;
  mode: KloScanMode;
  dryRun: boolean;
  syncId: string;
  report: KloScanReport;
}

interface KloScanStatusResponse {
  runId: string;
  status: string;
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

export type KloScanArtifactType = 'report' | 'raw_source' | 'manifest_shard' | 'enrichment_artifact';

export interface KloScanArtifactSummary {
  path: string;
  type: KloScanArtifactType;
  size?: number;
}

export interface KloScanArtifactListResponse {
  runId: string;
  artifacts: KloScanArtifactSummary[];
}

export interface KloScanArtifactReadResponse extends KloScanArtifactSummary {
  runId: string;
  content: string;
}

export interface KloScanMcpPort {
  trigger(input: {
    connectionId: string;
    mode?: KloScanMode;
    detectRelationships: boolean;
    dryRun: boolean;
  }): Promise<KloScanTriggerResponse>;
  status(input: { runId: string }): Promise<KloScanStatusResponse | null>;
  report(input: { runId: string }): Promise<KloScanReport | null>;
  listArtifacts?(input: { runId: string }): Promise<KloScanArtifactListResponse | null>;
  readArtifact?(input: { runId: string; path: string }): Promise<KloScanArtifactReadResponse | null>;
}

export interface KloMcpContextPorts {
  connections?: KloConnectionsMcpPort;
  knowledge?: KloKnowledgeMcpPort;
  semanticLayer?: KloSemanticLayerMcpPort;
  ingest?: KloIngestMcpPort;
  scan?: KloScanMcpPort;
}

export interface KloMcpServerDeps {
  server: KloMcpServerLike;
  memoryCapture?: MemoryCapturePort;
  userContext: KloMcpUserContext;
  contextTools?: KloMcpContextPorts;
}
