import type { MemoryAction } from '../memory/index.js';
import type { TouchedSlSource } from '../tools/index.js';
import type { MemoryFlowReplayInput } from './memory-flow/types.js';
import type { IngestProvenanceInsert } from './ports.js';
import type {
  ArtifactResolutionRecord,
  ConflictResolvedRecord,
  EvictionAppliedRecord,
  StageIndex,
  UnmappedFallbackRecord,
} from './stages/stage-index.types.js';
import type { IngestDiffSummary, SourceFetchReport, UnresolvedCardInfo } from './types.js';

export interface IngestReportWorkUnit {
  unitKey: string;
  rawFiles: string[];
  status: 'success' | 'failed';
  reason?: string;
  actions: MemoryAction[];
  touchedSlSources: TouchedSlSource[];
  slDisallowed?: boolean;
  slDisallowedReason?: 'lookml_connection_mismatch';
}

export interface IngestReportProvenanceDetail {
  rawPath: string;
  artifactKind: 'sl' | 'wiki' | null;
  artifactKey: string | null;
  targetConnectionId?: string | null;
  actionType: IngestProvenanceInsert['actionType'];
}

export interface IngestReportToolTranscriptSummary {
  unitKey: string;
  path: string;
  toolCallCount: number;
  errorCount: number;
  toolNames: string[];
}

export interface IngestReportPostProcessorOutcome {
  sourceKey: string;
  status: 'success' | 'failed';
  result?: unknown;
  errors: string[];
  warnings: string[];
  touchedSources: TouchedSlSource[];
}

export interface IngestReportBody {
  syncId: string;
  diffSummary: IngestDiffSummary;
  fetch?: SourceFetchReport;
  commitSha: string | null;
  workUnits: IngestReportWorkUnit[];
  failedWorkUnits: string[];
  reconciliationSkipped: boolean;
  conflictsResolved: ConflictResolvedRecord[];
  evictionsApplied: EvictionAppliedRecord[];
  unmappedFallbacks: UnmappedFallbackRecord[];
  artifactResolutions?: ArtifactResolutionRecord[];
  evictionInputs: string[];
  unresolvedCards: UnresolvedCardInfo[];
  supersededBy: string | null;
  overrideOf: string | null;
  provenanceRows: IngestReportProvenanceDetail[];
  toolTranscripts: IngestReportToolTranscriptSummary[];
  postProcessor?: IngestReportPostProcessorOutcome;
  memoryFlow?: MemoryFlowReplayInput;
}

export interface IngestReportSnapshot {
  id: string;
  runId: string;
  jobId: string;
  connectionId: string;
  sourceKey: string;
  body: IngestReportBody;
  createdAt: string;
}

export function buildStageIndexFromReportBody(jobId: string, connectionId: string, body: IngestReportBody): StageIndex {
  return {
    jobId,
    connectionId,
    workUnits: body.workUnits.map((wu) => ({
      unitKey: wu.unitKey,
      rawFiles: wu.rawFiles,
      status: wu.status,
      reason: wu.reason,
      actions: wu.actions,
      touchedSlSources: wu.touchedSlSources,
      slDisallowed: wu.slDisallowed,
      slDisallowedReason: wu.slDisallowedReason,
    })),
    conflictsResolved: [],
    evictionsApplied: [],
    unmappedFallbacks: [],
    artifactResolutions: body.artifactResolutions ?? [],
  };
}
