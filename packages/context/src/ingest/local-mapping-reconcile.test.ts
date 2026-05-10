import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { kloLocalStateDbPath, type KloLocalProject } from '../project/index.js';
import { LocalLookerRuntimeStore } from './adapters/looker/local-runtime-store.js';
import { LocalMetabaseSourceStateReader } from './adapters/metabase/local-source-state-store.js';
import { seedLocalMappingStateFromKloYaml } from './local-mapping-reconcile.js';

describe('local mapping yaml reconciliation bridge', () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  function projectWithConnections(connections: KloLocalProject['config']['connections']): KloLocalProject {
    return {
      projectDir: tempDir,
      config: { connections },
    } as KloLocalProject;
  }

  it('seeds Metabase local state from klo.yaml mapping intent', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'klo-metabase-yaml-seed-'));
    const project = projectWithConnections({
      'prod-metabase': {
        driver: 'metabase',
        mappings: {
          databaseMappings: { '1': 'prod-warehouse' },
          syncEnabled: { '1': true },
          syncMode: 'ONLY',
          selections: { collections: [12] },
          defaultTagNames: ['klo'],
        },
      },
      'prod-warehouse': { driver: 'postgres', url: 'postgresql://readonly@db.test/analytics' },
    });

    await seedLocalMappingStateFromKloYaml(project, 'prod-metabase');

    const store = new LocalMetabaseSourceStateReader({ dbPath: kloLocalStateDbPath(project) });
    await expect(store.listDatabaseMappings('prod-metabase')).resolves.toMatchObject([
      { metabaseDatabaseId: 1, targetConnectionId: 'prod-warehouse', syncEnabled: true, source: 'klo.yaml' },
    ]);
    await expect(store.getSourceState('prod-metabase')).resolves.toMatchObject({
      syncMode: 'ONLY',
      selections: [{ selectionType: 'collection', metabaseObjectId: 12 }],
      defaultTagNames: ['klo'],
    });
  });

  it('seeds Looker local mappings from klo.yaml mapping intent', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'klo-looker-yaml-seed-'));
    const project = projectWithConnections({
      'prod-looker': {
        driver: 'looker',
        mappings: { connectionMappings: { analytics: 'prod-warehouse' } },
      },
      'prod-warehouse': { driver: 'postgres', url: 'postgresql://readonly@db.test/analytics' },
    });

    await seedLocalMappingStateFromKloYaml(project, 'prod-looker');

    const store = new LocalLookerRuntimeStore({ dbPath: kloLocalStateDbPath(project) });
    await expect(store.listConnectionMappings('prod-looker')).resolves.toMatchObject([
      { lookerConnectionName: 'analytics', kloConnectionId: 'prod-warehouse', source: 'klo.yaml' },
    ]);
  });

  it('does nothing for connections without mapping bootstrap intent', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'klo-no-yaml-seed-'));
    const project = projectWithConnections({ warehouse: { driver: 'postgres', url: 'env:DATABASE_URL' } });

    await expect(seedLocalMappingStateFromKloYaml(project, 'warehouse')).resolves.toBeUndefined();
  });
});
