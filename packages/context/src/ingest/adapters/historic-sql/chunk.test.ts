import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chunkHistoricSqlStagedDir, describeHistoricSqlScope } from './chunk.js';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'historic-sql-chunk-'));
}

async function writeJson(root: string, relPath: string, value: unknown): Promise<void> {
  const target = join(root, relPath);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

async function writeTemplate(root: string): Promise<void> {
  await writeJson(root, 'manifest.json', {
    source: 'historic-sql',
    connectionId: 'conn_1',
    dialect: 'snowflake',
    fetchedAt: '2026-05-04T12:00:00.000Z',
    windowStart: '2026-02-03T12:00:00.000Z',
    windowEnd: '2026-05-04T12:00:00.000Z',
    nextSuccessfulCursor: '2026-05-04T11:55:00.000Z',
    templateCount: 1,
    capped: false,
    warnings: ['source warning'],
    templates: [{ id: 'fp_1', fingerprint: 'fp_1', subClusterId: null, path: 'templates/fp_1/page.md' }],
  });
  await writeJson(root, 'templates/fp_1/metadata.json', {
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
  await writeFile(join(root, 'templates/fp_1/page.md'), '# fp_1\n', 'utf-8');
  await writeJson(root, 'templates/fp_1/usage.json', {
    stats: {
      executions: 20,
      distinct_users: 3,
      first_seen: '2026-05-01T00:00:00.000Z',
      last_seen: '2026-05-04T11:55:00.000Z',
      p50_runtime_ms: 100,
      p95_runtime_ms: 200,
      error_rate: 0,
      rows_produced: 20,
    },
    literal_slots: [{ position: 1, distinct_values: 1, top_values: [['paid', 20]] }],
    samples: [],
  });
}

async function writeSubclusterTemplates(root: string): Promise<void> {
  await writeJson(root, 'manifest.json', {
    source: 'historic-sql',
    connectionId: 'conn_1',
    dialect: 'snowflake',
    fetchedAt: '2026-05-04T12:00:00.000Z',
    windowStart: '2026-02-03T12:00:00.000Z',
    windowEnd: '2026-05-04T12:00:00.000Z',
    nextSuccessfulCursor: '2026-05-04T11:55:00.000Z',
    templateCount: 2,
    capped: false,
    warnings: [],
    templates: [
      {
        id: 'fp_order_status__cat_2b2ff2318877',
        fingerprint: 'fp_order_status',
        subClusterId: 'cat_2b2ff2318877',
        path: 'templates/fp_order_status__cat_2b2ff2318877/page.md',
      },
      {
        id: 'fp_order_status__cat_34f037ddcbfa',
        fingerprint: 'fp_order_status',
        subClusterId: 'cat_34f037ddcbfa',
        path: 'templates/fp_order_status__cat_34f037ddcbfa/page.md',
      },
    ],
  });

  for (const template of [
    { id: 'fp_order_status__cat_2b2ff2318877', subClusterId: 'cat_2b2ff2318877' },
    { id: 'fp_order_status__cat_34f037ddcbfa', subClusterId: 'cat_34f037ddcbfa' },
  ]) {
    await writeJson(root, `templates/${template.id}/metadata.json`, {
      id: template.id,
      title: `snowflake · analytics.orders [fp_ord:${template.subClusterId.slice(-6)}]`,
      path: `templates/${template.id}/page.md`,
      objectType: 'historic_sql_template',
      lastEditedAt: null,
      properties: {
        fingerprint: 'fp_order_status',
        sub_cluster_id: template.subClusterId,
        dialect: 'snowflake',
        tables_touched: ['analytics.orders'],
        literal_slots: [{ position: 1, type: 'string', classification: 'categorical' }],
        triage_signals: {
          executions_bucket: 'mid',
          distinct_users_bucket: 'team',
          error_rate_bucket: 'ok',
          recency_bucket: 'active',
          service_account_only: 'false',
          slot_summary: '0 constant, 0 runtime',
        },
      },
    });
    await writeFile(join(root, `templates/${template.id}/page.md`), `# ${template.id}\n`, 'utf-8');
    await writeJson(root, `templates/${template.id}/usage.json`, {
      stats: {
        executions: 3,
        distinct_users: 3,
        first_seen: '2026-05-04T10:00:00.000Z',
        last_seen: '2026-05-04T10:05:00.000Z',
        p50_runtime_ms: 120,
        p95_runtime_ms: 150,
        error_rate: 0,
        rows_produced: 36,
      },
      literal_slots: [{ position: 1, distinct_values: 1, top_values: [['paid', 3]] }],
      samples: [],
    });
  }
}

describe('chunkHistoricSqlStagedDir', () => {
  it('emits one WorkUnit per changed template and keeps usage as dependency', async () => {
    const stagedDir = await tempDir();
    await writeTemplate(stagedDir);

    const result = await chunkHistoricSqlStagedDir(stagedDir, {
      added: ['templates/fp_1/metadata.json'],
      modified: [],
      deleted: [],
      unchanged: ['templates/fp_1/page.md', 'templates/fp_1/usage.json', 'manifest.json'],
    });

    expect(result.workUnits).toEqual([
      {
        unitKey: 'historic-sql-fp-1',
        displayLabel: 'snowflake · analytics.orders [fp_1]',
        rawFiles: ['templates/fp_1/metadata.json'],
        dependencyPaths: ['manifest.json', 'templates/fp_1/usage.json'],
        peerFileIndex: ['templates/fp_1/page.md'],
        notes:
          'Infer canonical query intent for this single historic-SQL template only. Read metadata.json, page.md, and usage.json for this template; do not group sibling templates in this WorkUnit.',
      },
    ]);
    expect(result.contextReport).toEqual({ capped: false, warnings: ['source warning'] });
  });

  it('emits one WorkUnit per changed categorical sub-cluster', async () => {
    const stagedDir = await tempDir();
    await writeSubclusterTemplates(stagedDir);

    const result = await chunkHistoricSqlStagedDir(stagedDir, {
      added: [
        'templates/fp_order_status__cat_2b2ff2318877/metadata.json',
        'templates/fp_order_status__cat_34f037ddcbfa/metadata.json',
      ],
      modified: [],
      deleted: [],
      unchanged: [
        'manifest.json',
        'templates/fp_order_status__cat_2b2ff2318877/page.md',
        'templates/fp_order_status__cat_2b2ff2318877/usage.json',
        'templates/fp_order_status__cat_34f037ddcbfa/page.md',
        'templates/fp_order_status__cat_34f037ddcbfa/usage.json',
      ],
    });

    expect(
      result.workUnits.map((unit) => ({
        unitKey: unit.unitKey,
        displayLabel: unit.displayLabel,
        rawFiles: unit.rawFiles,
        dependencyPaths: unit.dependencyPaths,
      })),
    ).toEqual([
      {
        unitKey: 'historic-sql-fp-order-status-cat-2b2ff2318877',
        displayLabel: 'snowflake · analytics.orders [fp_ord:318877]',
        rawFiles: ['templates/fp_order_status__cat_2b2ff2318877/metadata.json'],
        dependencyPaths: ['manifest.json', 'templates/fp_order_status__cat_2b2ff2318877/usage.json'],
      },
      {
        unitKey: 'historic-sql-fp-order-status-cat-34f037ddcbfa',
        displayLabel: 'snowflake · analytics.orders [fp_ord:ddcbfa]',
        rawFiles: ['templates/fp_order_status__cat_34f037ddcbfa/metadata.json'],
        dependencyPaths: ['manifest.json', 'templates/fp_order_status__cat_34f037ddcbfa/usage.json'],
      },
    ]);
  });

  it('emits zero WorkUnits for usage-only diffs', async () => {
    const stagedDir = await tempDir();
    await writeTemplate(stagedDir);

    const result = await chunkHistoricSqlStagedDir(stagedDir, {
      added: [],
      modified: ['templates/fp_1/usage.json'],
      deleted: [],
      unchanged: ['templates/fp_1/metadata.json', 'templates/fp_1/page.md', 'manifest.json'],
    });

    expect(result.workUnits).toEqual([]);
    expect(result.eviction).toBeUndefined();
  });

  it('emits eviction only for deleted metadata or page files', async () => {
    const stagedDir = await tempDir();
    await writeTemplate(stagedDir);

    const result = await chunkHistoricSqlStagedDir(stagedDir, {
      added: [],
      modified: [],
      deleted: ['templates/fp_1/usage.json', 'templates/fp_2/page.md'],
      unchanged: [],
    });

    expect(result.eviction).toEqual({ deletedRawPaths: ['templates/fp_2/page.md'] });
  });

  it('describes historic-sql scope without including unrelated paths', async () => {
    const stagedDir = await tempDir();
    await writeTemplate(stagedDir);

    const scope = await describeHistoricSqlScope(stagedDir);

    expect(scope.fingerprint).toHaveLength(64);
    expect(scope.isPathInScope('manifest.json')).toBe(true);
    expect(scope.isPathInScope('templates/fp_1/usage.json')).toBe(true);
    expect(scope.isPathInScope('pages/notion/page.md')).toBe(false);
  });
});
