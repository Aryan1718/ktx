import { createHash } from 'node:crypto';
import type { KloScanEnrichmentStage, KloScanEnrichmentStateSummary, KloScanMode, KloSchemaSnapshot } from './types.js';

export const KLO_SCAN_ENRICHMENT_STAGES: readonly KloScanEnrichmentStage[] = [
  'descriptions',
  'embeddings',
  'relationships',
] as const;

export interface KloScanEnrichmentStageLookup {
  runId: string;
  stage: KloScanEnrichmentStage;
  inputHash: string;
}

export interface KloScanEnrichmentCompletedStage<TOutput = unknown> {
  runId: string;
  connectionId: string;
  syncId: string;
  mode: KloScanMode;
  stage: KloScanEnrichmentStage;
  inputHash: string;
  status: 'completed';
  output: TOutput;
  errorMessage: null;
  updatedAt: string;
}

export interface KloScanEnrichmentFailedStage {
  runId: string;
  connectionId: string;
  syncId: string;
  mode: KloScanMode;
  stage: KloScanEnrichmentStage;
  inputHash: string;
  status: 'failed';
  output: null;
  errorMessage: string;
  updatedAt: string;
}

export type KloScanEnrichmentStageRecord<TOutput = unknown> =
  | KloScanEnrichmentCompletedStage<TOutput>
  | KloScanEnrichmentFailedStage;

export interface KloScanEnrichmentStateStore {
  findCompletedStage<TOutput = unknown>(
    input: KloScanEnrichmentStageLookup,
  ): Promise<KloScanEnrichmentCompletedStage<TOutput> | null>;
  saveCompletedStage<TOutput = unknown>(
    input: Omit<KloScanEnrichmentCompletedStage<TOutput>, 'status' | 'errorMessage'>,
  ): Promise<void>;
  saveFailedStage(input: Omit<KloScanEnrichmentFailedStage, 'status' | 'output'>): Promise<void>;
  listRunStages(runId: string): Promise<KloScanEnrichmentStageRecord[]>;
}

export interface ComputeKloScanEnrichmentInputHashInput {
  snapshot: KloSchemaSnapshot;
  mode: KloScanMode;
  detectRelationships: boolean;
  providerIdentity: Record<string, unknown>;
  relationshipSettings?: unknown;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function computeKloScanEnrichmentInputHash(input: ComputeKloScanEnrichmentInputHashInput): string {
  return createHash('sha256').update(stableJson(input)).digest('hex');
}

function uniqueStages(stages: KloScanEnrichmentStage[]): KloScanEnrichmentStage[] {
  const seen = new Set<KloScanEnrichmentStage>();
  const ordered: KloScanEnrichmentStage[] = [];
  for (const stage of KLO_SCAN_ENRICHMENT_STAGES) {
    if (stages.includes(stage) && !seen.has(stage)) {
      seen.add(stage);
      ordered.push(stage);
    }
  }
  return ordered;
}

export function completedKloScanEnrichmentStateSummary(): KloScanEnrichmentStateSummary {
  return {
    resumedStages: [],
    completedStages: [],
    failedStages: [],
  };
}

export function summarizeKloScanEnrichmentState(input: KloScanEnrichmentStateSummary): KloScanEnrichmentStateSummary {
  return {
    resumedStages: uniqueStages(input.resumedStages),
    completedStages: uniqueStages(input.completedStages),
    failedStages: uniqueStages(input.failedStages),
  };
}
