import type { KloScanEnrichmentSummary, KloScanMode } from './types.js';

export const skippedKloScanEnrichmentSummary: KloScanEnrichmentSummary = {
  dataDictionary: 'skipped',
  tableDescriptions: 'skipped',
  columnDescriptions: 'skipped',
  embeddings: 'skipped',
  deterministicRelationships: 'skipped',
  llmRelationshipValidation: 'skipped',
  statisticalValidation: 'skipped',
};

export function failedKloScanEnrichmentSummary(
  mode: KloScanMode,
  detectRelationships = false,
): KloScanEnrichmentSummary {
  if (mode === 'enriched') {
    return {
      dataDictionary: 'failed',
      tableDescriptions: 'failed',
      columnDescriptions: 'failed',
      embeddings: 'failed',
      deterministicRelationships: 'failed',
      llmRelationshipValidation: 'failed',
      statisticalValidation: 'failed',
    };
  }

  if (mode === 'relationships' || detectRelationships) {
    return {
      ...skippedKloScanEnrichmentSummary,
      deterministicRelationships: 'failed',
      statisticalValidation: 'failed',
    };
  }

  return skippedKloScanEnrichmentSummary;
}

export function kloScanErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
