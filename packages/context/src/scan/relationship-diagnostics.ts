import type {
  KloEnrichedRelationship,
  KloRelationshipEndpoint,
  KloRelationshipType,
  KloRelationshipUpdate,
} from './enrichment-types.js';
import type {
  KloResolvedRelationshipDiscoveryCandidate,
  KloResolvedRelationshipStatus,
} from './relationship-graph-resolver.js';
import type { KloCompositeRelationshipCandidate } from './relationship-composite-candidates.js';
import type { KloRelationshipProfileArtifact } from './relationship-profiling.js';
import type { KloConnectionDriver, KloScanWarning } from './types.js';

export interface KloRelationshipArtifactEndpoint {
  tableId: string;
  columnIds: string[];
  table: {
    catalog: string | null;
    db: string | null;
    name: string;
  };
  columns: string[];
}

export interface KloRelationshipArtifactEdge {
  id: string;
  status: KloResolvedRelationshipStatus;
  source: string;
  from: KloRelationshipArtifactEndpoint;
  to: KloRelationshipArtifactEndpoint;
  relationshipType: KloRelationshipType;
  confidence: number;
  pkScore: number | null;
  fkScore: number | null;
  score: number | null;
  evidence: unknown | null;
  validation: unknown | null;
  graph: unknown | null;
  reasons: string[];
}

export interface KloRelationshipArtifact {
  connectionId: string;
  accepted: KloRelationshipArtifactEdge[];
  review: KloRelationshipArtifactEdge[];
  rejected: KloRelationshipArtifactEdge[];
  skipped: KloRelationshipUpdate['skipped'];
}

export interface KloRelationshipDiagnosticsSummary {
  accepted: number;
  review: number;
  rejected: number;
  skipped: number;
}

export interface KloRelationshipDiagnosticsValidation {
  available: boolean;
  sqlAvailable: boolean;
  queryCount: number;
}

export interface KloRelationshipDiagnosticsThresholds {
  acceptThreshold: number;
  reviewThreshold: number;
}

export interface KloRelationshipDiagnosticsPolicy {
  validationRequiredForManifest: boolean;
  maxCandidatesPerColumn: number;
  profileSampleRows: number;
  validationConcurrency: number;
}

export interface KloRelationshipDiagnosticsArtifact {
  connectionId: string;
  generatedAt: string;
  summary: KloRelationshipDiagnosticsSummary;
  noAcceptedReason: string | null;
  candidateCountsBySource: Record<string, number>;
  validation: KloRelationshipDiagnosticsValidation;
  thresholds: KloRelationshipDiagnosticsThresholds;
  policy: KloRelationshipDiagnosticsPolicy;
  warnings: KloScanWarning[];
  profileWarnings: string[];
}

export interface BuildKloRelationshipArtifactsInput {
  connectionId: string;
  relationshipUpdate?: KloRelationshipUpdate | null;
  resolvedRelationships?: readonly KloResolvedRelationshipDiscoveryCandidate[];
  compositeRelationships?: readonly KloCompositeRelationshipCandidate[];
}

export interface BuildKloRelationshipDiagnosticsInput {
  connectionId: string;
  artifacts: KloRelationshipArtifact;
  profile: KloRelationshipProfileArtifact;
  warnings?: readonly KloScanWarning[];
  thresholds?: Partial<KloRelationshipDiagnosticsThresholds>;
  policy?: Partial<KloRelationshipDiagnosticsPolicy>;
  generatedAt?: string;
}

export interface EmptyKloRelationshipProfileArtifactInput {
  connectionId: string;
  driver: KloConnectionDriver;
  reason: string;
}

const DEFAULT_THRESHOLDS: KloRelationshipDiagnosticsThresholds = {
  acceptThreshold: 0.85,
  reviewThreshold: 0.55,
};

const DEFAULT_POLICY: KloRelationshipDiagnosticsPolicy = {
  validationRequiredForManifest: true,
  maxCandidatesPerColumn: 25,
  profileSampleRows: 10000,
  validationConcurrency: 4,
};

function endpointArtifact(endpoint: KloRelationshipEndpoint): KloRelationshipArtifactEndpoint {
  return {
    tableId: endpoint.tableId,
    columnIds: endpoint.columnIds,
    table: {
      catalog: endpoint.table.catalog,
      db: endpoint.table.db,
      name: endpoint.table.name,
    },
    columns: endpoint.columns,
  };
}

function uniqueReasons(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function relationshipUpdateEdge(
  relationship: KloEnrichedRelationship,
  status: 'accepted' | 'rejected',
): KloRelationshipArtifactEdge {
  const acceptedReason = relationship.source === 'formal' ? 'formal_metadata_accepted' : 'accepted_relationship_update';
  return {
    id: relationship.id,
    status,
    source: relationship.source,
    from: endpointArtifact(relationship.from),
    to: endpointArtifact(relationship.to),
    relationshipType: relationship.relationshipType,
    confidence: relationship.confidence,
    pkScore: null,
    fkScore: null,
    score: relationship.confidence,
    evidence: relationship.source === 'formal' ? { source: 'formal_metadata' } : null,
    validation: relationship.source === 'formal' ? { status: 'formal_metadata' } : null,
    graph: null,
    reasons: [status === 'accepted' ? acceptedReason : 'rejected_relationship_update'],
  };
}

function resolvedEdge(candidate: KloResolvedRelationshipDiscoveryCandidate): KloRelationshipArtifactEdge {
  return {
    id: candidate.id,
    status: candidate.status,
    source: candidate.source,
    from: endpointArtifact(candidate.from),
    to: endpointArtifact(candidate.to),
    relationshipType: candidate.relationshipType,
    confidence: candidate.confidence,
    pkScore: candidate.pkScore,
    fkScore: candidate.fkScore,
    score: candidate.score,
    evidence: candidate.evidence,
    validation: candidate.validation,
    graph: candidate.graph,
    reasons: uniqueReasons([
      ...candidate.evidence.reasons,
      ...candidate.validation.reasons,
      ...candidate.graph.reasons,
    ]),
  };
}

function compositeEndpointArtifact(endpoint: KloCompositeRelationshipCandidate['from']): KloRelationshipArtifactEndpoint {
  return {
    tableId: endpoint.tableId,
    columnIds: endpoint.columnIds,
    table: {
      catalog: endpoint.table.catalog,
      db: endpoint.table.db,
      name: endpoint.table.name,
    },
    columns: endpoint.columns,
  };
}

function compositeEdge(candidate: KloCompositeRelationshipCandidate): KloRelationshipArtifactEdge {
  return {
    id: candidate.id,
    status: candidate.status,
    source: candidate.source,
    from: compositeEndpointArtifact(candidate.from),
    to: compositeEndpointArtifact(candidate.to),
    relationshipType: candidate.relationshipType,
    confidence: candidate.confidence,
    pkScore: null,
    fkScore: candidate.confidence,
    score: candidate.confidence,
    evidence: { source: candidate.source },
    validation: candidate.validation,
    graph: null,
    reasons: uniqueReasons(candidate.validation.reasons),
  };
}

function emptyArtifacts(connectionId: string): KloRelationshipArtifact {
  return {
    connectionId,
    accepted: [],
    review: [],
    rejected: [],
    skipped: [],
  };
}

function pushUniqueEdge(edges: KloRelationshipArtifactEdge[], edge: KloRelationshipArtifactEdge): void {
  if (!edges.some((item) => item.id === edge.id)) {
    edges.push(edge);
  }
}

export function buildKloRelationshipArtifacts(input: BuildKloRelationshipArtifactsInput): KloRelationshipArtifact {
  const artifacts = emptyArtifacts(input.connectionId);

  if (input.resolvedRelationships) {
    for (const candidate of input.resolvedRelationships) {
      const edge = resolvedEdge(candidate);
      if (edge.status === 'accepted') {
        pushUniqueEdge(artifacts.accepted, edge);
      } else if (edge.status === 'review') {
        pushUniqueEdge(artifacts.review, edge);
      } else {
        pushUniqueEdge(artifacts.rejected, edge);
      }
    }
  }

  for (const candidate of input.compositeRelationships ?? []) {
    const edge = compositeEdge(candidate);
    if (edge.status === 'accepted') {
      pushUniqueEdge(artifacts.accepted, edge);
    } else if (edge.status === 'review') {
      pushUniqueEdge(artifacts.review, edge);
    } else {
      pushUniqueEdge(artifacts.rejected, edge);
    }
  }

  const relationshipUpdate = input.relationshipUpdate;
  if (relationshipUpdate) {
    for (const relationship of relationshipUpdate.accepted) {
      pushUniqueEdge(artifacts.accepted, relationshipUpdateEdge(relationship, 'accepted'));
    }
    for (const relationship of relationshipUpdate.rejected) {
      pushUniqueEdge(artifacts.rejected, relationshipUpdateEdge(relationship, 'rejected'));
    }
    artifacts.skipped.push(...relationshipUpdate.skipped);
  }

  return {
    connectionId: artifacts.connectionId,
    accepted: artifacts.accepted.sort((left, right) => left.id.localeCompare(right.id)),
    review: artifacts.review.sort((left, right) => left.id.localeCompare(right.id)),
    rejected: artifacts.rejected.sort((left, right) => left.id.localeCompare(right.id)),
    skipped: [...artifacts.skipped].sort((left, right) => left.relationshipId.localeCompare(right.relationshipId)),
  };
}

function allEdges(artifacts: KloRelationshipArtifact): KloRelationshipArtifactEdge[] {
  return [...artifacts.accepted, ...artifacts.review, ...artifacts.rejected];
}

function candidateCountsBySource(artifacts: KloRelationshipArtifact): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const edge of allEdges(artifacts)) {
    counts[edge.source] = (counts[edge.source] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function hasReason(artifacts: KloRelationshipArtifact, reason: string): boolean {
  return allEdges(artifacts).some((edge) => edge.reasons.includes(reason));
}

function noAcceptedReason(input: {
  artifacts: KloRelationshipArtifact;
  profile: KloRelationshipProfileArtifact;
}): string | null {
  if (input.artifacts.accepted.length > 0) {
    return null;
  }
  if (
    input.artifacts.review.length > 0 &&
    (!input.profile.sqlAvailable ||
      hasReason(input.artifacts, 'validation_unavailable') ||
      hasReason(input.artifacts, 'validation_unavailable_review_only'))
  ) {
    return 'validation unavailable; review candidates written';
  }
  if (input.artifacts.review.length > 0) {
    return 'relationship candidates require review before manifest writes';
  }
  if (input.artifacts.rejected.length > 0) {
    return 'all candidate pairs were rejected';
  }
  return 'no candidate pairs passed type compatibility';
}

export function emptyKloRelationshipProfileArtifact(
  input: EmptyKloRelationshipProfileArtifactInput,
): KloRelationshipProfileArtifact {
  return {
    connectionId: input.connectionId,
    driver: input.driver,
    sqlAvailable: false,
    queryCount: 0,
    tables: [],
    columns: {},
    warnings: [input.reason],
  };
}

export function buildKloRelationshipDiagnostics(
  input: BuildKloRelationshipDiagnosticsInput,
): KloRelationshipDiagnosticsArtifact {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...input.thresholds };
  const policy = { ...DEFAULT_POLICY, ...input.policy };
  const summary: KloRelationshipDiagnosticsSummary = {
    accepted: input.artifacts.accepted.length,
    review: input.artifacts.review.length,
    rejected: input.artifacts.rejected.length,
    skipped: input.artifacts.skipped.length,
  };

  return {
    connectionId: input.connectionId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    summary,
    noAcceptedReason: noAcceptedReason({ artifacts: input.artifacts, profile: input.profile }),
    candidateCountsBySource: candidateCountsBySource(input.artifacts),
    validation: {
      available: input.profile.sqlAvailable,
      sqlAvailable: input.profile.sqlAvailable,
      queryCount: input.profile.queryCount,
    },
    thresholds,
    policy,
    warnings: [...(input.warnings ?? [])],
    profileWarnings: [...input.profile.warnings],
  };
}
