import { describe, expect, it } from 'vitest';
import {
  failedKloScanEnrichmentSummary,
  kloScanErrorMessage,
  skippedKloScanEnrichmentSummary,
} from './enrichment-summary.js';

describe('KLO scan enrichment summaries', () => {
  it('keeps structural scans skipped when no enrichment was requested', () => {
    expect(failedKloScanEnrichmentSummary('structural', false)).toEqual(skippedKloScanEnrichmentSummary);
  });

  it('marks relationship stages failed when relationship detection fails', () => {
    expect(failedKloScanEnrichmentSummary('relationships', true)).toEqual({
      dataDictionary: 'skipped',
      tableDescriptions: 'skipped',
      columnDescriptions: 'skipped',
      embeddings: 'skipped',
      deterministicRelationships: 'failed',
      llmRelationshipValidation: 'skipped',
      statisticalValidation: 'failed',
    });
  });

  it('marks every enriched-only stage failed when full enrichment fails', () => {
    expect(failedKloScanEnrichmentSummary('enriched', true)).toEqual({
      dataDictionary: 'failed',
      tableDescriptions: 'failed',
      columnDescriptions: 'failed',
      embeddings: 'failed',
      deterministicRelationships: 'failed',
      llmRelationshipValidation: 'failed',
      statisticalValidation: 'failed',
    });
  });

  it('formats unknown thrown values for scan warnings', () => {
    expect(kloScanErrorMessage(new Error('gateway timeout'))).toBe('gateway timeout');
    expect(kloScanErrorMessage('plain failure')).toBe('plain failure');
    expect(kloScanErrorMessage({ code: 'E_SCAN' })).toBe('{"code":"E_SCAN"}');
  });
});
