import { describe, expect, it, vi } from 'vitest';
import {
  HistoricSqlExtensionMissingError,
  HistoricSqlGrantsMissingError,
  HistoricSqlVersionUnsupportedError,
} from './errors.js';
import { PostgresPgssQueryHistoryReader } from './postgres-pgss-query-history-reader.js';

interface FakeQueryResult {
  headers: string[];
  rows: unknown[][];
  totalRows?: number;
  error?: string;
}

function queryClient(results: Array<FakeQueryResult | Error>) {
  const executeQuery = vi.fn(async (_query: string, _params?: unknown[]) => {
    const next = results.shift();
    if (!next) {
      throw new Error('unexpected query');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  });
  return { executeQuery };
}

function executedSql(client: ReturnType<typeof queryClient>, index: number): string {
  const call = client.executeQuery.mock.calls[index];
  if (!call) {
    throw new Error(`expected query client call ${index}`);
  }
  return call[0];
}

describe('PostgresPgssQueryHistoryReader', () => {
  it('probes version, extension presence, grants, and tracking state', async () => {
    const client = queryClient([
      {
        headers: ['server_version_num', 'server_version'],
        rows: [[160004, 'PostgreSQL 16.4 on x86_64-apple-darwin']],
      },
      { headers: ['?column?'], rows: [[1]] },
      { headers: ['has_role'], rows: [[true]] },
      { headers: ['track'], rows: [['top']] },
      { headers: ['max'], rows: [['5000']] },
    ]);
    const reader = new PostgresPgssQueryHistoryReader();

    await expect(reader.probe(client)).resolves.toEqual({
      pgServerVersion: 'PostgreSQL 16.4 on x86_64-apple-darwin',
      warnings: [],
    });

    expect(executedSql(client, 0)).toContain("current_setting('server_version_num')::int");
    expect(executedSql(client, 1)).toBe('SELECT 1 FROM pg_stat_statements LIMIT 1');
    expect(executedSql(client, 2)).toBe(
      "SELECT pg_has_role(current_user, 'pg_read_all_stats', 'USAGE') AS has_role",
    );
    expect(executedSql(client, 3)).toBe("SELECT current_setting('pg_stat_statements.track') AS track");
    expect(executedSql(client, 4)).toBe("SELECT current_setting('pg_stat_statements.max') AS max");
  });

  it('rejects PostgreSQL versions older than 14 without probing the extension', async () => {
    const client = queryClient([
      {
        headers: ['server_version_num', 'server_version'],
        rows: [[130012, 'PostgreSQL 13.12']],
      },
      {
        headers: ['stats_reset', 'dealloc'],
        rows: [[new Date('2026-05-01T00:00:00.000Z'), 7]],
      },
    ]);
    const reader = new PostgresPgssQueryHistoryReader();

    const promise = reader.probe(client);
    await expect(promise).rejects.toMatchObject({
      name: 'HistoricSqlVersionUnsupportedError',
      dialect: 'postgres',
      detectedVersion: 'PostgreSQL 13.12',
      minimumVersion: 'PostgreSQL 14',
    });
    await expect(promise).rejects.toBeInstanceOf(HistoricSqlVersionUnsupportedError);
    expect(client.executeQuery).toHaveBeenCalledTimes(1);
  });

  it('maps a missing pg_stat_statements relation to HistoricSqlExtensionMissingError', async () => {
    const client = queryClient([
      {
        headers: ['server_version_num', 'server_version'],
        rows: [[160004, 'PostgreSQL 16.4']],
      },
      new Error('relation "pg_stat_statements" does not exist'),
    ]);
    const reader = new PostgresPgssQueryHistoryReader();

    const promise = reader.probe(client);
    await expect(promise).rejects.toMatchObject({
      name: 'HistoricSqlExtensionMissingError',
      dialect: 'postgres',
    });
    await expect(promise).rejects.toBeInstanceOf(HistoricSqlExtensionMissingError);
  });

  it('maps pg_stat_statements preload failures to HistoricSqlExtensionMissingError with preload remediation', async () => {
    const client = queryClient([
      {
        headers: ['server_version_num', 'server_version'],
        rows: [[160004, 'PostgreSQL 16.4']],
      },
      new Error('pg_stat_statements must be loaded via shared_preload_libraries'),
    ]);
    const reader = new PostgresPgssQueryHistoryReader();

    const promise = reader.probe(client);
    await expect(promise).rejects.toMatchObject({
      name: 'HistoricSqlExtensionMissingError',
      dialect: 'postgres',
      message: 'pg_stat_statements is installed but not loaded via shared_preload_libraries.',
      remediation: expect.stringContaining("shared_preload_libraries includes 'pg_stat_statements'"),
    });
    await expect(promise).rejects.toBeInstanceOf(HistoricSqlExtensionMissingError);
  });

  it('maps missing pg_read_all_stats membership to HistoricSqlGrantsMissingError', async () => {
    const client = queryClient([
      {
        headers: ['server_version_num', 'server_version'],
        rows: [[160004, 'PostgreSQL 16.4']],
      },
      { headers: ['?column?'], rows: [[1]] },
      { headers: ['has_role'], rows: [[false]] },
    ]);
    const reader = new PostgresPgssQueryHistoryReader();

    const promise = reader.probe(client);
    await expect(promise).rejects.toMatchObject({
      name: 'HistoricSqlGrantsMissingError',
      dialect: 'postgres',
      remediation: 'GRANT pg_read_all_stats TO <connection role>;',
    });
    await expect(promise).rejects.toBeInstanceOf(HistoricSqlGrantsMissingError);
  });

  it('returns a warning instead of failing when pg_stat_statements.track is none', async () => {
    const client = queryClient([
      {
        headers: ['server_version_num', 'server_version'],
        rows: [[160004, 'PostgreSQL 16.4']],
      },
      { headers: ['?column?'], rows: [[1]] },
      { headers: ['has_role'], rows: [[true]] },
      { headers: ['track'], rows: [['none']] },
      { headers: ['max'], rows: [['5000']] },
    ]);
    const reader = new PostgresPgssQueryHistoryReader();

    await expect(reader.probe(client)).resolves.toEqual({
      pgServerVersion: 'PostgreSQL 16.4',
      warnings: [
        "pg_stat_statements.track is none; set it to top or all in the Postgres parameter group or config",
      ],
    });
  });

  it('warns when pg_stat_statements.max is below the recommended floor', async () => {
    const client = queryClient([
      {
        headers: ['server_version_num', 'server_version'],
        rows: [[160004, 'PostgreSQL 16.4']],
      },
      { headers: ['?column?'], rows: [[1]] },
      { headers: ['has_role'], rows: [[true]] },
      { headers: ['track'], rows: [['top']] },
      { headers: ['max'], rows: [['1000']] },
    ]);
    const reader = new PostgresPgssQueryHistoryReader();

    await expect(reader.probe(client)).resolves.toEqual({
      pgServerVersion: 'PostgreSQL 16.4',
      warnings: [
        'pg_stat_statements.max is 1000; set it to at least 5000 to reduce query-template eviction churn',
      ],
    });
  });

  it('reads a parameterized pg_stat_statements snapshot and stats info', async () => {
    const client = queryClient([
      {
        headers: [
          'queryid',
          'userid',
          'username',
          'dbid',
          'database',
          'query',
          'calls',
          'total_exec_time',
          'mean_exec_time',
          'total_rows',
        ],
        rows: [
          [
            '922337203685477580',
            '16384',
            'analyst',
            '16385',
            'warehouse',
            'SELECT count(*) FROM public.orders WHERE status = $1',
            '42',
            '2100.5',
            '50.0119',
            '9001',
          ],
          [
            '922337203685477581',
            '16386',
            'unknown',
            '16385',
            'warehouse',
            'SELECT * FROM public.customers WHERE id = $1',
            5,
            30,
            6,
            5,
          ],
        ],
      },
      {
        headers: ['stats_reset', 'dealloc'],
        rows: [[new Date('2026-05-01T00:00:00.000Z'), 7]],
      },
    ]);
    const reader = new PostgresPgssQueryHistoryReader();

    await expect(reader.readSnapshot(client, { minCalls: 5, maxTemplates: 500 })).resolves.toEqual({
      statsResetAt: '2026-05-01T00:00:00.000Z',
      deallocCount: 7,
      rows: [
        {
          queryid: '922337203685477580',
          userid: '16384',
          username: 'analyst',
          dbid: '16385',
          database: 'warehouse',
          query: 'SELECT count(*) FROM public.orders WHERE status = $1',
          calls: 42,
          totalExecTime: 2100.5,
          meanExecTime: 50.0119,
          totalRows: 9001,
        },
        {
          queryid: '922337203685477581',
          userid: '16386',
          username: 'unknown',
          dbid: '16385',
          database: 'warehouse',
          query: 'SELECT * FROM public.customers WHERE id = $1',
          calls: 5,
          totalExecTime: 30,
          meanExecTime: 6,
          totalRows: 5,
        },
      ],
    });

    const snapshotSql = executedSql(client, 0);
    expect(snapshotSql).toContain('FROM pg_stat_statements s');
    expect(snapshotSql).toContain('LEFT JOIN pg_roles');
    expect(snapshotSql).toContain('LEFT JOIN pg_database');
    expect(snapshotSql).toContain('WHERE s.toplevel = true');
    expect(snapshotSql).toContain('AND s.calls >= $1');
    expect(snapshotSql).toContain('ORDER BY s.total_exec_time DESC');
    expect(snapshotSql).toContain('LIMIT $2');
    expect(client.executeQuery.mock.calls[0]?.[1]).toEqual([5, 500]);
    expect(executedSql(client, 1)).toBe('SELECT stats_reset, dealloc FROM pg_stat_statements_info');
  });
});
