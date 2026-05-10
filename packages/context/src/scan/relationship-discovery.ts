import type { KloLlmProvider } from '@klo/llm';
import type { KloScanRelationshipConfig } from '../project/config.js';
import type { KloEnrichedRelationship, KloEnrichedSchema, KloRelationshipUpdate } from './enrichment-types.js';
import {
  generateKloRelationshipDiscoveryCandidates,
  type KloRelationshipDiscoveryCandidate,
  mergeKloRelationshipDiscoveryCandidates,
} from './relationship-candidates.js';
import {
  discoverKloCompositeRelationships,
  type KloCompositeRelationshipCandidate,
} from './relationship-composite-candidates.js';
import { collectKloFormalMetadataRelationships } from './relationship-formal-metadata.js';
import {
  type KloResolvedRelationshipDiscoveryCandidate,
  resolveKloRelationshipGraph,
} from './relationship-graph-resolver.js';
import {
  type KloRelationshipLlmProposalGenerateText,
  proposeKloRelationshipCandidatesWithLlm,
} from './relationship-llm-proposal.js';
import {
  createKloRelationshipProfileCache,
  type KloRelationshipProfileArtifact,
  type KloRelationshipReadOnlyExecutor,
  profileKloRelationshipSchema,
} from './relationship-profiling.js';
import { validateKloRelationshipDiscoveryCandidates } from './relationship-validation.js';
import type {
  KloConnectionDriver,
  KloScanConnector,
  KloScanContext,
  KloScanEnrichmentSummary,
  KloScanRelationshipSummary,
  KloScanWarning,
} from './types.js';

export interface DiscoverKloRelationshipsInput {
  connectionId: string;
  driver: KloConnectionDriver;
  connector: KloScanConnector;
  schema: KloEnrichedSchema;
  context: KloScanContext;
  settings: KloScanRelationshipConfig;
  llmProvider?: KloLlmProvider | null;
  generateText?: KloRelationshipLlmProposalGenerateText;
}

export interface DiscoverKloRelationshipsResult {
  relationshipUpdate: KloRelationshipUpdate;
  relationships: KloScanRelationshipSummary;
  profile: KloRelationshipProfileArtifact;
  resolvedRelationships: KloResolvedRelationshipDiscoveryCandidate[];
  compositeRelationships: KloCompositeRelationshipCandidate[];
  statisticalValidation: KloScanEnrichmentSummary['statisticalValidation'];
  llmRelationshipValidation: KloScanEnrichmentSummary['llmRelationshipValidation'];
  warnings: KloScanWarning[];
}

function relationshipFromResolved(candidate: KloResolvedRelationshipDiscoveryCandidate): KloEnrichedRelationship {
  return {
    id: candidate.id,
    source: 'inferred',
    from: candidate.from,
    to: candidate.to,
    relationshipType: candidate.relationshipType,
    confidence: candidate.fkScore,
    isPrimaryKeyReference: candidate.pkScore >= 0.78,
  };
}

function relationshipFromComposite(candidate: KloCompositeRelationshipCandidate): KloEnrichedRelationship {
  return {
    id: candidate.id,
    source: 'inferred',
    from: {
      tableId: candidate.from.tableId,
      columnIds: candidate.from.columnIds,
      table: candidate.from.table,
      columns: candidate.from.columns,
    },
    to: {
      tableId: candidate.to.tableId,
      columnIds: candidate.to.columnIds,
      table: candidate.to.table,
      columns: candidate.to.columns,
    },
    relationshipType: candidate.relationshipType,
    confidence: candidate.confidence,
    isPrimaryKeyReference: candidate.status === 'accepted',
  };
}

function relationshipId(input: Pick<KloEnrichedRelationship, 'from' | 'to'>): string {
  return `${input.from.tableId}:(${input.from.columnIds.join(',')})->${input.to.tableId}:(${input.to.columnIds.join(',')})`;
}

function nonFormalAcceptedRelationships(input: {
  formalIds: ReadonlySet<string>;
  resolvedRelationships: readonly KloResolvedRelationshipDiscoveryCandidate[];
}): KloEnrichedRelationship[] {
  return input.resolvedRelationships
    .filter((candidate) => candidate.status === 'accepted' && !input.formalIds.has(candidate.id))
    .map(relationshipFromResolved);
}

function relationshipSummary(
  resolvedRelationships: readonly KloResolvedRelationshipDiscoveryCandidate[],
): KloScanRelationshipSummary {
  return {
    accepted: resolvedRelationships.filter((candidate) => candidate.status === 'accepted').length,
    review: resolvedRelationships.filter((candidate) => candidate.status === 'review').length,
    rejected: resolvedRelationships.filter((candidate) => candidate.status === 'rejected').length,
    skipped: 0,
  };
}

function compositeSummary(relationships: readonly KloCompositeRelationshipCandidate[]): KloScanRelationshipSummary {
  return {
    accepted: relationships.filter((candidate) => candidate.status === 'accepted').length,
    review: relationships.filter((candidate) => candidate.status === 'review').length,
    rejected: relationships.filter((candidate) => candidate.status === 'rejected').length,
    skipped: 0,
  };
}

async function detectCompositeRelationships(input: {
  connectionId: string;
  driver: DiscoverKloRelationshipsInput['driver'];
  schema: KloEnrichedSchema;
  profile: KloRelationshipProfileArtifact;
  executor: KloRelationshipReadOnlyExecutor | null;
  context: DiscoverKloRelationshipsInput['context'];
  warnings: KloScanWarning[];
}): Promise<KloCompositeRelationshipCandidate[]> {
  if (!input.executor || !input.profile.sqlAvailable) {
    return [];
  }
  try {
    const compositeDetection = await discoverKloCompositeRelationships({
      connectionId: input.connectionId,
      driver: input.driver,
      schema: input.schema,
      profiles: input.profile,
      executor: input.executor,
      ctx: input.context,
    });
    for (const warning of compositeDetection.warnings) {
      input.warnings.push({
        code: 'relationship_validation_failed',
        message: warning,
        recoverable: true,
        metadata: { source: 'composite_relationship_detection' },
      });
    }
    return compositeDetection.relationships;
  } catch (error) {
    input.warnings.push({
      code: 'relationship_validation_failed',
      message: `KLO composite relationship detection failed: ${error instanceof Error ? error.message : String(error)}`,
      recoverable: true,
      metadata: { source: 'composite_relationship_detection' },
    });
    return [];
  }
}

function combinedRelationshipSummary(input: {
  formalAccepted: number;
  formalSkipped: number;
  resolvedRelationships: readonly KloResolvedRelationshipDiscoveryCandidate[];
}): KloScanRelationshipSummary {
  const graph = relationshipSummary(input.resolvedRelationships);
  return {
    accepted: input.formalAccepted + graph.accepted,
    review: graph.review,
    rejected: graph.rejected,
    skipped: input.formalSkipped,
  };
}

function sqlExecutor(input: DiscoverKloRelationshipsInput): {
  executor: KloRelationshipReadOnlyExecutor | null;
  warnings: KloScanWarning[];
} {
  if (!input.connector.capabilities.readOnlySql) {
    return {
      executor: null,
      warnings: [
        {
          code: 'connector_capability_missing',
          message: 'KLO scan connector cannot run read-only SQL relationship validation',
          recoverable: true,
          metadata: { capability: 'readOnlySql' },
        },
      ],
    };
  }

  if (!input.connector.executeReadOnly) {
    return {
      executor: null,
      warnings: [
        {
          code: 'relationship_validation_failed',
          message: 'KLO scan connector advertises readOnlySql but does not expose executeReadOnly',
          recoverable: true,
          metadata: { capability: 'readOnlySql' },
        },
      ],
    };
  }

  return {
    executor: {
      executeReadOnly: input.connector.executeReadOnly.bind(input.connector),
    },
    warnings: [],
  };
}

export async function discoverKloRelationships(
  input: DiscoverKloRelationshipsInput,
): Promise<DiscoverKloRelationshipsResult> {
  const { executor, warnings } = sqlExecutor(input);
  const formalMetadata = collectKloFormalMetadataRelationships(input.schema);
  const profileCache = createKloRelationshipProfileCache();
  const profile = await profileKloRelationshipSchema({
    connectionId: input.connectionId,
    driver: input.driver,
    schema: input.schema,
    executor,
    ctx: input.context,
    profileSampleRows: input.settings.profileSampleRows,
    cache: profileCache,
  });
  const deterministicCandidates: KloRelationshipDiscoveryCandidate[] = generateKloRelationshipDiscoveryCandidates(
    input.schema,
    {
      maxCandidatesPerColumn: input.settings.maxCandidatesPerColumn,
      profiles: profile,
    },
  );
  const llmProposalResult = input.settings.llmProposals
    ? await proposeKloRelationshipCandidatesWithLlm({
        connectionId: input.connectionId,
        schema: input.schema,
        profile,
        llmProvider: input.llmProvider ?? null,
        settings: {
          maxTablesPerBatch: input.settings.maxLlmTablesPerBatch,
        },
        generateText: input.generateText,
      })
    : { candidates: [], warnings: [], llmCalls: 0, summary: 'skipped' as const };
  const candidates = mergeKloRelationshipDiscoveryCandidates([
    ...deterministicCandidates,
    ...llmProposalResult.candidates,
  ]).filter((candidate) => !formalMetadata.acceptedIds.has(candidate.id));
  warnings.push(...llmProposalResult.warnings);
  const validated = await validateKloRelationshipDiscoveryCandidates({
    connectionId: input.connectionId,
    driver: input.driver,
    candidates,
    profiles: profile,
    executor,
    ctx: input.context,
    tableCount: input.schema.tables.length,
    settings: {
      acceptThreshold: input.settings.acceptThreshold,
      reviewThreshold: input.settings.reviewThreshold,
      maxDistinctSourceValues: input.settings.profileSampleRows,
      concurrency: input.settings.validationConcurrency,
      validationBudget: input.settings.validationBudget,
    },
  });
  const graph = resolveKloRelationshipGraph({
    schema: input.schema,
    profiles: profile,
    candidates: validated,
    settings: {
      acceptThreshold: input.settings.acceptThreshold,
      reviewThreshold: input.settings.reviewThreshold,
      validationRequiredForManifest: input.settings.validationRequiredForManifest,
    },
  });
  const compositeRelationships = await detectCompositeRelationships({
    connectionId: input.connectionId,
    driver: input.driver,
    schema: input.schema,
    profile,
    executor,
    context: input.context,
    warnings,
  });
  const inferredAccepted = nonFormalAcceptedRelationships({
    formalIds: formalMetadata.acceptedIds,
    resolvedRelationships: graph.relationships,
  });
  const compositeAccepted = compositeRelationships
    .filter((candidate) => candidate.status === 'accepted')
    .map(relationshipFromComposite);
  const relationshipsForAcceptance = formalMetadata.accepted.concat(inferredAccepted, compositeAccepted);
  const acceptedById = new Map(relationshipsForAcceptance.map((relationship) => [relationship.id, relationship]));
  const accepted = Array.from(acceptedById.values()).sort((left, right) =>
    relationshipId(left).localeCompare(relationshipId(right)),
  );
  const rejected = graph.relationships
    .filter((candidate) => candidate.status === 'rejected')
    .map(relationshipFromResolved);
  const combined = combinedRelationshipSummary({
    formalAccepted: formalMetadata.accepted.length,
    formalSkipped: formalMetadata.skipped.length,
    resolvedRelationships: graph.relationships,
  });
  const compositeCounts = compositeSummary(compositeRelationships);

  return {
    relationshipUpdate: {
      connectionId: input.connectionId,
      accepted,
      rejected,
      skipped: formalMetadata.skipped,
    },
    relationships: {
      accepted: combined.accepted + compositeCounts.accepted,
      review: combined.review + compositeCounts.review,
      rejected: combined.rejected + compositeCounts.rejected,
      skipped: combined.skipped,
    },
    profile,
    resolvedRelationships: graph.relationships,
    compositeRelationships,
    statisticalValidation: profile.sqlAvailable ? 'completed' : 'skipped',
    llmRelationshipValidation: llmProposalResult.summary,
    warnings,
  };
}
