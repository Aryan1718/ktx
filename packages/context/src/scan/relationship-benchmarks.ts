import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import YAML from 'yaml';
import { z } from 'zod';
import type { KloEnrichedRelationship, KloEnrichedSchema, KloRelationshipType } from './enrichment-types.js';
import { snapshotToKloEnrichedSchema } from './local-enrichment.js';
import type { KloRelationshipDiscoveryCandidate } from './relationship-candidates.js';
import {
  generateKloRelationshipDiscoveryCandidates,
  mergeKloRelationshipDiscoveryCandidates,
} from './relationship-candidates.js';
import type { KloLlmProvider } from '@klo/llm';
import { proposeKloRelationshipCandidatesWithLlm } from './relationship-llm-proposal.js';
import {
  discoverKloCompositeRelationships,
  type KloCompositePrimaryKeyCandidate,
  type KloCompositeRelationshipCandidate,
} from './relationship-composite-candidates.js';
import { emptyKloRelationshipProfileArtifact } from './relationship-diagnostics.js';
import { collectKloFormalMetadataRelationships } from './relationship-formal-metadata.js';
import { resolveKloRelationshipGraph } from './relationship-graph-resolver.js';
import { type KloRelationshipReadOnlyExecutor, profileKloRelationshipSchema } from './relationship-profiling.js';
import type { KloRelationshipValidationBudget } from './relationship-budget.js';
import type { KloRelationshipFixtureOrigin } from './relationship-scoring.js';
import { validateKloRelationshipDiscoveryCandidates } from './relationship-validation.js';
import type { KloQueryResult, KloReadOnlyQueryInput, KloScanContext, KloSchemaSnapshot } from './types.js';

export const KLO_RELATIONSHIP_BENCHMARK_MODES = [
  'metadata_present',
  'declared_fks_removed',
  'declared_pks_removed',
  'declared_pks_and_declared_fks_removed',
  'llm_disabled',
  'profiling_disabled',
  'validation_disabled',
  'embeddings_disabled',
] as const;

export type KloRelationshipBenchmarkMode = (typeof KLO_RELATIONSHIP_BENCHMARK_MODES)[number];

export const KLO_RELATIONSHIP_BENCHMARK_TIERS = ['unit', 'row_bearing', 'schema_only', 'smoke', 'product'] as const;

export type KloRelationshipBenchmarkTier = (typeof KLO_RELATIONSHIP_BENCHMARK_TIERS)[number];

export type KloRelationshipBenchmarkStatus = 'accepted' | 'review' | 'rejected';

export interface KloRelationshipBenchmarkExpectedPk {
  table: string;
  columns: string[];
}

export interface KloRelationshipBenchmarkExpectedLink {
  fromTable: string;
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
  relationship: KloRelationshipType;
}

export interface KloRelationshipBenchmarkExpectedLinks {
  expectedPks: KloRelationshipBenchmarkExpectedPk[];
  expectedLinks: KloRelationshipBenchmarkExpectedLink[];
}

export interface KloRelationshipBenchmarkFixture {
  id: string;
  name: string;
  tier: KloRelationshipBenchmarkTier;
  origin: KloRelationshipFixtureOrigin;
  thresholdEligible?: boolean;
  validationBudget?: KloRelationshipValidationBudget;
  snapshot: KloSchemaSnapshot;
  expected: KloRelationshipBenchmarkExpectedLinks;
  defaultModes: KloRelationshipBenchmarkMode[];
  dataPath: string | null;
  columnEmbeddings: Record<string, number[]>;
}

export interface KloRelationshipBenchmarkDetectedPk {
  table: string;
  columns: string[];
  score: number;
  status: KloRelationshipBenchmarkStatus;
}

export interface KloRelationshipBenchmarkDetectedLink {
  fromTable: string;
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
  relationship: KloRelationshipType;
  score: number;
  status: KloRelationshipBenchmarkStatus;
  source: string;
}

export interface KloRelationshipBenchmarkDetectorResult {
  pks: KloRelationshipBenchmarkDetectedPk[];
  links: KloRelationshipBenchmarkDetectedLink[];
  validationBlocked: boolean;
  sqlQueries: number;
  llmCalls: number;
  runtimeSeconds: number;
}

export interface KloRelationshipBenchmarkDetectorInput {
  fixtureId: string;
  mode: KloRelationshipBenchmarkMode;
  snapshot: KloSchemaSnapshot;
  schema: KloEnrichedSchema;
  dataPath: string | null;
  validationBudget?: KloRelationshipValidationBudget;
}

export interface KloRelationshipBenchmarkDetector {
  detect(input: KloRelationshipBenchmarkDetectorInput): Promise<KloRelationshipBenchmarkDetectorResult>;
}

export interface KloRelationshipBenchmarkMetrics {
  pkPrecision: number;
  pkRecall: number;
  pkF1: number;
  fkPrecision: number;
  fkRecall: number;
  fkF1: number;
  acceptedFalsePositiveCount: number;
  reviewRecall: number;
  acceptedOrReviewRecall: number;
  runtimeSeconds: number;
  sqlQueries: number;
  llmCalls: number;
}

export interface KloRelationshipBenchmarkCaseResult {
  fixtureId: string;
  mode: KloRelationshipBenchmarkMode;
  metrics: KloRelationshipBenchmarkMetrics;
  expected: {
    pk: string[];
    fk: string[];
  };
  predicted: {
    pk: string[];
    fk: string[];
    acceptedFk: string[];
    reviewFk: string[];
  };
  falsePositives: {
    pk: string[];
    fk: string[];
  };
  falseNegatives: {
    pk: string[];
    fk: string[];
  };
  skippedComposite: {
    pk: string[];
    fk: string[];
  };
  validationBlocked: boolean;
}

export interface KloRelationshipBenchmarkSuiteResult {
  cases: KloRelationshipBenchmarkCaseResult[];
  validationBlockedCases: string[];
  aggregate: {
    caseCount: number;
    headlineCaseCount: number;
    headlinePkRecall: number;
    headlineFkRecall: number;
    headlineAcceptedOrReviewRecall: number;
    meanPkRecall: number;
    meanFkRecall: number;
    meanAcceptedOrReviewRecall: number;
  };
}

class KloRelationshipBenchmarkSqliteExecutor implements KloRelationshipReadOnlyExecutor {
  private readonly db: Database.Database;
  queryCount = 0;

  constructor(dataPath: string) {
    this.db = new Database(dataPath, { readonly: true, fileMustExist: true });
  }

  async executeReadOnly(input: KloReadOnlyQueryInput, _ctx: KloScanContext): Promise<KloQueryResult> {
    this.queryCount += 1;
    const rows = this.db.prepare(input.sql).all() as Record<string, unknown>[];
    const headers = Object.keys(rows[0] ?? {});
    return {
      headers,
      rows: rows.map((row) => headers.map((header) => row[header])),
      totalRows: rows.length,
      rowCount: rows.length,
    };
  }

  close(): void {
    this.db.close();
  }
}

async function fixtureText(fixtureDir: string, fileName: string): Promise<string> {
  const rawPath = join(fixtureDir, fileName);
  try {
    return await readFile(rawPath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const compressed = await readFile(`${rawPath}.gz`);
  return gunzipSync(compressed).toString('utf-8');
}

async function fixtureDataPath(fixtureDir: string): Promise<string | null> {
  const dataPath = join(fixtureDir, 'data.sqlite');
  try {
    const dataStat = await stat(dataPath);
    return dataStat.isFile() ? dataPath : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const compressedPath = `${dataPath}.gz`;
  try {
    const compressedStat = await stat(compressedPath);
    if (!compressedStat.isFile()) {
      return null;
    }
    const digest = createHash('sha256').update(fixtureDir).digest('hex').slice(0, 16);
    const tempRoot = await mkdtemp(join(tmpdir(), `klo-relationship-benchmark-${digest}-`));
    const extractedPath = join(tempRoot, 'data.sqlite');
    await writeFile(extractedPath, gunzipSync(await readFile(compressedPath)));
    return extractedPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function fixtureColumnEmbeddings(fixtureDir: string): Promise<Record<string, number[]>> {
  const embeddingsPath = join(fixtureDir, 'column-embeddings.json');
  try {
    const raw = await readFile(embeddingsPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([columnId, value]) => {
        if (!Array.isArray(value) || value.some((item) => typeof item !== 'number')) {
          return [];
        }
        return [[columnId, value as number[]]];
      }),
    );
  } catch {
    return {};
  }
}

const modeSchema = z.enum(KLO_RELATIONSHIP_BENCHMARK_MODES);
const tierSchema = z.enum(KLO_RELATIONSHIP_BENCHMARK_TIERS);
const originSchema = z.enum(['synthetic', 'public', 'customer']);
const validationBudgetSchema = z.union([z.literal('all'), z.number().int().nonnegative()]);

const fixtureConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tier: tierSchema.default('unit'),
  origin: originSchema,
  thresholdEligible: z.boolean().optional(),
  validationBudget: validationBudgetSchema.optional(),
  defaultModes: z.array(modeSchema).min(1),
});

const expectedLinksSchema = z.object({
  expectedPks: z.array(
    z.object({
      table: z.string().min(1),
      columns: z.array(z.string().min(1)).min(1),
    }),
  ),
  expectedLinks: z.array(
    z.object({
      fromTable: z.string().min(1),
      fromColumns: z.array(z.string().min(1)).min(1),
      toTable: z.string().min(1),
      toColumns: z.array(z.string().min(1)).min(1),
      relationship: z.enum(['many_to_one', 'one_to_many', 'one_to_one']),
    }),
  ),
});

function sortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function tupleKey(columns: readonly string[]): string {
  return `(${columns.join(',')})`;
}

function pkKey(pk: Pick<KloRelationshipBenchmarkExpectedPk, 'table' | 'columns'>): string {
  return `${pk.table}.${tupleKey(pk.columns)}`;
}

function fkKey(
  link: Pick<KloRelationshipBenchmarkExpectedLink, 'fromTable' | 'fromColumns' | 'toTable' | 'toColumns'>,
): string {
  return `${link.fromTable}.${tupleKey(link.fromColumns)}->${link.toTable}.${tupleKey(link.toColumns)}`;
}

function relationshipKey(link: KloRelationshipBenchmarkDetectedLink): string {
  return fkKey(link);
}

function relationshipToBenchmarkLink(candidate: KloEnrichedRelationship): KloRelationshipBenchmarkDetectedLink {
  return {
    fromTable: candidate.from.table.name,
    fromColumns: candidate.from.columns,
    toTable: candidate.to.table.name,
    toColumns: candidate.to.columns,
    relationship: candidate.relationshipType,
    score: candidate.confidence,
    status: 'accepted',
    source: candidate.source,
  };
}

function broadCandidateToBenchmarkLink(
  candidate: Pick<KloRelationshipDiscoveryCandidate, 'confidence' | 'from' | 'relationshipType' | 'source' | 'to'>,
): KloRelationshipBenchmarkDetectedLink {
  return {
    fromTable: candidate.from.table.name,
    fromColumns: candidate.from.columns,
    toTable: candidate.to.table.name,
    toColumns: candidate.to.columns,
    relationship: candidate.relationshipType,
    score: candidate.confidence,
    status: 'review',
    source: candidate.source,
  };
}

function compositePkToBenchmarkPk(candidate: KloCompositePrimaryKeyCandidate): KloRelationshipBenchmarkDetectedPk {
  return {
    table: candidate.table.name,
    columns: candidate.columns,
    score: candidate.score,
    status: candidate.status,
  };
}

function compositeRelationshipToBenchmarkLink(
  candidate: KloCompositeRelationshipCandidate,
): KloRelationshipBenchmarkDetectedLink {
  return {
    fromTable: candidate.from.table.name,
    fromColumns: candidate.from.columns,
    toTable: candidate.to.table.name,
    toColumns: candidate.to.columns,
    relationship: candidate.relationshipType,
    score: candidate.confidence,
    status: candidate.status,
    source: candidate.source,
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function f1(precision: number, recall: number): number {
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function difference(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

function intersectionSize(left: readonly string[], right: readonly string[]): number {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item)).length;
}

function compositePkKeys(expected: KloRelationshipBenchmarkExpectedLinks): string[] {
  return sortedUnique(expected.expectedPks.filter((pk) => pk.columns.length > 1).map(pkKey));
}

function compositeFkKeys(expected: KloRelationshipBenchmarkExpectedLinks): string[] {
  return sortedUnique(
    expected.expectedLinks.filter((link) => link.fromColumns.length > 1 || link.toColumns.length > 1).map(fkKey),
  );
}

function scalarExpectedPkKeys(expected: KloRelationshipBenchmarkExpectedLinks): string[] {
  return sortedUnique(expected.expectedPks.map(pkKey));
}

function scalarExpectedFkKeys(expected: KloRelationshipBenchmarkExpectedLinks): string[] {
  return sortedUnique(expected.expectedLinks.map(fkKey));
}

function scoreBenchmarkCase(input: {
  fixtureId: string;
  mode: KloRelationshipBenchmarkMode;
  expected: KloRelationshipBenchmarkExpectedLinks;
  detected: KloRelationshipBenchmarkDetectorResult;
}): KloRelationshipBenchmarkCaseResult {
  const expectedPk = scalarExpectedPkKeys(input.expected);
  const expectedFk = scalarExpectedFkKeys(input.expected);
  const predictedPk = sortedUnique(input.detected.pks.map(pkKey));
  const predictedFk = sortedUnique(input.detected.links.map(relationshipKey));
  const acceptedFk = sortedUnique(
    input.detected.links.filter((link) => link.status === 'accepted').map(relationshipKey),
  );
  const reviewFk = sortedUnique(input.detected.links.filter((link) => link.status === 'review').map(relationshipKey));
  const acceptedOrReviewFk = sortedUnique([...acceptedFk, ...reviewFk]);

  const truePositivePk = intersectionSize(predictedPk, expectedPk);
  const truePositiveFk = intersectionSize(acceptedFk, expectedFk);
  const acceptedOrReviewTruePositiveFk = intersectionSize(acceptedOrReviewFk, expectedFk);
  const reviewTruePositiveFk = intersectionSize(reviewFk, expectedFk);
  const pkPrecision = ratio(truePositivePk, predictedPk.length);
  const pkRecall = ratio(truePositivePk, expectedPk.length);
  const fkPrecision = ratio(truePositiveFk, acceptedFk.length);
  const fkRecall = ratio(truePositiveFk, expectedFk.length);

  const falsePositiveFk = difference(acceptedFk, expectedFk);
  return {
    fixtureId: input.fixtureId,
    mode: input.mode,
    metrics: {
      pkPrecision,
      pkRecall,
      pkF1: f1(pkPrecision, pkRecall),
      fkPrecision,
      fkRecall,
      fkF1: f1(fkPrecision, fkRecall),
      acceptedFalsePositiveCount: falsePositiveFk.length,
      reviewRecall: ratio(reviewTruePositiveFk, expectedFk.length),
      acceptedOrReviewRecall: ratio(acceptedOrReviewTruePositiveFk, expectedFk.length),
      runtimeSeconds: input.detected.runtimeSeconds,
      sqlQueries: input.detected.sqlQueries,
      llmCalls: input.detected.llmCalls,
    },
    expected: {
      pk: expectedPk,
      fk: expectedFk,
    },
    predicted: {
      pk: predictedPk,
      fk: predictedFk,
      acceptedFk,
      reviewFk,
    },
    falsePositives: {
      pk: difference(predictedPk, expectedPk),
      fk: falsePositiveFk,
    },
    falseNegatives: {
      pk: difference(expectedPk, predictedPk),
      fk: difference(expectedFk, acceptedOrReviewFk),
    },
    skippedComposite: {
      pk: difference(compositePkKeys(input.expected), predictedPk),
      fk: difference(compositeFkKeys(input.expected), acceptedOrReviewFk),
    },
    validationBlocked: input.detected.validationBlocked,
  };
}

export function maskKloRelationshipBenchmarkSnapshot(
  snapshot: KloSchemaSnapshot,
  mode: KloRelationshipBenchmarkMode,
): KloSchemaSnapshot {
  const relationshipDiscoveryMode =
    mode === 'declared_pks_and_declared_fks_removed' ||
    mode === 'llm_disabled' ||
    mode === 'profiling_disabled' ||
    mode === 'validation_disabled' ||
    mode === 'embeddings_disabled';
  const removePks = relationshipDiscoveryMode || mode === 'declared_pks_removed';
  const removeFks = relationshipDiscoveryMode || mode === 'declared_fks_removed';

  return {
    ...snapshot,
    scope: { ...snapshot.scope },
    metadata: { ...snapshot.metadata },
    tables: snapshot.tables.map((table) => ({
      ...table,
      columns: table.columns.map((column) => ({
        ...column,
        primaryKey: removePks ? false : column.primaryKey,
      })),
      foreignKeys: removeFks ? [] : table.foreignKeys.map((foreignKey) => ({ ...foreignKey })),
    })),
  };
}

export function isKloRelationshipBenchmarkTuningEligible(input: {
  fixture: Pick<KloRelationshipBenchmarkFixture, 'tier' | 'thresholdEligible'>;
  mode: KloRelationshipBenchmarkMode;
  validationBlocked: boolean;
}): boolean {
  if (input.validationBlocked || input.mode !== 'declared_pks_and_declared_fks_removed') {
    return false;
  }

  if (input.fixture.tier === 'smoke' || input.fixture.tier === 'schema_only') {
    return false;
  }

  if (input.fixture.thresholdEligible !== undefined) {
    return input.fixture.thresholdEligible;
  }

  return input.fixture.tier === 'unit' || input.fixture.tier === 'row_bearing';
}

export function kloRelationshipBenchmarkDetectorWithLlm(
  llmProvider: KloLlmProvider,
): KloRelationshipBenchmarkDetector {
  return {
    async detect(input) {
      const startedAt = performance.now();
      const formalMetadata = collectKloFormalMetadataRelationships(input.schema);
      const formalLinks = formalMetadata.accepted.map((relationship) => relationshipToBenchmarkLink(relationship));
      const acceptedKeys = new Set(formalLinks.map(fkKey));
      const sqliteDataAvailable = Boolean(input.dataPath && input.snapshot.driver === 'sqlite');
      const profilingExecutor =
        sqliteDataAvailable && input.mode !== 'profiling_disabled'
          ? new KloRelationshipBenchmarkSqliteExecutor(input.dataPath as string)
          : null;
      const validationExecutor = profilingExecutor && input.mode !== 'validation_disabled' ? profilingExecutor : null;
      const profiles =
        input.mode === 'profiling_disabled'
          ? emptyKloRelationshipProfileArtifact({
              connectionId: input.snapshot.connectionId,
              driver: input.snapshot.driver,
              reason: 'relationship_benchmark_profiling_disabled',
            })
          : await profileKloRelationshipSchema({
              connectionId: input.snapshot.connectionId,
              driver: input.snapshot.driver,
              schema: input.schema,
              executor: profilingExecutor,
              ctx: { runId: `relationship-benchmark:${input.fixtureId}:${input.mode}:profile` },
            });
      const broadRelationshipCandidates = generateKloRelationshipDiscoveryCandidates(input.schema, {
        profiles,
        useEmbeddings: input.mode !== 'embeddings_disabled',
      });
      const llmProposalResult =
        input.mode === 'llm_disabled'
          ? { candidates: [], warnings: [], llmCalls: 0, summary: 'skipped' as const }
          : await proposeKloRelationshipCandidatesWithLlm({
              connectionId: input.snapshot.connectionId,
              schema: input.schema,
              profile: profiles,
              llmProvider,
            });
      const candidates = mergeKloRelationshipDiscoveryCandidates([
        ...broadRelationshipCandidates,
        ...llmProposalResult.candidates,
      ]);
      const validationBudget =
        input.validationBudget === 'all'
          ? 'all'
          : input.validationBudget === undefined
            ? 'all'
            : Math.max(0, input.validationBudget - profiles.queryCount);
      const validatedBroadCandidates = await validateKloRelationshipDiscoveryCandidates({
        connectionId: input.snapshot.connectionId,
        driver: input.snapshot.driver,
        candidates,
        profiles,
        executor: validationExecutor,
        ctx: { runId: `relationship-benchmark:${input.fixtureId}:${input.mode}:validate` },
        tableCount: input.schema.tables.length,
        settings: {
          validationBudget,
        },
      });
      const compositeDetection =
        validationBudget === 'all' &&
        validationExecutor &&
        input.mode !== 'profiling_disabled' &&
        input.mode !== 'validation_disabled'
          ? await discoverKloCompositeRelationships({
              connectionId: input.snapshot.connectionId,
              driver: input.snapshot.driver,
              schema: input.schema,
              profiles,
              executor: validationExecutor,
              ctx: { runId: `relationship-benchmark:${input.fixtureId}:${input.mode}:composite` },
            })
          : { primaryKeys: [], relationships: [], queryCount: 0, warnings: [] };
      profilingExecutor?.close();
      const graph = resolveKloRelationshipGraph({
        schema: input.schema,
        profiles,
        candidates: validatedBroadCandidates,
      });
      const acceptedBroadCandidates = graph.relationships
        .filter((candidate) => candidate.status === 'accepted')
        .map((candidate) => ({
          ...broadCandidateToBenchmarkLink(candidate),
          score: candidate.fkScore,
          status: 'accepted' as const,
        }))
        .filter((candidate) => !acceptedKeys.has(fkKey(candidate)));
      const reviewCandidates = graph.relationships
        .filter((candidate) => candidate.status === 'review')
        .map((candidate) => ({
          ...broadCandidateToBenchmarkLink(candidate),
          score: candidate.fkScore,
          status: 'review' as const,
        }))
        .filter((candidate) => !acceptedKeys.has(fkKey(candidate)));
      const resolvedPks = graph.pks
        .filter((pk) => pk.status !== 'rejected')
        .map((pk) => ({
          table: pk.table,
          columns: pk.columns,
          score: pk.pkScore,
          status: pk.status,
        }));
      const compositePks = compositeDetection.primaryKeys.map(compositePkToBenchmarkPk);
      const allPksByKey = new Map([...resolvedPks, ...compositePks].map((candidate) => [pkKey(candidate), candidate]));
      const pks = sortedUnique(allPksByKey.keys()).flatMap((key) => {
        const candidate = allPksByKey.get(key);
        return candidate ? [candidate] : [];
      });

      return {
        pks,
        links: [
          ...formalLinks,
          ...acceptedBroadCandidates,
          ...reviewCandidates,
          ...compositeDetection.relationships
            .map(compositeRelationshipToBenchmarkLink)
            .filter((candidate) => !acceptedKeys.has(fkKey(candidate))),
        ],
        validationBlocked:
          input.mode === 'validation_disabled' ||
          input.mode === 'profiling_disabled' ||
          (input.dataPath !== null && broadRelationshipCandidates.length > 0 && !profiles.sqlAvailable),
        sqlQueries: profilingExecutor?.queryCount ?? profiles.queryCount,
        llmCalls: llmProposalResult.llmCalls,
        runtimeSeconds: Number(((performance.now() - startedAt) / 1000).toFixed(6)),
      };
    },
  };
}

export function currentKloRelationshipBenchmarkDetector(): KloRelationshipBenchmarkDetector {
  return {
    async detect(input) {
      const startedAt = performance.now();
      const formalMetadata = collectKloFormalMetadataRelationships(input.schema);
      const formalLinks = formalMetadata.accepted.map((relationship) => relationshipToBenchmarkLink(relationship));
      const acceptedKeys = new Set(formalLinks.map(fkKey));
      const sqliteDataAvailable = Boolean(input.dataPath && input.snapshot.driver === 'sqlite');
      const profilingExecutor =
        sqliteDataAvailable && input.mode !== 'profiling_disabled'
          ? new KloRelationshipBenchmarkSqliteExecutor(input.dataPath as string)
          : null;
      const validationExecutor = profilingExecutor && input.mode !== 'validation_disabled' ? profilingExecutor : null;
      const profiles =
        input.mode === 'profiling_disabled'
          ? emptyKloRelationshipProfileArtifact({
              connectionId: input.snapshot.connectionId,
              driver: input.snapshot.driver,
              reason: 'relationship_benchmark_profiling_disabled',
            })
          : await profileKloRelationshipSchema({
              connectionId: input.snapshot.connectionId,
              driver: input.snapshot.driver,
              schema: input.schema,
              executor: profilingExecutor,
              ctx: { runId: `relationship-benchmark:${input.fixtureId}:${input.mode}:profile` },
            });
      const broadRelationshipCandidates = generateKloRelationshipDiscoveryCandidates(input.schema, {
        profiles,
        useEmbeddings: input.mode !== 'embeddings_disabled',
      });
      const validationBudget =
        input.validationBudget === 'all'
          ? 'all'
          : input.validationBudget === undefined
            ? 'all'
            : Math.max(0, input.validationBudget - profiles.queryCount);
      const validatedBroadCandidates = await validateKloRelationshipDiscoveryCandidates({
        connectionId: input.snapshot.connectionId,
        driver: input.snapshot.driver,
        candidates: broadRelationshipCandidates,
        profiles,
        executor: validationExecutor,
        ctx: { runId: `relationship-benchmark:${input.fixtureId}:${input.mode}:validate` },
        tableCount: input.schema.tables.length,
        settings: {
          validationBudget,
        },
      });
      const compositeDetection =
        validationBudget === 'all' &&
        validationExecutor &&
        input.mode !== 'profiling_disabled' &&
        input.mode !== 'validation_disabled'
          ? await discoverKloCompositeRelationships({
              connectionId: input.snapshot.connectionId,
              driver: input.snapshot.driver,
              schema: input.schema,
              profiles,
              executor: validationExecutor,
              ctx: { runId: `relationship-benchmark:${input.fixtureId}:${input.mode}:composite` },
            })
          : { primaryKeys: [], relationships: [], queryCount: 0, warnings: [] };
      profilingExecutor?.close();
      const graph = resolveKloRelationshipGraph({
        schema: input.schema,
        profiles,
        candidates: validatedBroadCandidates,
      });
      const acceptedBroadCandidates = graph.relationships
        .filter((candidate) => candidate.status === 'accepted')
        .map((candidate) => ({
          ...broadCandidateToBenchmarkLink(candidate),
          score: candidate.fkScore,
          status: 'accepted' as const,
        }))
        .filter((candidate) => !acceptedKeys.has(fkKey(candidate)));
      const reviewCandidates = graph.relationships
        .filter((candidate) => candidate.status === 'review')
        .map((candidate) => ({
          ...broadCandidateToBenchmarkLink(candidate),
          score: candidate.fkScore,
          status: 'review' as const,
        }))
        .filter((candidate) => !acceptedKeys.has(fkKey(candidate)));
      const resolvedPks = graph.pks
        .filter((pk) => pk.status !== 'rejected')
        .map((pk) => ({
          table: pk.table,
          columns: pk.columns,
          score: pk.pkScore,
          status: pk.status,
        }));
      const compositePks = compositeDetection.primaryKeys.map(compositePkToBenchmarkPk);
      const allPksByKey = new Map([...resolvedPks, ...compositePks].map((candidate) => [pkKey(candidate), candidate]));
      const pks = sortedUnique(allPksByKey.keys()).flatMap((key) => {
        const candidate = allPksByKey.get(key);
        return candidate ? [candidate] : [];
      });

      return {
        pks,
        links: [
          ...formalLinks,
          ...acceptedBroadCandidates,
          ...reviewCandidates,
          ...compositeDetection.relationships
            .map(compositeRelationshipToBenchmarkLink)
            .filter((candidate) => !acceptedKeys.has(fkKey(candidate))),
        ],
        validationBlocked:
          input.mode === 'validation_disabled' ||
          input.mode === 'profiling_disabled' ||
          (input.dataPath !== null && broadRelationshipCandidates.length > 0 && !profiles.sqlAvailable),
        sqlQueries: profilingExecutor?.queryCount ?? profiles.queryCount,
        llmCalls: 0,
        runtimeSeconds: Number(((performance.now() - startedAt) / 1000).toFixed(6)),
      };
    },
  };
}

export async function loadKloRelationshipBenchmarkFixture(
  fixtureDir: string,
): Promise<KloRelationshipBenchmarkFixture> {
  const [fixtureRaw, snapshotRaw, expectedRaw] = await Promise.all([
    fixtureText(fixtureDir, 'fixture.yaml'),
    fixtureText(fixtureDir, 'snapshot.json'),
    fixtureText(fixtureDir, 'expected-links.yaml'),
  ]);
  const fixture = fixtureConfigSchema.parse(YAML.parse(fixtureRaw));
  const expected = expectedLinksSchema.parse(YAML.parse(expectedRaw));
  const snapshot = JSON.parse(snapshotRaw) as KloSchemaSnapshot;

  return {
    ...fixture,
    snapshot,
    expected,
    dataPath: await fixtureDataPath(fixtureDir),
    columnEmbeddings: await fixtureColumnEmbeddings(fixtureDir),
  };
}

export async function loadKloRelationshipBenchmarkFixtures(
  fixtureRoot: string,
): Promise<KloRelationshipBenchmarkFixture[]> {
  const entries = await readdir(fixtureRoot, { withFileTypes: true });
  const fixtureDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(fixtureRoot, entry.name))
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(fixtureDirs.map((fixtureDir) => loadKloRelationshipBenchmarkFixture(fixtureDir)));
}

export async function runKloRelationshipBenchmarkCase(input: {
  fixture: KloRelationshipBenchmarkFixture;
  mode: KloRelationshipBenchmarkMode;
  detector?: KloRelationshipBenchmarkDetector;
}): Promise<KloRelationshipBenchmarkCaseResult> {
  const snapshot = maskKloRelationshipBenchmarkSnapshot(input.fixture.snapshot, input.mode);
  const embeddings =
    input.mode === 'embeddings_disabled'
      ? new Map<string, number[]>()
      : new Map(Object.entries(input.fixture.columnEmbeddings));
  const schema = snapshotToKloEnrichedSchema(snapshot, embeddings);
  const detected = await (input.detector ?? currentKloRelationshipBenchmarkDetector()).detect({
    fixtureId: input.fixture.id,
    mode: input.mode,
    snapshot,
    schema,
    dataPath: input.fixture.dataPath,
    validationBudget: input.fixture.validationBudget,
  });

  return scoreBenchmarkCase({
    fixtureId: input.fixture.id,
    mode: input.mode,
    expected: input.fixture.expected,
    detected,
  });
}

export async function runKloRelationshipBenchmarkSuite(input: {
  fixtures: KloRelationshipBenchmarkFixture[];
  detector?: KloRelationshipBenchmarkDetector;
}): Promise<KloRelationshipBenchmarkSuiteResult> {
  const cases: KloRelationshipBenchmarkCaseResult[] = [];
  for (const fixture of input.fixtures) {
    for (const mode of fixture.defaultModes) {
      cases.push(
        await runKloRelationshipBenchmarkCase({
          fixture,
          mode,
          detector: input.detector,
        }),
      );
    }
  }

  const fixtureById = new Map(input.fixtures.map((fixture) => [fixture.id, fixture]));
  const headlineCases = cases.filter((item) => {
    const fixture = fixtureById.get(item.fixtureId);
    return fixture
      ? isKloRelationshipBenchmarkTuningEligible({
          fixture,
          mode: item.mode,
          validationBlocked: item.validationBlocked,
        })
      : false;
  });
  const aggregateCases = cases.length === 0 ? [] : cases;

  return {
    cases,
    validationBlockedCases: cases
      .filter((item) => item.validationBlocked)
      .map((item) => `${item.fixtureId}:${item.mode}`),
    aggregate: {
      caseCount: cases.length,
      headlineCaseCount: headlineCases.length,
      headlinePkRecall: mean(headlineCases.map((item) => item.metrics.pkRecall)),
      headlineFkRecall: mean(headlineCases.map((item) => item.metrics.fkRecall)),
      headlineAcceptedOrReviewRecall: mean(headlineCases.map((item) => item.metrics.acceptedOrReviewRecall)),
      meanPkRecall: mean(aggregateCases.map((item) => item.metrics.pkRecall)),
      meanFkRecall: mean(aggregateCases.map((item) => item.metrics.fkRecall)),
      meanAcceptedOrReviewRecall: mean(aggregateCases.map((item) => item.metrics.acceptedOrReviewRecall)),
    },
  };
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
