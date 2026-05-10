import type { KloLlmProvider } from '@klo/llm';
import type { generateText } from 'ai';
import { z } from 'zod';
import { generateKloObject } from '../llm/index.js';
import type { KloEnrichedColumn, KloEnrichedSchema, KloEnrichedTable } from './enrichment-types.js';
import {
  normalizeKloRelationshipName,
  type KloRelationshipDiscoveryCandidate,
} from './relationship-candidates.js';
import type { KloRelationshipColumnProfile, KloRelationshipProfileArtifact } from './relationship-profiling.js';
import type { KloScanEnrichmentSummary, KloScanWarning, KloTableRef } from './types.js';

const relationshipLlmProposalSchema = z.object({
  pkCandidates: z.array(
    z.object({
      table: z.string(),
      column: z.string(),
      confidence: z.number(),
      rationale: z.string(),
    }),
  ),
  fkCandidates: z.array(
    z.object({
      fromTable: z.string(),
      fromColumn: z.string(),
      toTable: z.string(),
      toColumn: z.string(),
      confidence: z.number(),
      rationale: z.string(),
    }),
  ),
});

type KloRelationshipLlmProposalOutput = z.infer<typeof relationshipLlmProposalSchema>;
type GenerateTextInput = Parameters<typeof generateText>[0];
export type KloRelationshipLlmProposalGenerateText = (
  input: GenerateTextInput,
) => Promise<{ text?: string; output?: unknown }>;

export interface KloRelationshipLlmProposalSettings {
  maxTablesPerBatch: number;
  maxColumnsPerTable: number;
  maxSampleValuesPerColumn: number;
  minConfidence: number;
}

export interface ProposeKloRelationshipCandidatesWithLlmInput {
  connectionId: string;
  schema: KloEnrichedSchema;
  profile: KloRelationshipProfileArtifact;
  llmProvider: KloLlmProvider | null;
  settings?: Partial<KloRelationshipLlmProposalSettings>;
  generateText?: KloRelationshipLlmProposalGenerateText;
}

export interface KloRelationshipLlmProposalResult {
  candidates: KloRelationshipDiscoveryCandidate[];
  warnings: KloScanWarning[];
  llmCalls: number;
  summary: KloScanEnrichmentSummary['llmRelationshipValidation'];
}

const DEFAULT_SETTINGS: KloRelationshipLlmProposalSettings = {
  maxTablesPerBatch: 40,
  maxColumnsPerTable: 80,
  maxSampleValuesPerColumn: 5,
  minConfidence: 0.55,
};

function mergeSettings(
  settings: Partial<KloRelationshipLlmProposalSettings> | undefined,
): KloRelationshipLlmProposalSettings {
  return { ...DEFAULT_SETTINGS, ...settings };
}

function clampConfidence(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(3));
}

function modelIsDeterministic(llmProvider: KloLlmProvider): boolean {
  const model = llmProvider.getModel('candidateExtraction');
  return (model as { provider?: string }).provider === 'deterministic';
}

function findTable(schema: KloEnrichedSchema, name: string): KloEnrichedTable | null {
  const normalized = name.toLowerCase();
  return schema.tables.find((table) => table.ref.name.toLowerCase() === normalized) ?? null;
}

function findColumn(table: KloEnrichedTable, name: string): KloEnrichedColumn | null {
  const normalized = name.toLowerCase();
  return table.columns.find((column) => column.name.toLowerCase() === normalized) ?? null;
}

function profileKey(table: KloTableRef, column: KloEnrichedColumn): string {
  return `${table.name}.${column.name}`;
}

function profileForColumn(
  profile: KloRelationshipProfileArtifact,
  table: KloEnrichedTable,
  column: KloEnrichedColumn,
): KloRelationshipColumnProfile | null {
  return profile.columns[profileKey(table.ref, column)] ?? null;
}

function rowCountForTable(profile: KloRelationshipProfileArtifact, table: KloEnrichedTable): number | null {
  return profile.tables.find((item) => item.table.name.toLowerCase() === table.ref.name.toLowerCase())?.rowCount ?? null;
}

function buildEvidencePacket(
  schema: KloEnrichedSchema,
  profile: KloRelationshipProfileArtifact,
  settings: KloRelationshipLlmProposalSettings,
): Record<string, unknown> {
  return {
    connectionId: schema.connectionId,
    sqlAvailable: profile.sqlAvailable,
    tables: schema.tables
      .filter((table) => table.enabled)
      .slice(0, settings.maxTablesPerBatch)
      .map((table) => ({
        name: table.ref.name,
        catalog: table.ref.catalog,
        db: table.ref.db,
        rowCount: rowCountForTable(profile, table),
        columns: table.columns.slice(0, settings.maxColumnsPerTable).map((column) => {
          const columnProfile = profileForColumn(profile, table, column);
          return {
            name: column.name,
            nativeType: column.nativeType,
            normalizedType: column.normalizedType,
            dimensionType: column.dimensionType,
            nullable: column.nullable,
            declaredPrimaryKey: column.primaryKey,
            profile: columnProfile
              ? {
                  rowCount: columnProfile.rowCount,
                  nullCount: columnProfile.nullCount,
                  distinctCount: columnProfile.distinctCount,
                  uniquenessRatio: columnProfile.uniquenessRatio,
                  nullRate: columnProfile.nullRate,
                  sampleValues: columnProfile.sampleValues.slice(0, settings.maxSampleValuesPerColumn),
                }
              : null,
          };
        }),
      })),
  };
}

function pkProposalKey(table: string, column: string): string {
  return `${table.toLowerCase()}.${column.toLowerCase()}`;
}

function endpoint(table: KloEnrichedTable, column: KloEnrichedColumn) {
  return {
    tableId: table.id,
    columnIds: [column.id],
    table: table.ref,
    columns: [column.name],
  };
}

function relationshipId(fromTable: KloEnrichedTable, fromColumn: KloEnrichedColumn, toTable: KloEnrichedTable, toColumn: KloEnrichedColumn): string {
  return `${fromTable.id}:(${fromColumn.id})->${toTable.id}:(${toColumn.id})`;
}

function invalidReferenceWarning(message: string, metadata: Record<string, unknown>): KloScanWarning {
  return {
    code: 'relationship_llm_invalid_reference',
    message,
    recoverable: true,
    metadata,
  };
}

function mapValidProposals(
  schema: KloEnrichedSchema,
  output: KloRelationshipLlmProposalOutput,
  settings: KloRelationshipLlmProposalSettings,
): { candidates: KloRelationshipDiscoveryCandidate[]; warnings: KloScanWarning[] } {
  const warnings: KloScanWarning[] = [];
  const pkProposals = new Set(output.pkCandidates.map((item) => pkProposalKey(item.table, item.column)));
  const candidates: KloRelationshipDiscoveryCandidate[] = [];

  for (const item of output.fkCandidates) {
    if (item.confidence < settings.minConfidence) {
      continue;
    }
    const fromTable = findTable(schema, item.fromTable);
    const toTable = findTable(schema, item.toTable);
    const fromColumn = fromTable ? findColumn(fromTable, item.fromColumn) : null;
    const toColumn = toTable ? findColumn(toTable, item.toColumn) : null;
    if (!fromTable || !toTable || !fromColumn || !toColumn) {
      warnings.push(
        invalidReferenceWarning('KLO relationship LLM proposal referenced a table or column that is not in the schema.', {
          proposal: item,
        }),
      );
      continue;
    }

    const pkProposalExists = pkProposals.has(pkProposalKey(toTable.ref.name, toColumn.name));
    candidates.push({
      id: relationshipId(fromTable, fromColumn, toTable, toColumn),
      from: endpoint(fromTable, fromColumn),
      to: endpoint(toTable, toColumn),
      source: 'llm_proposal',
      status: 'review',
      relationshipType: 'many_to_one',
      confidence: clampConfidence(item.confidence),
      evidence: {
        sourceColumnBase: normalizeKloRelationshipName(fromColumn.name).singular,
        targetTableBase: normalizeKloRelationshipName(toTable.ref.name).singular,
        targetColumnBase: normalizeKloRelationshipName(toColumn.name).singular,
        targetKeyScore: pkProposalExists ? 0.88 : 0.68,
        nameScore: 0.45,
        reasons: pkProposalExists ? ['llm_proposal', 'llm_pk_proposal'] : ['llm_proposal'],
        llmConfidence: clampConfidence(item.confidence),
        llmRationale: item.rationale,
      },
    });
  }

  return { candidates, warnings };
}

function generationFailureWarning(error: unknown): KloScanWarning {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: 'relationship_llm_proposal_failed',
    message: `KLO relationship LLM proposal failed: ${message}`,
    recoverable: true,
  };
}

export async function proposeKloRelationshipCandidatesWithLlm(
  input: ProposeKloRelationshipCandidatesWithLlmInput,
): Promise<KloRelationshipLlmProposalResult> {
  if (!input.llmProvider || modelIsDeterministic(input.llmProvider)) {
    return { candidates: [], warnings: [], llmCalls: 0, summary: 'skipped' };
  }

  const settings = mergeSettings(input.settings);
  const evidence = buildEvidencePacket(input.schema, input.profile, settings);
  const prompt = [
    'You are helping KLO review possible SQL relationships before validation.',
    'Use only the compact schema evidence. Propose likely primary keys and foreign keys for later SQL validation.',
    'Return structured output only; never assume a join is accepted.',
    JSON.stringify(evidence),
  ].join('\n\n');

  try {
    const generated = await generateKloObject<
      KloRelationshipLlmProposalOutput,
      typeof relationshipLlmProposalSchema
    >({
      llmProvider: input.llmProvider,
      role: 'candidateExtraction',
      prompt,
      schema: relationshipLlmProposalSchema,
      generateText: input.generateText,
    });
    const output = relationshipLlmProposalSchema.parse(generated);
    const mapped = mapValidProposals(input.schema, output, settings);
    return {
      candidates: mapped.candidates,
      warnings: mapped.warnings,
      llmCalls: 1,
      summary: 'completed',
    };
  } catch (error) {
    return {
      candidates: [],
      warnings: [generationFailureWarning(error)],
      llmCalls: 1,
      summary: 'failed',
    };
  }
}
