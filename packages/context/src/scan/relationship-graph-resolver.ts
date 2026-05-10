import type {
  KloEnrichedColumn,
  KloEnrichedSchema,
  KloEnrichedTable,
  KloRelationshipEndpoint,
} from './enrichment-types.js';
import { normalizeKloRelationshipName } from './relationship-candidates.js';
import type { KloRelationshipProfileArtifact } from './relationship-profiling.js';
import { scoreKloRelationshipCandidate } from './relationship-scoring.js';
import type { KloValidatedRelationshipDiscoveryCandidate } from './relationship-validation.js';

export type KloResolvedRelationshipStatus = 'accepted' | 'review' | 'rejected';

export interface KloRelationshipGraphResolverSettings {
  acceptThreshold: number;
  reviewThreshold: number;
  minTargetPkScoreForAcceptance: number;
  validationRequiredForManifest: boolean;
}

export interface KloResolvedRelationshipPkEvidence {
  declaredPrimaryKey: boolean;
  targetUniqueness: number;
  incomingAcceptedCount: number;
  incomingReviewCount: number;
  reasons: string[];
}

export interface KloResolvedRelationshipPk {
  table: string;
  columns: string[];
  pkScore: number;
  status: KloResolvedRelationshipStatus;
  incomingCandidateCount: number;
  evidence: KloResolvedRelationshipPkEvidence;
}

export interface KloResolvedRelationshipGraphEvidence {
  targetPkScore: number;
  incomingCandidateCount: number;
  conflictRank: number;
  reasons: string[];
}

export interface KloResolvedRelationshipDiscoveryCandidate
  extends Omit<KloValidatedRelationshipDiscoveryCandidate, 'status'> {
  status: KloResolvedRelationshipStatus;
  pkScore: number;
  fkScore: number;
  graph: KloResolvedRelationshipGraphEvidence;
}

export interface KloRelationshipGraphResolutionResult {
  pks: KloResolvedRelationshipPk[];
  relationships: KloResolvedRelationshipDiscoveryCandidate[];
}

export interface ResolveKloRelationshipGraphInput {
  schema: KloEnrichedSchema;
  profiles: KloRelationshipProfileArtifact;
  candidates: readonly KloValidatedRelationshipDiscoveryCandidate[];
  settings?: Partial<KloRelationshipGraphResolverSettings>;
}

const DEFAULT_SETTINGS: KloRelationshipGraphResolverSettings = {
  acceptThreshold: 0.85,
  reviewThreshold: 0.55,
  minTargetPkScoreForAcceptance: 0.78,
  validationRequiredForManifest: true,
};

const PROFILE_ONLY_PK_MEASURE_NAME_TOKENS = new Set(['amount', 'count', 'price', 'quantity', 'subtotal', 'total']);

function mergeSettings(
  settings: Partial<KloRelationshipGraphResolverSettings> | undefined,
): KloRelationshipGraphResolverSettings {
  return { ...DEFAULT_SETTINGS, ...settings };
}

function roundScore(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(3));
}

function endpointKey(endpoint: KloRelationshipEndpoint): string {
  return `${endpoint.table.name}.${singleRelationshipColumn(endpoint)}`;
}

function sourceKey(endpoint: KloRelationshipEndpoint): string {
  return `${endpoint.tableId}:${endpoint.columnIds.join(',')}`;
}

function singleRelationshipColumn(endpoint: KloRelationshipEndpoint): string {
  const column = endpoint.columns[0];
  if (!column) {
    throw new Error(`Expected relationship endpoint ${endpoint.table.name} to contain one column`);
  }
  return column;
}

function pkKey(pk: Pick<KloResolvedRelationshipPk, 'table' | 'columns'>): string {
  return `${pk.table}.(${pk.columns.join(',')})`;
}

function candidateSortKey(candidate: Pick<KloValidatedRelationshipDiscoveryCandidate, 'from' | 'to'>): string {
  return `${candidate.from.table.name}.${singleRelationshipColumn(candidate.from)}->${candidate.to.table.name}.${singleRelationshipColumn(candidate.to)}`;
}

function statusForScore(
  score: number,
  settings: KloRelationshipGraphResolverSettings,
  acceptedAllowed: boolean,
): KloResolvedRelationshipStatus {
  if (acceptedAllowed && score >= settings.acceptThreshold) {
    return 'accepted';
  }
  if (score >= settings.reviewThreshold) {
    return 'review';
  }
  return 'rejected';
}

function candidateHasValidationPassed(candidate: KloValidatedRelationshipDiscoveryCandidate): boolean {
  return candidate.validation.reasons.includes('validation_passed');
}

function candidateIsValidationUnavailable(candidate: KloValidatedRelationshipDiscoveryCandidate): boolean {
  return (
    candidate.validation.reasons.includes('validation_unavailable') ||
    candidate.validation.reasons.includes('profile_unavailable')
  );
}

function declaredPrimaryKeys(schema: KloEnrichedSchema): KloResolvedRelationshipPk[] {
  const pks: KloResolvedRelationshipPk[] = [];
  for (const table of schema.tables.filter((candidate) => candidate.enabled)) {
    for (const column of table.columns.filter((candidate) => candidate.primaryKey)) {
      pks.push({
        table: table.ref.name,
        columns: [column.name],
        pkScore: 1,
        status: 'accepted',
        incomingCandidateCount: 0,
        evidence: {
          declaredPrimaryKey: true,
          targetUniqueness: 1,
          incomingAcceptedCount: 0,
          incomingReviewCount: 0,
          reasons: ['declared_primary_key'],
        },
      });
    }
  }
  return pks;
}

function schemaTargetColumns(schema: KloEnrichedSchema): Array<{ table: KloEnrichedTable; column: KloEnrichedColumn }> {
  return schema.tables
    .filter((table) => table.enabled)
    .flatMap((table) => table.columns.map((column) => ({ table, column })));
}

function profileUniqueness(profiles: KloRelationshipProfileArtifact, tableName: string, columnName: string): number {
  return profiles.columns[`${tableName}.${columnName}`]?.uniquenessRatio ?? 0;
}

function profileNullRate(profiles: KloRelationshipProfileArtifact, tableName: string, columnName: string): number {
  return profiles.columns[`${tableName}.${columnName}`]?.nullRate ?? 1;
}

function profileColumnExists(profiles: KloRelationshipProfileArtifact, tableName: string, columnName: string): boolean {
  return Boolean(profiles.columns[`${tableName}.${columnName}`]);
}

function profileOnlyPkNameScore(tableName: string, columnName: string): number {
  const table = normalizeKloRelationshipName(tableName).singular;
  const column = normalizeKloRelationshipName(columnName).normalized;
  if (column === 'id') {
    return 1;
  }
  if (column === `${table}_id`) {
    return 0.96;
  }
  if (column === `${table}_key`) {
    return 0.88;
  }
  if (column === 'key' || column === 'uuid') {
    return 0.76;
  }
  return 0;
}

function profileOnlyPkTypeCompatibility(columnName: string): number {
  const tokens = normalizeKloRelationshipName(columnName).normalized.split('_').filter(Boolean);
  return tokens.some((token) => PROFILE_ONLY_PK_MEASURE_NAME_TOKENS.has(token)) ? 0 : 1;
}

function profileOnlyPkEvidence(input: {
  profiles: KloRelationshipProfileArtifact;
  tableName: string;
  columnName: string;
}): { nameScore: number; nullRate: number; uniqueness: number; pkScore: number; weakName: boolean } | null {
  if (!profileColumnExists(input.profiles, input.tableName, input.columnName)) {
    return null;
  }
  const uniqueness = profileUniqueness(input.profiles, input.tableName, input.columnName);
  const nullRate = profileNullRate(input.profiles, input.tableName, input.columnName);
  const nameScore = profileOnlyPkNameScore(input.tableName, input.columnName);
  if (uniqueness < 0.98 || nullRate > 0.05) {
    return null;
  }
  const typeCompatibility = profileOnlyPkTypeCompatibility(input.columnName);
  const scoreBreakdown = scoreKloRelationshipCandidate(
    {
      nameSimilarity: nameScore,
      typeCompatibility,
      valueOverlap: 0,
      embeddingSimilarity: 0,
      profileUniqueness: uniqueness,
      profileNullRate: 1 - nullRate,
      structuralPrior: 0.65,
    },
    {
      nameSimilarity: 0.2,
      typeCompatibility: 0.08,
      valueOverlap: 0,
      embeddingSimilarity: 0,
      profileUniqueness: 0.48,
      profileNullRate: 0.2,
      structuralPrior: 0.04,
    },
  );

  if (scoreBreakdown.score < DEFAULT_SETTINGS.reviewThreshold) {
    return null;
  }

  return { nameScore, nullRate, uniqueness, pkScore: scoreBreakdown.score, weakName: nameScore < 0.74 };
}

function resolveTargetPk(input: {
  table: string;
  column: string;
  declared: KloResolvedRelationshipPk | undefined;
  profiles: KloRelationshipProfileArtifact;
  incoming: readonly KloValidatedRelationshipDiscoveryCandidate[];
  settings: KloRelationshipGraphResolverSettings;
  profileOnly?: { nameScore: number; nullRate: number; uniqueness: number; pkScore: number; weakName: boolean } | null;
}): KloResolvedRelationshipPk {
  if (input.declared) {
    return input.declared;
  }

  const targetUniqueness = profileUniqueness(input.profiles, input.table, input.column);
  const incomingAccepted = input.incoming.filter((candidate) => candidate.status === 'accepted');
  const incomingReview = input.incoming.filter((candidate) => candidate.status === 'review');
  const incomingQuality = Math.max(0, ...input.incoming.map((candidate) => candidate.score));
  const incomingVolume = Math.min(1, incomingAccepted.length * 0.3 + incomingReview.length * 0.15);
  const keyEvidence = Math.max(0, ...input.incoming.map((candidate) => candidate.evidence.targetKeyScore));
  const reasons: string[] = [];

  if (targetUniqueness >= 0.9) {
    reasons.push('unique_target_column');
  }
  if (incomingAccepted.length > 0) {
    reasons.push('incoming_validated_reference');
  }
  if (incomingReview.length > 0) {
    reasons.push('incoming_review_reference');
  }
  if (keyEvidence >= 0.8) {
    reasons.push('target_key_like');
  }
  if (input.incoming.length === 0) {
    reasons.push('no_incoming_references');
  }

  if (input.profileOnly) {
    reasons.push('not_null_profile', 'profile_only_primary_key');
    if (input.profileOnly.weakName) {
      reasons.push('weak_name_profile_key');
    } else {
      reasons.push('profile_key_name');
    }
    const pkScore = input.profileOnly.pkScore;
    return {
      table: input.table,
      columns: [input.column],
      pkScore,
      status: statusForScore(pkScore, input.settings, !input.profileOnly.weakName),
      incomingCandidateCount: 0,
      evidence: {
        declaredPrimaryKey: false,
        targetUniqueness,
        incomingAcceptedCount: 0,
        incomingReviewCount: 0,
        reasons,
      },
    };
  }

  const pkScore = roundScore(0.52 * targetUniqueness + 0.28 * incomingQuality + 0.12 * keyEvidence + 0.08 * incomingVolume);
  const acceptedAllowed = incomingAccepted.length > 0 && targetUniqueness >= 0.9;
  const status =
    incomingReview.length > 0 && pkScore < input.settings.reviewThreshold
      ? 'review'
      : statusForScore(pkScore, input.settings, acceptedAllowed);

  return {
    table: input.table,
    columns: [input.column],
    pkScore,
    status,
    incomingCandidateCount: input.incoming.length,
    evidence: {
      declaredPrimaryKey: false,
      targetUniqueness,
      incomingAcceptedCount: incomingAccepted.length,
      incomingReviewCount: incomingReview.length,
      reasons,
    },
  };
}

function baseRelationshipResolution(input: {
  candidate: KloValidatedRelationshipDiscoveryCandidate;
  pk: KloResolvedRelationshipPk;
  settings: KloRelationshipGraphResolverSettings;
}): KloResolvedRelationshipDiscoveryCandidate {
  const reasons: string[] = [];
  if (input.candidate.status === 'rejected') {
    reasons.push('candidate_validation_rejected');
  }
  if (candidateIsValidationUnavailable(input.candidate)) {
    reasons.push('validation_unavailable_review_only');
  }
  if (input.pk.pkScore >= input.settings.minTargetPkScoreForAcceptance) {
    reasons.push('target_pk_score_passed');
  } else {
    reasons.push('target_pk_score_low');
  }
  if (candidateHasValidationPassed(input.candidate)) {
    reasons.push('validation_passed');
  }

  const validationPassBonus = candidateHasValidationPassed(input.candidate) ? 1 : 0;
  let fkScore = roundScore(
    0.48 * input.candidate.score +
      0.3 * input.pk.pkScore +
      0.14 * input.candidate.confidence +
      0.08 * validationPassBonus,
  );
  let status: KloResolvedRelationshipStatus;

  if (input.candidate.status === 'rejected') {
    status = 'rejected';
  } else if (candidateIsValidationUnavailable(input.candidate)) {
    status = 'review';
    fkScore = Math.max(fkScore, input.settings.reviewThreshold);
  } else {
    const acceptedAllowed =
      input.candidate.status === 'accepted' &&
      input.pk.pkScore >= input.settings.minTargetPkScoreForAcceptance &&
      (!input.settings.validationRequiredForManifest || candidateHasValidationPassed(input.candidate));
    status = statusForScore(fkScore, input.settings, acceptedAllowed);
  }

  if (status === 'accepted') {
    reasons.push('fk_score_passed');
  } else if (status === 'review') {
    reasons.push('fk_score_review');
  } else {
    reasons.push('fk_score_rejected');
  }

  return {
    ...input.candidate,
    status,
    pkScore: input.pk.pkScore,
    fkScore,
    graph: {
      targetPkScore: input.pk.pkScore,
      incomingCandidateCount: input.pk.incomingCandidateCount,
      conflictRank: 1,
      reasons,
    },
  };
}

function relationshipRank(
  left: KloResolvedRelationshipDiscoveryCandidate,
  right: KloResolvedRelationshipDiscoveryCandidate,
): number {
  return (
    right.fkScore - left.fkScore ||
    right.validation.sourceCoverage - left.validation.sourceCoverage ||
    right.pkScore - left.pkScore ||
    candidateSortKey(left).localeCompare(candidateSortKey(right))
  );
}

function applySourceConflicts(
  relationships: readonly KloResolvedRelationshipDiscoveryCandidate[],
): KloResolvedRelationshipDiscoveryCandidate[] {
  const bySource = new Map<string, KloResolvedRelationshipDiscoveryCandidate[]>();
  for (const relationship of relationships) {
    const key = sourceKey(relationship.from);
    bySource.set(key, [...(bySource.get(key) ?? []), relationship]);
  }

  const resolved: KloResolvedRelationshipDiscoveryCandidate[] = [];
  for (const group of bySource.values()) {
    const ranked = [...group].sort(relationshipRank);
    let acceptedSeen = false;
    ranked.forEach((relationship, index) => {
      const conflictRank = index + 1;
      if (relationship.status === 'accepted' && acceptedSeen) {
        resolved.push({
          ...relationship,
          status: 'rejected',
          graph: {
            ...relationship.graph,
            conflictRank,
            reasons: [...relationship.graph.reasons.filter((reason) => reason !== 'fk_score_passed'), 'conflict_lost'],
          },
        });
        return;
      }
      if (relationship.status === 'accepted') {
        acceptedSeen = true;
      }
      resolved.push({
        ...relationship,
        graph: {
          ...relationship.graph,
          conflictRank,
        },
      });
    });
  }

  return resolved.sort(relationshipRank);
}

export function resolveKloRelationshipGraph(
  input: ResolveKloRelationshipGraphInput,
): KloRelationshipGraphResolutionResult {
  const settings = mergeSettings(input.settings);
  const declared = declaredPrimaryKeys(input.schema);
  const declaredByKey = new Map(declared.map((pk) => [pkKey(pk), pk]));
  const incomingByTarget = new Map<string, KloValidatedRelationshipDiscoveryCandidate[]>();

  for (const candidate of input.candidates) {
    const key = endpointKey(candidate.to);
    incomingByTarget.set(key, [...(incomingByTarget.get(key) ?? []), candidate]);
  }

  const pkCandidates = new Map<string, KloResolvedRelationshipPk>();
  for (const item of schemaTargetColumns(input.schema)) {
    const key = `${item.table.ref.name}.(${item.column.name})`;
    const incoming = incomingByTarget.get(`${item.table.ref.name}.${item.column.name}`) ?? [];
    const profileOnly =
      incoming.length === 0 && !item.column.primaryKey
        ? profileOnlyPkEvidence({
            profiles: input.profiles,
            tableName: item.table.ref.name,
            columnName: item.column.name,
          })
        : null;
    if (incoming.length === 0 && !item.column.primaryKey && !profileOnly) {
      continue;
    }
    const pk = resolveTargetPk({
      table: item.table.ref.name,
      column: item.column.name,
      declared: declaredByKey.get(key),
      profiles: input.profiles,
      incoming,
      settings,
      profileOnly,
    });
    pkCandidates.set(key, pk);
  }

  const relationships = input.candidates.map((candidate) => {
    const toColumn = singleRelationshipColumn(candidate.to);
    const key = `${candidate.to.table.name}.(${toColumn})`;
    const pk =
      pkCandidates.get(key) ??
      resolveTargetPk({
        table: candidate.to.table.name,
        column: toColumn,
        declared: undefined,
        profiles: input.profiles,
        incoming: incomingByTarget.get(endpointKey(candidate.to)) ?? [],
        settings,
        profileOnly: null,
      });
    pkCandidates.set(key, pk);
    return baseRelationshipResolution({ candidate, pk, settings });
  });

  return {
    pks: Array.from(pkCandidates.values()).sort(
      (left, right) => right.pkScore - left.pkScore || pkKey(left).localeCompare(pkKey(right)),
    ),
    relationships: applySourceConflicts(relationships),
  };
}
