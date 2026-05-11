import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chunkHistoricSqlUnifiedStagedDir, describeHistoricSqlUnifiedScope } from './chunk-unified.js';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'historic-sql-unified-chunk-'));
}

async function writeJson(root: string, relPath: string, value: unknown): Promise<void> {
  const target = join(root, relPath);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

async function writeUnifiedStagedDir(root: string): Promise<void> {
  await writeJson(root, 'manifest.json', {
    source: 'historic-sql',
    connectionId: 'warehouse',
    dialect: 'postgres',
    fetchedAt: '2026-05-11T00:00:00.000Z',
    windowStart: '2026-02-10T00:00:00.000Z',
    windowEnd: '2026-05-11T00:00:00.000Z',
    snapshotRowCount: 1,
    touchedTableCount: 1,
    parseFailures: 0,
    warnings: [],
    probeWarnings: [],
  });
  await writeJson(root, 'tables/public.orders.json', {
    table: 'public.orders',
    stats: {
      executionsBucket: '10-100',
      distinctUsersBucket: '2-5',
      errorRateBucket: 'none',
      p95RuntimeBucket: '<100ms',
      recencyBucket: 'current',
    },
    columnsByClause: { select: [['status', 'high']] },
    observedJoins: [],
    topTemplates: [{ id: 'orders', canonicalSql: 'select * from public.orders', topUsers: [{ user: 'analyst' }] }],
  });
  await writeJson(root, 'patterns-input.json', {
    templates: [
      {
        id: 'orders',
        canonicalSql: 'select * from public.orders',
        tablesTouched: ['public.orders'],
        executionsBucket: '10-100',
        distinctUsersBucket: '2-5',
        dialect: 'postgres',
      },
    ],
  });
}

describe('chunkHistoricSqlUnifiedStagedDir', () => {
  it('emits one table WorkUnit plus one patterns WorkUnit', async () => {
    const stagedDir = await tempDir();
    await writeUnifiedStagedDir(stagedDir);

    const result = await chunkHistoricSqlUnifiedStagedDir(stagedDir);

    expect(result.workUnits).toEqual([
      expect.objectContaining({
        unitKey: 'historic-sql-table-public-orders',
        displayLabel: 'Historic SQL usage: public.orders',
        rawFiles: ['tables/public.orders.json'],
        dependencyPaths: ['manifest.json'],
        notes: expect.stringContaining('historic_sql_table_digest'),
      }),
      expect.objectContaining({
        unitKey: 'historic-sql-patterns',
        displayLabel: 'Historic SQL cross-table patterns',
        rawFiles: ['patterns-input.json'],
        dependencyPaths: ['manifest.json'],
        notes: expect.stringContaining('historic_sql_patterns'),
      }),
    ]);
    expect(result.workUnits[0]?.notes).toContain('emit_historic_sql_evidence');
    expect(result.workUnits[1]?.notes).toContain('emit_historic_sql_evidence');
    expect(result.reconcileNotes).toEqual(['Historic-SQL touched tables=1 parseFailures=0']);
  });

  it('respects diff sets for unchanged table and patterns files', async () => {
    const stagedDir = await tempDir();
    await writeUnifiedStagedDir(stagedDir);

    await expect(
      chunkHistoricSqlUnifiedStagedDir(stagedDir, {
        added: [],
        modified: ['tables/public.orders.json'],
        deleted: [],
        unchanged: ['manifest.json', 'patterns-input.json'],
      }),
    ).resolves.toMatchObject({
      workUnits: [expect.objectContaining({ unitKey: 'historic-sql-table-public-orders' })],
    });

    await expect(
      chunkHistoricSqlUnifiedStagedDir(stagedDir, {
        added: [],
        modified: ['patterns-input.json'],
        deleted: [],
        unchanged: ['manifest.json', 'tables/public.orders.json'],
      }),
    ).resolves.toMatchObject({
      workUnits: [expect.objectContaining({ unitKey: 'historic-sql-patterns' })],
    });
  });

  it('describes unified staged scope', async () => {
    const stagedDir = await tempDir();
    await writeUnifiedStagedDir(stagedDir);

    const scope = await describeHistoricSqlUnifiedScope(stagedDir);

    expect(scope.isPathInScope('manifest.json')).toBe(true);
    expect(scope.isPathInScope('patterns-input.json')).toBe(true);
    expect(scope.isPathInScope('tables/public.orders.json')).toBe(true);
    expect(scope.isPathInScope('templates/old/page.md')).toBe(false);
  });
});
