import { describe, expect, it, vi } from 'vitest';
import { KloPostgresHistoricSqlQueryClient } from './historic-sql-query-client.js';
import type { KloPostgresPoolConfig, KloPostgresPoolFactory } from './connector.js';

describe('KloPostgresHistoricSqlQueryClient', () => {
  it('executes parameterized read-only SQL through the native Postgres connector pool', async () => {
    const queryCalls: Array<{ sql: string; params?: unknown[] }> = [];
    const release = vi.fn();
    const end = vi.fn(async () => {});
    const poolFactory: KloPostgresPoolFactory = {
      createPool(_config: KloPostgresPoolConfig) {
        return {
          async connect() {
            return {
              async query(sql: string, params?: unknown[]) {
                queryCalls.push({ sql, params });
                return {
                  fields: [{ name: 'answer', dataTypeID: 23 }],
                  rows: [{ answer: 42 }],
                };
              },
              release,
            };
          },
          end,
        };
      },
    };
    const client = new KloPostgresHistoricSqlQueryClient({
      connectionId: 'warehouse',
      connection: {
        driver: 'postgres',
        readonly: true,
        url: 'postgresql://readonly:secret@pg.example.test/warehouse', // pragma: allowlist secret
      },
      poolFactory,
    });

    await expect(client.executeQuery('SELECT $1::int AS answer', [42])).resolves.toEqual({
      headers: ['answer'],
      rows: [[42]],
      totalRows: 1,
    });
    expect(queryCalls).toEqual([{ sql: 'SELECT $1::int AS answer', params: [42] }]);

    await client.cleanup();
    expect(release).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });
});
