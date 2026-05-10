import { describe, expect, it } from 'vitest';
import {
  REDACTED_KLO_CREDENTIAL_VALUE,
  redactKloCredentialEnvelope,
  redactKloCredentialValue,
  redactKloScanMetadata,
  redactKloScanReport,
  redactKloScanWarning,
} from './credentials.js';
import type { KloCredentialEnvelope, KloScanReport, KloScanWarning } from './types.js';

describe('KLO scan credential redaction', () => {
  it('keeps credential references inspectable', () => {
    const envReference: KloCredentialEnvelope = { kind: 'env', name: 'DATABASE_URL' };
    const fileReference: KloCredentialEnvelope = { kind: 'file', path: '~/.config/klo/warehouse' };

    expect(redactKloCredentialEnvelope(envReference)).toEqual(envReference);
    expect(redactKloCredentialEnvelope(fileReference)).toEqual(fileReference);
  });

  it('redacts resolved credential envelope values recursively', () => {
    expect(
      redactKloCredentialEnvelope({
        kind: 'resolved',
        source: 'host',
        values: {
          username: 'readonly',
          password: 'secret-password', // pragma: allowlist secret
          nested: {
            api_key: 'phx_123', // pragma: allowlist secret
            warehouse: 'compute_wh',
          },
          headers: [{ authorizationToken: 'token-value' }, { label: 'safe' }],
        },
      }),
    ).toEqual({
      kind: 'resolved',
      source: 'host',
      redacted: true,
      values: {
        username: 'readonly',
        password: REDACTED_KLO_CREDENTIAL_VALUE,
        nested: {
          api_key: REDACTED_KLO_CREDENTIAL_VALUE,
          warehouse: 'compute_wh',
        },
        headers: [{ authorizationToken: REDACTED_KLO_CREDENTIAL_VALUE }, { label: 'safe' }],
      },
    });
  });

  it('redacts scan metadata fields that commonly contain secrets', () => {
    expect(
      redactKloScanMetadata({
        driver: 'postgres',
        url: 'postgres://user:pass@example.test/db', // pragma: allowlist secret
        serviceAccountJson: {
          client_email: 'reader@example.test',
          private_key: 'pem-value', // pragma: allowlist secret
        },
        safeCount: 3,
      }),
    ).toEqual({
      driver: 'postgres',
      url: REDACTED_KLO_CREDENTIAL_VALUE,
      serviceAccountJson: {
        client_email: 'reader@example.test',
        private_key: REDACTED_KLO_CREDENTIAL_VALUE,
      },
      safeCount: 3,
    });
  });

  it('redacts scan warning messages and metadata without hiding safe context', () => {
    const warning: KloScanWarning = {
      code: 'sampling_failed',
      message: 'sample failed for postgres://reader:secret@example.test/db', // pragma: allowlist secret
      recoverable: true,
      metadata: {
        table: 'orders',
        url: 'postgres://reader:secret@example.test/db', // pragma: allowlist secret
        nested: {
          api_key: 'sk_test_123', // pragma: allowlist secret
          schema: 'public',
        },
      },
    };

    expect(redactKloScanWarning(warning)).toEqual({
      code: 'sampling_failed',
      message: 'sample failed for postgres://reader:<redacted>@example.test/db',
      recoverable: true,
      metadata: {
        table: 'orders',
        url: REDACTED_KLO_CREDENTIAL_VALUE,
        nested: {
          api_key: REDACTED_KLO_CREDENTIAL_VALUE,
          schema: 'public',
        },
      },
    });
  });

  it('redacts scan report warning metadata recursively', () => {
    const report: KloScanReport = {
      connectionId: 'warehouse',
      driver: 'postgres',
      syncId: 'sync-1',
      runId: 'run-1',
      trigger: 'cli',
      mode: 'structural',
      dryRun: false,
      artifactPaths: {
        rawSourcesDir: 'raw-sources/warehouse/live-database/sync-1',
        reportPath: 'raw-sources/warehouse/live-database/sync-1/scan-report.json',
        manifestShards: [],
        enrichmentArtifacts: [],
      },
      diffSummary: {
        tablesAdded: 0,
        tablesModified: 0,
        tablesDeleted: 0,
        tablesUnchanged: 0,
        columnsAdded: 0,
        columnsModified: 0,
        columnsDeleted: 0,
      },
      manifestShardsWritten: 0,
      structuralSyncStats: {
        tablesCreated: 0,
        tablesUpdated: 0,
        tablesDeleted: 0,
        columnsCreated: 0,
        columnsUpdated: 0,
        columnsDeleted: 0,
      },
      enrichment: {
        dataDictionary: 'skipped',
        tableDescriptions: 'skipped',
        columnDescriptions: 'skipped',
        embeddings: 'skipped',
        deterministicRelationships: 'skipped',
        llmRelationshipValidation: 'skipped',
        statisticalValidation: 'skipped',
      },
      capabilityGaps: [],
      warnings: [
        {
          code: 'credential_redacted',
          message: 'metadata redacted',
          recoverable: true,
          metadata: {
            credentials_json: '{"private_key":"pem-value"}', // pragma: allowlist secret
            safeCount: 2,
          },
        },
      ],
      relationships: { accepted: 0, review: 0, rejected: 0, skipped: 0 },
      enrichmentState: {
        resumedStages: [],
        completedStages: [],
        failedStages: [],
      },
      createdAt: '2026-04-29T00:00:00.000Z',
    };

    const redacted = redactKloScanReport(report);

    expect(redacted.warnings[0]?.metadata).toEqual({
      credentials_json: REDACTED_KLO_CREDENTIAL_VALUE,
      safeCount: 2,
    });
    expect(report.warnings[0]?.metadata).toEqual({
      credentials_json: '{"private_key":"pem-value"}', // pragma: allowlist secret
      safeCount: 2,
    });
  });

  it('redacts standalone primitive credential values only when the field key is sensitive', () => {
    expect(redactKloCredentialValue('password', 'abc')).toBe(REDACTED_KLO_CREDENTIAL_VALUE);
    expect(redactKloCredentialValue('schema', 'public')).toBe('public');
  });
});
