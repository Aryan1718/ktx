import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectHistoricSqlStagedDir } from './detect.js';
import {
  HISTORIC_SQL_SOURCE_KEY,
  historicSqlManifestSchema,
  historicSqlMetadataSchema,
  historicSqlPullConfigSchema,
  historicSqlUsageSchema,
} from './types.js';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'historic-sql-detect-'));
}

async function writeJson(root: string, relPath: string, value: unknown): Promise<void> {
  const target = join(root, relPath);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

describe('historic-sql staged dir detection', () => {
  it('detects manifest source', async () => {
    const stagedDir = await tempDir();
    await writeJson(stagedDir, 'manifest.json', {
      source: HISTORIC_SQL_SOURCE_KEY,
      connectionId: 'conn_1',
      dialect: 'snowflake',
      fetchedAt: '2026-05-04T12:00:00.000Z',
      windowStart: '2026-02-03T12:00:00.000Z',
      windowEnd: '2026-05-04T12:00:00.000Z',
      nextSuccessfulCursor: '2026-05-04T11:55:00.000Z',
      templateCount: 0,
      capped: false,
      warnings: [],
      templates: [],
    });

    await expect(detectHistoricSqlStagedDir(stagedDir)).resolves.toBe(true);
  });

  it('detects document-shaped template structure without manifest', async () => {
    const stagedDir = await tempDir();
    await writeFile(join(stagedDir, 'not-a-match.txt'), 'x', 'utf-8');
    await mkdir(join(stagedDir, 'templates', 'fp_1'), { recursive: true });
    await writeFile(join(stagedDir, 'templates', 'fp_1', 'metadata.json'), '{}', 'utf-8');
    await writeFile(join(stagedDir, 'templates', 'fp_1', 'page.md'), '# fp_1\n', 'utf-8');

    await expect(detectHistoricSqlStagedDir(stagedDir)).resolves.toBe(true);
  });

  it('does not detect unrelated directories', async () => {
    const stagedDir = await tempDir();
    await writeJson(stagedDir, 'manifest.json', { source: 'notion' });

    await expect(detectHistoricSqlStagedDir(stagedDir)).resolves.toBe(false);
  });
});

describe('historic-sql schemas', () => {
  it('defaults disabled optional pull-config fields through the parser', () => {
    expect(
      historicSqlPullConfigSchema.parse({
        dialect: 'bigquery',
      }),
    ).toEqual({
      dialect: 'bigquery',
      windowDays: 90,
      lastSuccessfulCursor: null,
      serviceAccountUserPatterns: [],
      redactionPatterns: [],
      maxTemplatesPerRun: 5000,
      minCalls: 5,
    });
  });

  it('accepts postgres pull config with a minCalls floor', () => {
    expect(
      historicSqlPullConfigSchema.parse({
        dialect: 'postgres',
        minCalls: 12,
      }),
    ).toEqual({
      dialect: 'postgres',
      windowDays: 90,
      lastSuccessfulCursor: null,
      serviceAccountUserPatterns: [],
      redactionPatterns: [],
      maxTemplatesPerRun: 5000,
      minCalls: 12,
    });
  });

  it('accepts postgres manifest fields with defaults for older dialects', () => {
    expect(
      historicSqlManifestSchema.parse({
        source: HISTORIC_SQL_SOURCE_KEY,
        connectionId: 'conn_pg',
        dialect: 'postgres',
        fetchedAt: '2026-05-08T12:00:00.000Z',
        windowStart: '2026-05-08T11:00:00.000Z',
        windowEnd: '2026-05-08T12:00:00.000Z',
        nextSuccessfulCursor: '2026-05-08T12:00:00.000Z',
        templateCount: 0,
        capped: false,
        warnings: [],
        templates: [],
        degraded: true,
        statsResetAt: '2026-05-01T00:00:00.000Z',
        baselineFirstRun: true,
        pgServerVersion: 'PostgreSQL 16.4',
        deallocCount: 3,
      }),
    ).toMatchObject({
      dialect: 'postgres',
      degraded: true,
      statsResetAt: '2026-05-01T00:00:00.000Z',
      baselineFirstRun: true,
      pgServerVersion: 'PostgreSQL 16.4',
      deallocCount: 3,
    });

    expect(
      historicSqlManifestSchema.parse({
        source: HISTORIC_SQL_SOURCE_KEY,
        connectionId: 'conn_sf',
        dialect: 'snowflake',
        fetchedAt: '2026-05-08T12:00:00.000Z',
        windowStart: '2026-05-01T12:00:00.000Z',
        windowEnd: '2026-05-08T12:00:00.000Z',
        nextSuccessfulCursor: null,
        templateCount: 0,
        capped: false,
        warnings: [],
        templates: [],
      }),
    ).toMatchObject({
      degraded: false,
      statsResetAt: null,
      baselineFirstRun: false,
      pgServerVersion: null,
      deallocCount: null,
    });
  });

  it('accepts postgres usage stats with mean_runtime_ms and empty samples', () => {
    const parsed = historicSqlUsageSchema.parse({
      stats: {
        executions: 25,
        distinct_users: 2,
        first_seen: '2026-05-08T10:00:00.000Z',
        last_seen: '2026-05-08T12:00:00.000Z',
        p50_runtime_ms: null,
        p95_runtime_ms: null,
        mean_runtime_ms: 32.5,
        error_rate: 0,
        rows_produced: 1042,
      },
      literal_slots: [],
      samples: [],
    });

    expect(parsed.stats.mean_runtime_ms).toBe(32.5);
    expect(parsed.samples).toEqual([]);
  });

  it('pins the Notion-compatible metadata envelope', () => {
    const parsed = historicSqlMetadataSchema.parse({
      id: 'fp_1',
      title: 'snowflake · analytics.orders [fp_1]',
      path: 'templates/fp_1/page.md',
      objectType: 'historic_sql_template',
      lastEditedAt: null,
      properties: {
        fingerprint: 'fp_1',
        sub_cluster_id: null,
        dialect: 'snowflake',
        tables_touched: ['analytics.orders'],
        literal_slots: [{ position: 1, type: 'string', classification: 'constant' }],
        triage_signals: {
          executions_bucket: 'high',
          distinct_users_bucket: 'team',
          error_rate_bucket: 'ok',
          recency_bucket: 'active',
          service_account_only: 'false',
          slot_summary: '1 constant, 0 runtime',
        },
      },
    });

    expect(parsed.objectType).toBe('historic_sql_template');
    expect(parsed.lastEditedAt).toBeNull();
    expect(parsed.properties.triage_signals.service_account_only).toBe('false');
  });
});
