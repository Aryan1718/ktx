import { redactKloScanReport } from './credentials.js';
import { completedKloScanEnrichmentStateSummary, summarizeKloScanEnrichmentState } from './enrichment-state.js';
import {
  failedKloScanEnrichmentSummary,
  kloScanErrorMessage,
  skippedKloScanEnrichmentSummary,
} from './enrichment-summary.js';
import type {
  KloConnectorCapabilities,
  KloScanArtifactPaths,
  KloScanConnector,
  KloScanContext,
  KloScanDiffSummary,
  KloScanEnrichmentSummary,
  KloScanEnrichmentStateSummary,
  KloScanInput,
  KloScanRelationshipSummary,
  KloScanReport,
  KloScanTrigger,
  KloScanWarning,
  KloSchemaSnapshot,
  KloStructuralSyncStats,
} from './types.js';

type CapabilityGap = keyof Omit<KloConnectorCapabilities, 'structuralIntrospection'>;

export interface KloStructuralScanPhaseResult<TResult = unknown> {
  result: TResult;
  diffSummary?: Partial<KloScanDiffSummary>;
  structuralSyncStats?: Partial<KloStructuralSyncStats>;
  manifestShardsWritten?: number;
  artifactPaths?: Partial<KloScanArtifactPaths>;
  relationships?: Partial<KloScanRelationshipSummary>;
  warnings?: KloScanWarning[];
}

export interface KloEnrichmentScanPhaseResult<TResult = unknown> {
  result: TResult;
  enrichment?: Partial<KloScanEnrichmentSummary>;
  enrichmentState?: Partial<KloScanEnrichmentStateSummary>;
  manifestShardsWritten?: number;
  artifactPaths?: Partial<KloScanArtifactPaths>;
  relationships?: Partial<KloScanRelationshipSummary>;
  warnings?: KloScanWarning[];
}

export interface KloScanOrchestratorRunInput<TStructuralResult = unknown, TEnrichmentResult = unknown> {
  connector: KloScanConnector;
  input: KloScanInput;
  trigger: KloScanTrigger;
  context: KloScanContext;
  syncId?: string;
  runStructural: (
    snapshot: KloSchemaSnapshot,
    context: KloScanContext,
  ) => Promise<KloStructuralScanPhaseResult<TStructuralResult>>;
  runEnrichment?: (
    snapshot: KloSchemaSnapshot,
    structural: KloStructuralScanPhaseResult<TStructuralResult>,
    context: KloScanContext,
  ) => Promise<KloEnrichmentScanPhaseResult<TEnrichmentResult>>;
}

export interface KloScanOrchestratorRunResult<TStructuralResult = unknown, TEnrichmentResult = unknown> {
  snapshot: KloSchemaSnapshot;
  structural: KloStructuralScanPhaseResult<TStructuralResult>;
  enrichment: KloEnrichmentScanPhaseResult<TEnrichmentResult> | null;
  report: KloScanReport;
}

export interface KloScanOrchestratorOptions {
  now?: () => Date;
  syncIdFactory?: (input: KloScanInput, context: KloScanContext) => string;
}

const emptyDiffSummary: KloScanDiffSummary = {
  tablesAdded: 0,
  tablesModified: 0,
  tablesDeleted: 0,
  tablesUnchanged: 0,
  columnsAdded: 0,
  columnsModified: 0,
  columnsDeleted: 0,
};

const emptyStructuralSyncStats: KloStructuralSyncStats = {
  tablesCreated: 0,
  tablesUpdated: 0,
  tablesDeleted: 0,
  columnsCreated: 0,
  columnsUpdated: 0,
  columnsDeleted: 0,
};

const emptyArtifactPaths: KloScanArtifactPaths = {
  rawSourcesDir: null,
  reportPath: null,
  manifestShards: [],
  enrichmentArtifacts: [],
};

function mergeDiffSummary(input?: Partial<KloScanDiffSummary>): KloScanDiffSummary {
  return { ...emptyDiffSummary, ...input };
}

function mergeStructuralSyncStats(input?: Partial<KloStructuralSyncStats>): KloStructuralSyncStats {
  return { ...emptyStructuralSyncStats, ...input };
}

function mergeEnrichmentSummary(input?: Partial<KloScanEnrichmentSummary>): KloScanEnrichmentSummary {
  return { ...skippedKloScanEnrichmentSummary, ...input };
}

function mergeEnrichmentState(input?: Partial<KloScanEnrichmentStateSummary>): KloScanEnrichmentStateSummary {
  if (!input) {
    return completedKloScanEnrichmentStateSummary();
  }

  return summarizeKloScanEnrichmentState({
    resumedStages: input.resumedStages ?? [],
    completedStages: input.completedStages ?? [],
    failedStages: input.failedStages ?? [],
  });
}

function mergeArtifactPaths(
  structural?: Partial<KloScanArtifactPaths>,
  enrichment?: Partial<KloScanArtifactPaths>,
): KloScanArtifactPaths {
  return {
    ...emptyArtifactPaths,
    ...structural,
    ...enrichment,
    manifestShards: [...(structural?.manifestShards ?? []), ...(enrichment?.manifestShards ?? [])],
    enrichmentArtifacts: [...(structural?.enrichmentArtifacts ?? []), ...(enrichment?.enrichmentArtifacts ?? [])],
  };
}

function mergeRelationshipSummary(
  structural?: Partial<KloScanRelationshipSummary>,
  enrichment?: Partial<KloScanRelationshipSummary>,
): KloScanRelationshipSummary {
  return {
    accepted: (structural?.accepted ?? 0) + (enrichment?.accepted ?? 0),
    review: (structural?.review ?? 0) + (enrichment?.review ?? 0),
    rejected: (structural?.rejected ?? 0) + (enrichment?.rejected ?? 0),
    skipped: (structural?.skipped ?? 0) + (enrichment?.skipped ?? 0),
  };
}

function manifestShardsWritten(phase: {
  manifestShardsWritten?: number;
  artifactPaths?: Partial<KloScanArtifactPaths>;
}): number {
  return phase.manifestShardsWritten ?? phase.artifactPaths?.manifestShards?.length ?? 0;
}

function requiredCapabilities(mode: KloScanInput['mode'], detectRelationships: boolean | undefined): CapabilityGap[] {
  const required = new Set<CapabilityGap>();

  if (mode === 'enriched') {
    required.add('tableSampling');
    required.add('columnSampling');
    required.add('columnStats');
    required.add('readOnlySql');
  }

  if (mode === 'relationships' || detectRelationships) {
    required.add('columnStats');
    required.add('readOnlySql');
  }

  return [...required];
}

function capabilityGaps(capabilities: KloConnectorCapabilities, input: KloScanInput): CapabilityGap[] {
  return requiredCapabilities(input.mode ?? 'structural', input.detectRelationships).filter(
    (capability) => !capabilities[capability],
  );
}

function warningsForCapabilityGaps(gaps: CapabilityGap[]): KloScanWarning[] {
  return gaps.map((gap) => ({
    code: 'connector_capability_missing',
    message: `KLO scan connector is missing optional capability: ${gap}`,
    recoverable: true,
    metadata: { capability: gap },
  }));
}

function assertNotAborted(context: KloScanContext): void {
  if (context.signal?.aborted) {
    throw new Error('KLO scan aborted');
  }
}

export class KloScanOrchestrator {
  private readonly now: () => Date;
  private readonly syncIdFactory: (input: KloScanInput, context: KloScanContext) => string;

  constructor(options: KloScanOrchestratorOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.syncIdFactory = options.syncIdFactory ?? ((_, context) => context.runId);
  }

  async run<TStructuralResult = unknown, TEnrichmentResult = unknown>(
    input: KloScanOrchestratorRunInput<TStructuralResult, TEnrichmentResult>,
  ): Promise<KloScanOrchestratorRunResult<TStructuralResult, TEnrichmentResult>> {
    const mode = input.input.mode ?? 'structural';
    const syncId = input.syncId ?? this.syncIdFactory(input.input, input.context);
    const gaps = capabilityGaps(input.connector.capabilities, input.input);
    const warnings = warningsForCapabilityGaps(gaps);

    input.context.logger?.info('Starting KLO scan', {
      connectionId: input.input.connectionId,
      connectorId: input.connector.id,
      mode,
      trigger: input.trigger,
    });

    assertNotAborted(input.context);
    const snapshot = await input.connector.introspect(input.input, input.context);

    assertNotAborted(input.context);
    const structural = await input.runStructural(snapshot, input.context);

    let enrichment: KloEnrichmentScanPhaseResult<TEnrichmentResult> | null = null;
    let failedEnrichment: KloScanEnrichmentSummary | null = null;
    if (mode !== 'structural' || input.input.detectRelationships) {
      if (input.runEnrichment) {
        assertNotAborted(input.context);
        try {
          enrichment = await input.runEnrichment(snapshot, structural, input.context);
        } catch (error) {
          const message = kloScanErrorMessage(error);
          failedEnrichment = failedKloScanEnrichmentSummary(mode, input.input.detectRelationships ?? false);
          warnings.push({
            code: 'enrichment_failed',
            message: `KLO scan enrichment failed after structural scan completed: ${message}`,
            recoverable: true,
            metadata: { mode, detectRelationships: input.input.detectRelationships ?? false },
          });
          input.context.logger?.warn('KLO scan enrichment failed after structural scan completed', {
            connectionId: input.input.connectionId,
            runId: input.context.runId,
            mode,
            error: message,
          });
        }
      } else {
        failedEnrichment = failedKloScanEnrichmentSummary(mode, input.input.detectRelationships ?? false);
        warnings.push({
          code: 'connector_capability_missing',
          message: 'KLO scan requested enrichment or relationship detection, but no enrichment phase was provided',
          recoverable: true,
          metadata: { mode, detectRelationships: input.input.detectRelationships ?? false },
        });
      }
    }

    const manifestShardCount = manifestShardsWritten(structural) + (enrichment ? manifestShardsWritten(enrichment) : 0);

    const report: KloScanReport = redactKloScanReport({
      connectionId: input.input.connectionId,
      driver: input.input.driver,
      syncId,
      runId: input.context.runId,
      trigger: input.trigger,
      mode,
      dryRun: input.input.dryRun ?? false,
      artifactPaths: mergeArtifactPaths(structural.artifactPaths, enrichment?.artifactPaths),
      diffSummary: mergeDiffSummary(structural.diffSummary),
      manifestShardsWritten: manifestShardCount,
      structuralSyncStats: mergeStructuralSyncStats(structural.structuralSyncStats),
      enrichment: mergeEnrichmentSummary(enrichment?.enrichment ?? failedEnrichment ?? undefined),
      capabilityGaps: gaps,
      warnings: [...warnings, ...(structural.warnings ?? []), ...(enrichment?.warnings ?? [])],
      relationships: mergeRelationshipSummary(structural.relationships, enrichment?.relationships),
      enrichmentState: mergeEnrichmentState(enrichment?.enrichmentState),
      createdAt: this.now().toISOString(),
    });

    input.context.logger?.info('Completed KLO scan', {
      connectionId: report.connectionId,
      runId: report.runId,
      syncId: report.syncId,
      warnings: report.warnings.length,
    });

    return {
      snapshot,
      structural,
      enrichment,
      report,
    };
  }
}
