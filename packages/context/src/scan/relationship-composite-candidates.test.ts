import Database from 'better-sqlite3';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { snapshotToKloEnrichedSchema } from './local-enrichment.js';
import { loadKloRelationshipBenchmarkFixture, maskKloRelationshipBenchmarkSnapshot } from './relationship-benchmarks.js';
import { discoverKloCompositeRelationships } from './relationship-composite-candidates.js';
import { profileKloRelationshipSchema, type KloRelationshipReadOnlyExecutor } from './relationship-profiling.js';
import type { KloQueryResult, KloReadOnlyQueryInput, KloScanContext } from './types.js';

class TestSqliteExecutor implements KloRelationshipReadOnlyExecutor {
  private readonly db: Database.Database;

  constructor(dataPath: string) {
    this.db = new Database(dataPath, { readonly: true, fileMustExist: true });
  }

  async executeReadOnly(input: KloReadOnlyQueryInput, _ctx: KloScanContext): Promise<KloQueryResult> {
    const rows = this.db.prepare(input.sql).all() as Record<string, unknown>[];
    const headers = Object.keys(rows[0] ?? {});
    return {
      headers,
      rows: rows.map((row) => headers.map((header) => row[header])),
      totalRows: rows.length,
      rowCount: rows.length,
    };
  }

  close(): void {
    this.db.close();
  }
}

describe('composite relationship discovery detector', () => {
  it('infers composite primary keys and validates composite foreign keys from row evidence', async () => {
    const fixtureRoot = new URL('../../test/fixtures/relationship-benchmarks/', import.meta.url);
    const fixture = await loadKloRelationshipBenchmarkFixture(
      join(fixtureRoot.pathname, 'composite_keys_no_declared_constraints'),
    );
    const snapshot = maskKloRelationshipBenchmarkSnapshot(fixture.snapshot, 'declared_pks_and_declared_fks_removed');
    const schema = snapshotToKloEnrichedSchema(snapshot, new Map());
    const executor = new TestSqliteExecutor(fixture.dataPath ?? '');
    const profiles = await profileKloRelationshipSchema({
      connectionId: snapshot.connectionId,
      driver: snapshot.driver,
      schema,
      executor,
      ctx: { runId: 'test:composite-profile' },
    });

    const result = await discoverKloCompositeRelationships({
      connectionId: snapshot.connectionId,
      driver: snapshot.driver,
      schema,
      profiles,
      executor,
      ctx: { runId: 'test:composite-detect' },
    });
    executor.close();

    expect(result.primaryKeys.map((item) => `${item.table.name}.(${item.columns.join(',')})`)).toEqual([
      'order_line_allocations.(order_id,line_number,warehouse_code)',
      'order_lines.(order_id,line_number)',
    ]);
    expect(
      result.relationships.map(
        (item) =>
          `${item.from.table.name}.(${item.from.columns.join(',')})->${item.to.table.name}.(${item.to.columns.join(',')})`,
      ),
    ).toEqual(['order_line_allocations.(order_id,line_number)->order_lines.(order_id,line_number)']);
    expect(result.relationships[0]).toMatchObject({
      relationshipType: 'many_to_one',
      status: 'accepted',
      confidence: 0.95,
      validation: {
        targetUniqueness: 1,
        sourceCoverage: 1,
        violationCount: 0,
        violationRatio: 0,
        reasons: ['composite_validation_passed'],
      },
    });
    expect(result.queryCount).toBeGreaterThan(0);
  });
});
